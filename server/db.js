import Database from 'better-sqlite3';
import path from 'path';
import 'dotenv/config';

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

// Invite system columns
try { db.exec(`ALTER TABLE players ADD COLUMN invite_code TEXT`); } catch(_) {}
try { db.exec(`ALTER TABLE players ADD COLUMN referred_by TEXT`); } catch(_) {}
try { db.exec(`ALTER TABLE players ADD COLUMN referral_rewarded INTEGER DEFAULT 0`); } catch(_) {}
try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_players_invite_code ON players(invite_code)`); } catch(_) {}

// Ensure there's always an open lottery round
// Lottery draw schedule: 6 times daily in Europe/Berlin
const DRAW_HOURS_BERLIN = [0, 8, 11, 16, 19, 21];

function nextDrawTime() {
  const now = new Date();
  // Get Berlin time parts via Intl (reliable, handles DST)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  const berlinHour = parseInt(parts.hour);
  const berlinMin = parseInt(parts.minute);

  // Find next draw hour today
  // Strictly next hour (skip current hour even at :00 to avoid double-draw)
  let nextHour = DRAW_HOURS_BERLIN.find(h => h > berlinHour);
  let dayOffset = 0;
  if (nextHour === undefined) {
    nextHour = DRAW_HOURS_BERLIN[0]; // wrap to tomorrow
    dayOffset = 1;
  }

  // Build ISO string for the target time in Berlin, then compute UTC offset
  const targetBerlinStr = `${parts.year}-${parts.month}-${String(parseInt(parts.day) + dayOffset).padStart(2,'0')}T${String(nextHour).padStart(2,'0')}:00:00`;
  // Get UTC offset by comparing now's UTC ms with what Berlin clock shows
  const berlinNowMs = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`).getTime();
  const offsetMs = berlinNowMs - now.getTime();
  const targetUtcMs = new Date(targetBerlinStr).getTime() - offsetMs;
  return Math.floor(targetUtcMs / 1000);
}

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
const _logRateStmt = db.prepare(`INSERT INTO rate_log (npub, ts, rate, total) VALUES (?, unixepoch(), ?, ?)`);
const _getLastRateStmt = db.prepare(`SELECT rate FROM rate_log WHERE npub = ? ORDER BY ts DESC LIMIT 1`);

export function logRateChange(npub, rate, total) {
  const r = Math.round(rate * 1000) / 1000; // round to 3 decimals
  let last = _lastRate.get(npub);
  if (last === undefined) {
    const row = _getLastRateStmt.get(npub);
    last = row ? row.rate : -1;
    _lastRate.set(npub, last);
  }
  if (Math.abs(r - last) < 0.001) return; // no change
  _logRateStmt.run(npub, r, Math.floor(total || 0));
  _lastRate.set(npub, r);
}

export { db };
