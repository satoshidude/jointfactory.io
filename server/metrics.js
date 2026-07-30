/**
 * Daily rollup — the numbers the next round of balancing will be argued from.
 *
 * The event log answers "what happened", but not without a query each time, and
 * raw rows are worth pruning eventually. This folds one Berlin day into a single
 * row so a trend can be read months later at no cost, and so the questions that
 * actually decide balance changes have a fixed shape:
 *
 *   Does anyone come back?          active, returning, new
 *   Where do sats go?               spend_boosts, spend_managers, deposits
 *   Does the pot circulate?         pot_gross, paid_out, house_cut, unclaimed
 *   Is the joints sink working?     speed_spend, ticket_spend, speed_levels
 *   Does the funnel complete?       automated, first_ticket
 *
 * Every figure is derived, never incremented, so a re-run of the same day
 * overwrites with the same result — safe to backfill.
 */

import { db } from './db.js';
import { houseBalance } from './house.js';
import { REQUIRED_MANAGERS, countLotteryManagers } from '../shared/economy.js';
import { berlinFields, berlinWallClockToUtc } from '../shared/schedule.js';

/**
 * Berlin midnight boundaries for a YYYY-MM-DD day, as unix seconds.
 *
 * Reuses the DST-safe conversion the draw schedule is built on rather than the
 * server's own timezone, which is UTC — days would otherwise be cut an hour or
 * two off from the day players and draws live in.
 */
function dayBounds(day) {
  const [y, m, d] = day.split('-').map(Number);
  const start = berlinWallClockToUtc(y, m, d, 0) / 1000;
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const end = berlinWallClockToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 0) / 1000;
  return { start, end };
}

const isoDay = (utcMs) => {
  const f = berlinFields(utcMs);
  return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
};

/** Today in Berlin, YYYY-MM-DD. */
export function today() {
  return isoDay(Date.now());
}

const sumOf = (rows, type) => rows.filter(r => r.type === type).reduce((s, r) => s + r.amount, 0);
const countOf = (rows, type) => rows.filter(r => r.type === type).length;
const playersOf = (rows, type) => new Set(rows.filter(r => r.type === type && r.npub).map(r => r.npub)).size;

/**
 * Build (or rebuild) one day's row.
 * @param {string} day YYYY-MM-DD in Berlin
 */
export function rollupDay(day = today()) {
  const { start, end } = dayBounds(day);
  const rows = db.prepare('SELECT npub, type, amount, meta FROM events WHERE ts >= ? AND ts < ?').all(start, end);

  // Players seen today, and how many of them had been seen before it.
  const seen = new Set(rows.filter(r => r.npub).map(r => r.npub));
  const newToday = new Set(rows.filter(r => r.type === 'signup' && r.npub).map(r => r.npub));
  const returning = [...seen].filter(n => !newToday.has(n)).length;

  // State snapshots, taken at rollup time rather than derived from events —
  // they answer "where does the player base stand", not "what happened today".
  const players = db.prepare(`SELECT npub, game_state, speed_level, joints, sats
                              FROM players WHERE COALESCE(is_bot, 0) = 0`).all();
  const automated = players.filter(p => countLotteryManagers(p.game_state) >= REQUIRED_MANAGERS).length;
  const speedLevels = players.reduce((s, p) => s + (p.speed_level || 0), 0);

  // A draw event carries the gross pot as its amount and the split in its meta.
  const draws = rows.filter(r => r.type === 'draw').map(r => {
    let meta = {};
    try { meta = JSON.parse(r.meta || '{}') } catch { /* keep empty */ }
    return { gross: r.amount, ...meta };
  });

  const data = {
    // Activity
    active: seen.size,
    new: newToday.size,
    returning,
    sessions: countOf(rows, 'active'),

    // Sats in, sats out, sats spent
    deposits: sumOf(rows, 'deposit'),
    withdrawals: sumOf(rows, 'withdraw'),
    spend_boosts: sumOf(rows, 'boost'),
    spend_managers: sumOf(rows, 'manager'),
    boosts_bought: countOf(rows, 'boost'),
    boosts_claimed: countOf(rows, 'boost_claim'),

    // Joints sinks
    ticket_spend: sumOf(rows, 'ticket'),
    tickets: countOf(rows, 'ticket'),
    ticket_buyers: playersOf(rows, 'ticket'),
    speed_spend: sumOf(rows, 'speed'),
    speed_steps: countOf(rows, 'speed'),

    // The pot loop
    draws: draws.length,
    pot_gross: draws.reduce((s, d) => s + (d.gross || 0), 0),
    paid_out: draws.reduce((s, d) => s + (d.paid || 0), 0),
    house_cut: draws.reduce((s, d) => s + (d.cut || 0), 0),
    unclaimed: draws.reduce((s, d) => s + (d.to_house || 0), 0),
    winners: draws.reduce((s, d) => s + (d.winners || 0), 0),

    // Invites
    invite_signups: countOf(rows, 'invite_signup'),
    invite_unlocks: countOf(rows, 'invite_unlock'),

    // Standings at the end of the day
    players_total: players.length,
    players_automated: automated,
    speed_levels_total: speedLevels,
    sats_held: players.reduce((s, p) => s + (p.sats || 0), 0),
    house_balance: houseBalance(),
  };

  db.prepare(`INSERT INTO daily_stats (day, data, built_at) VALUES (?, ?, unixepoch())
              ON CONFLICT(day) DO UPDATE SET data = excluded.data, built_at = excluded.built_at`)
    .run(day, JSON.stringify(data));
  return data;
}

/** The last n days, newest first. */
export function recentStats(days = 30) {
  return db.prepare('SELECT day, data FROM daily_stats ORDER BY day DESC LIMIT ?').all(days)
    .map(r => ({ day: r.day, ...JSON.parse(r.data) }));
}

/**
 * Drop raw events older than the retention window. The daily rows keep the
 * trend, so nothing that matters for balancing is lost — and a table nobody
 * prunes is a table that eventually has to be dealt with in a hurry.
 */
export function pruneEvents(keepDays = 120) {
  const cutoff = Math.floor(Date.now() / 1000) - keepDays * 86400;
  const res = db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
  if (res.changes > 0) console.log(`[Metrics] pruned ${res.changes} event(s) older than ${keepDays} days`);
  return res.changes;
}

/** Yesterday in Berlin, YYYY-MM-DD. */
export function yesterday() {
  return isoDay(Date.now() - 86400_000);
}
