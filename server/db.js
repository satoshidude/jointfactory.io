import Database from 'better-sqlite3';
import path from 'path';
import 'dotenv/config';
import { nextDrawTime } from '../shared/schedule.js';

const dbPath = path.resolve(process.env.DB_PATH || './data/jointfactory.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    npub TEXT PRIMARY KEY,
    display_name TEXT,
    avatar TEXT,
    lightning_address TEXT,
    joints INTEGER DEFAULT 0,
    sats INTEGER DEFAULT 210,
    game_state JSON,
    total_joints_earned INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    last_seen_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS lottery_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    starts_at INTEGER DEFAULT (unixepoch()),
    draws_at INTEGER,
    status TEXT DEFAULT 'open',
    total_sats_collected INTEGER DEFAULT 0,
    winner_npub TEXT,
    winner_payout_sats INTEGER,
    winner_paid_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS lottery_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER REFERENCES lottery_rounds(id),
    npub TEXT,
    joints_cost INTEGER DEFAULT 1000,
    purchased_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS lightning_payments (
    payment_hash TEXT PRIMARY KEY,
    npub TEXT,
    amount_sats INTEGER,
    pack_id TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (unixepoch()),
    paid_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS redemptions (
    token TEXT PRIMARY KEY,
    npub TEXT,
    reward_type TEXT,
    joints_cost INTEGER,
    expires_at INTEGER,
    redeemed_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

// Add joints_per_sec column if missing
try { db.exec(`ALTER TABLE players ADD COLUMN joints_per_sec REAL DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE players ADD COLUMN nip05 TEXT`); } catch(_) {}

// Withdrawal log
db.exec(`
  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npub TEXT NOT NULL,
    amount_sats INTEGER NOT NULL,
    lightning_address TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

// Rate log for production race chart
db.exec(`
  CREATE TABLE IF NOT EXISTS rate_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npub TEXT NOT NULL,
    ts INTEGER NOT NULL DEFAULT (unixepoch()),
    rate REAL NOT NULL,
    total INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_rate_log_npub_ts ON rate_log(npub, ts);
`);

// Strongest boost multiplier in effect when the rate was logged, so the growth
// chart can tell a boosted burst from a permanent upgrade. Both look like a
// rate jump otherwise.
try { db.exec(`ALTER TABLE rate_log ADD COLUMN boost REAL DEFAULT 1`); } catch(_) {}

// Invite system columns
try { db.exec(`ALTER TABLE players ADD COLUMN invite_code TEXT`); } catch(_) {}
try { db.exec(`ALTER TABLE players ADD COLUMN referred_by TEXT`); } catch(_) {}
try { db.exec(`ALTER TABLE players ADD COLUMN referral_rewarded INTEGER DEFAULT 0`); } catch(_) {}
try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_players_invite_code ON players(invite_code)`); } catch(_) {}

// Track total Lightning deposits per player
try { db.exec(`ALTER TABLE players ADD COLUMN total_deposited INTEGER DEFAULT 0`); } catch(_) {}

// Which client owns the account. Only the newest one may write its state — two
// clients simulating the same chain clamp each other and buy the same upgrade
// twice. See server/session.js.
try { db.exec(`ALTER TABLE players ADD COLUMN active_session TEXT`); } catch(_) {}
try { db.exec(`ALTER TABLE players ADD COLUMN active_session_at INTEGER`); } catch(_) {}

// Bot accounts that keep the lottery looking alive.
// Marked so they can be excluded from leaderboards, reports and payouts —
// the fake activity used to run on real players' accounts, spending their
// joints and crediting them withdrawable sats.
try { db.exec(`ALTER TABLE players ADD COLUMN is_bot INTEGER DEFAULT 0`); } catch(_) {}

// Revision counter for the joint balance, bumped by every server-side
// deduction. The client owns its balance and posts an absolute figure; without
// this, a purchase made between two saves is silently undone by the next one.
try { db.exec(`ALTER TABLE players ADD COLUMN joints_rev INTEGER DEFAULT 0`); } catch(_) {}

// Bought speed — permanent, chain-wide production multiplier, paid in joints.
// Replaces the prestige/seed system: one currency, one ladder, no reset.
try { db.exec(`ALTER TABLE players ADD COLUMN speed_level INTEGER DEFAULT 0`); } catch(_) {}

// When the referrer collected the hour of double output their buddy earned.
// The reward is claimed by hand from the boost card rather than starting on its
// own, so it is never spent while nobody is watching — and an unclaimed tile is
// how a referrer notices someone took their link at all.
//
// Referrals rewarded under the old sats scheme are backfilled as claimed: they
// were paid out at the time, and they would otherwise appear as free hours.
try {
  db.exec(`ALTER TABLE players ADD COLUMN referral_claimed_at INTEGER`);
  db.exec(`UPDATE players SET referral_claimed_at = unixepoch() WHERE referral_rewarded = 1`);
} catch(_) {}

// When the game state was last written — which is not the same as when the
// player was last seen.
//
// The save guard measures how much production a client may claim against the
// time since its last save. It used last_seen_at, and logging in used to set
// that to now: a player returning after 78 days had their offline earnings measured
// against a window of seconds and clamped away. Only saveState touches this.
try {
  db.exec(`ALTER TABLE players ADD COLUMN state_saved_at INTEGER`);
  db.exec(`UPDATE players SET state_saved_at = last_seen_at WHERE state_saved_at IS NULL`);
} catch(_) {}

// ── Rounds ───────────────────────────────────────────────────────────────────
// A game that never ends has no second act: the players at the top of the curve
// had nothing left to do, and their numbers climbed into suffixes nobody feels.
// Play now runs in rounds that finish at ROUND_TARGET, and finishing one may be
// banked for prestige and started over.
//
// One row per round per player. `seconds_to_target` is the Billionaires Club
// time — raw, with the sats spent on boosts beside it, so an expensive place is
// visible without being penalised. It stays NULL for rounds that never got
// there, including the pre-round histories written by scripts/migrate-rounds.mjs.
db.exec(`
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npub TEXT NOT NULL,
    round_no INTEGER NOT NULL,
    started_at INTEGER NOT NULL DEFAULT (unixepoch()),
    ended_at INTEGER,
    reached_target_at INTEGER,
    seconds_to_target INTEGER,
    joints_earned INTEGER DEFAULT 0,
    boost_sats INTEGER DEFAULT 0,
    megafarm_at INTEGER,
    prestige_points INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_rounds_npub ON rounds(npub, round_no);
  CREATE INDEX IF NOT EXISTS idx_rounds_time ON rounds(seconds_to_target);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_rounds_open ON rounds(npub) WHERE ended_at IS NULL;
`);

// Totals that survive a reset. total_joints_earned is the *round* counter and
// goes back to zero; without a separate all-time figure the growth chart and the
// player's own history would be erased every time they start over.
try { db.exec(`ALTER TABLE players ADD COLUMN lifetime_joints INTEGER DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE players ADD COLUMN prestige_points INTEGER DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE players ADD COLUMN rounds_completed INTEGER DEFAULT 0`); } catch(_) {}

// Set on the accounts that predate rounds. Their balances come from a curve that
// no longer exists — up to twenty quadrillion joints beside a target of one
// billion — so they cannot simply keep playing, and overwriting them without
// asking would take months of play away from people who never agreed to it.
//
// While this is 1 the account is frozen: saveState refuses, and the client shows
// the switch screen. Confirming clears it. Nothing else does — an account that
// never confirms stays exactly as it is, for as long as its owner wants.
//
// Default 0, so accounts created from here on are playing rounds from birth and
// so are test fixtures. scripts/migrate-rounds.mjs --mark raises it once, on the
// accounts that were already there.
try { db.exec(`ALTER TABLE players ADD COLUMN switch_pending INTEGER DEFAULT 0`); } catch(_) {}

// Key-value store for bot state (e.g. nostr event IDs)
db.exec(`
  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Timed production boosts — the recurring sats sink.
// One row per player and type; buying an active boost again extends its expiry
// instead of inserting a second row, so the table stays bounded and the
// multiplier cannot stack into absurd rates.
db.exec(`
  CREATE TABLE IF NOT EXISTS active_boosts (
    npub TEXT NOT NULL,
    type TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (npub, type)
  );
  CREATE INDEX IF NOT EXISTS idx_active_boosts_expiry ON active_boosts(expires_at);
`);

// ── Event log ────────────────────────────────────────────────────────────────
// Every table above holds *state*: the current speed level, the boosts running
// right now, what a game_state looks like at this second. None of it says when
// anything happened, so questions the next round of balancing depends on —
// what do players spend on first, how long until a chain is automated, does a
// boost lead to a ticket — cannot be answered afterwards at any price.
//
// One append-only row per decision closes that. Cheap: a few hundred rows a day
// at the current player count, and the aggregates in server/metrics.js roll them
// into one row per day so the raw rows can be pruned without losing the trend.
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL DEFAULT (unixepoch()),
    npub TEXT,
    type TEXT NOT NULL,
    amount INTEGER DEFAULT 0,   -- sats or joints, whichever the type spends
    meta TEXT                   -- JSON, type-specific detail
  );
  CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);
  CREATE INDEX IF NOT EXISTS idx_events_npub_ts ON events(npub, ts);

  CREATE TABLE IF NOT EXISTS daily_stats (
    day TEXT PRIMARY KEY,       -- YYYY-MM-DD, Berlin
    data TEXT NOT NULL,         -- JSON blob, see server/metrics.js
    built_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const _logEventStmt = db.prepare(
  'INSERT INTO events (npub, type, amount, meta) VALUES (?, ?, ?, ?)'
);

/**
 * Record something a player did. Never throws — an analytics write must not be
 * able to fail a purchase.
 *
 * @param {string|null} npub
 * @param {string} type   'signup' | 'active' | 'manager' | 'speed' | 'boost' |
 *                        'boost_claim' | 'ticket' | 'deposit' | 'withdraw' |
 *                        'draw' | 'win' | 'invite_signup' | 'invite_unlock'
 * @param {number} [amount] sats for sats spends, joints for joints spends
 * @param {object} [meta]
 */
export function logEvent(npub, type, amount = 0, meta = null) {
  try {
    _logEventStmt.run(npub || null, type, Math.round(amount || 0), meta ? JSON.stringify(meta) : null);
  } catch (err) {
    console.warn('[Events] write failed:', err.message);
  }
}

// Draw schedule lives in shared/schedule.js — pure date math, no DB, testable.

export function ensureOpenRound() {
  const open = db.prepare(`SELECT id FROM lottery_rounds WHERE status = 'open' LIMIT 1`).get();
  if (!open) {
    const draws_at = nextDrawTime();
    db.prepare(`INSERT INTO lottery_rounds (draws_at) VALUES (?)`).run(draws_at);
    console.log('[DB] New lottery round created, draws at', new Date(draws_at * 1000).toISOString());
  }
}

ensureOpenRound();

// Log rate change if it actually changed from last entry
const _lastRate = new Map(); // npub → last logged rate
const _lastBoost = new Map(); // npub → last logged boost multiplier
const _logRateStmt = db.prepare(`INSERT INTO rate_log (npub, ts, rate, total, boost) VALUES (?, unixepoch(), ?, ?, ?)`);
const _getLastRateStmt = db.prepare(`SELECT rate FROM rate_log WHERE npub = ? ORDER BY ts DESC LIMIT 1`);

export function logRateChange(npub, rate, total, boost = 1) {
  const r = Math.round(rate * 1000) / 1000; // round to 3 decimals
  const b = Math.round((boost || 1) * 100) / 100;
  let last = _lastRate.get(npub);
  if (last === undefined) {
    const row = _getLastRateStmt.get(npub);
    last = row ? row.rate : -1;
    _lastRate.set(npub, last);
  }
  // A boost starting or ending is worth a row even at an unchanged rate — it is
  // what lets the chart mark the span.
  const boostChanged = _lastBoost.get(npub) !== b;
  if (Math.abs(r - last) < 0.001 && !boostChanged) return;
  _logRateStmt.run(npub, r, Math.floor(total || 0), b);
  _lastRate.set(npub, r);
  _lastBoost.set(npub, b);
}

export { db };
