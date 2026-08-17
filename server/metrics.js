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
import { REQUIRED_MANAGERS, countLotteryManagers, throughput } from '../shared/economy.js';
import { berlinFields, berlinWallClockToUtc } from '../shared/schedule.js';

export const METRICS_VERSION = 2;

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

/** Shift a YYYY-MM-DD calendar day without involving the server timezone. */
function shiftDay(day, amount) {
  const [y, m, d] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + amount));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
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
/** Sum a field out of the meta JSON of every event of one type. */
const metaSum = (rows, type, field) => rows
  .filter(r => r.type === type)
  .reduce((s, r) => { try { return s + (JSON.parse(r.meta || '{}')[field] || 0) } catch { return s } }, 0);
const countOf = (rows, type) => rows.filter(r => r.type === type).length;
const playersOf = (rows, type) => new Set(rows.filter(r => r.type === type && r.npub).map(r => r.npub)).size;
const parsedMeta = (row) => {
  try { return JSON.parse(row.meta || '{}') } catch { return {} }
};
const genuine = row => parsedMeta(row).backfill !== true;

/** Events belonging to real accounts; npub-less system events remain valid. */
function realEventRows(start, end) {
  return db.prepare(`
    SELECT e.npub, e.type, e.amount, e.meta, e.ts
    FROM events e
    LEFT JOIN players p ON p.npub = e.npub
    WHERE e.ts >= ? AND e.ts < ?
      AND (e.npub IS NULL OR (p.npub IS NOT NULL AND COALESCE(p.is_bot, 0) = 0))
  `).all(start, end);
}

function genuinePlayerRows(start, end, type) {
  return db.prepare(`
    SELECT e.npub, e.type, e.amount, e.meta, e.ts
    FROM events e JOIN players p ON p.npub = e.npub
    WHERE e.ts >= ? AND e.ts < ? AND e.type = ? AND COALESCE(p.is_bot, 0) = 0
  `).all(start, end, type).filter(genuine);
}

/** DAU/WAU/MAU and exact-day cohort retention for one Berlin calendar day. */
export function engagementForDay(day = today()) {
  const bounds = dayBounds(day);
  const activeRows = genuinePlayerRows(bounds.start, bounds.end, 'active');
  const activePlayers = new Set(activeRows.map(r => r.npub));
  const signups = genuinePlayerRows(bounds.start, bounds.end, 'signup');
  const signupPlayers = new Set(signups.map(r => r.npub));

  const windowPlayers = (days) => {
    const start = dayBounds(shiftDay(day, -(days - 1))).start;
    return new Set(genuinePlayerRows(start, bounds.end, 'active').map(r => r.npub));
  };

  const retention = {};
  for (const offset of [1, 3, 7, 14]) {
    const cohortDay = shiftDay(day, -offset);
    const cohortBounds = dayBounds(cohortDay);
    const cohort = new Set(genuinePlayerRows(cohortBounds.start, cohortBounds.end, 'signup').map(r => r.npub));
    const retained = [...cohort].filter(npub => activePlayers.has(npub)).length;
    retention[`d${offset}`] = {
      eligible: cohort.size,
      retained,
      rate: cohort.size > 0 ? retained / cohort.size : null,
    };
  }

  return {
    dau: activePlayers.size,
    wau: windowPlayers(7).size,
    mau: windowPlayers(30).size,
    sessions: activeRows.length,
    new: signupPlayers.size,
    returning: [...activePlayers].filter(npub => !signupPlayers.has(npub)).length,
    retention,
  };
}

/**
 * Build (or rebuild) one day's row.
 * @param {string} day YYYY-MM-DD in Berlin
 */
export function rollupDay(day = today()) {
  const { start, end } = dayBounds(day);
  const rows = realEventRows(start, end);
  const engagement = engagementForDay(day);

  // State snapshots, taken at rollup time rather than derived from events —
  // they answer "where does the player base stand", not "what happened today".
  const players = db.prepare(`SELECT npub, game_state, speed_level, joints, sats
                              FROM players WHERE COALESCE(is_bot, 0) = 0`).all();
  const automated = players.filter(p => countLotteryManagers(p.game_state) >= REQUIRED_MANAGERS).length;
  const speedLevels = players.reduce((s, p) => s + (p.speed_level || 0), 0);

  // Which stage holds each chain back. If everyone is stuck behind the same one,
  // that is a design answer, not a player choice — and it is invisible in any
  // per-event count.
  const bottleneck = { plantations: 0, courier: 0, factory: 0, idle: 0 };
  for (const p of players) {
    let t = null;
    try { t = throughput(JSON.parse(p.game_state || '{}'), { speedLevel: p.speed_level || 0 }) } catch { /* unreadable */ }
    if (!t || t.jointsPerSec <= 0) { bottleneck.idle++; continue }
    if (t.jointsPerSec === t.plant) bottleneck.plantations++;
    else if (t.jointsPerSec === t.courier) bottleneck.courier++;
    else bottleneck.factory++;
  }

  // A draw event carries the gross pot as its amount and the split in its meta.
  const draws = rows.filter(r => r.type === 'draw').map(r => {
    let meta = {};
    try { meta = JSON.parse(r.meta || '{}') } catch { /* keep empty */ }
    return { gross: r.amount, ...meta };
  });

  const data = {
    metrics_version: METRICS_VERSION,
    // Activity
    // `active` remains as a compatibility alias for existing admin clients.
    active: engagement.dau,
    dau: engagement.dau,
    wau: engagement.wau,
    mau: engagement.mau,
    new: engagement.new,
    returning: engagement.returning,
    sessions: engagement.sessions,
    retention: engagement.retention,

    // Sats in, sats out, sats spent
    deposits: sumOf(rows, 'deposit'),
    withdrawals: sumOf(rows, 'withdraw'),
    spend_boosts: sumOf(rows, 'boost'),
    spend_managers: sumOf(rows, 'manager'),
    boosts_bought: countOf(rows, 'boost'),
    boosts_claimed: countOf(rows, 'boost_claim'),

    // Joints sinks — where the earned currency actually goes
    upgrade_spend: sumOf(rows, 'upgrade'),
    levels_bought: metaSum(rows, 'upgrade', 'levels'),
    level_spend: metaSum(rows, 'upgrade', 'level_cost'),
    capacity_bought: metaSum(rows, 'upgrade', 'capacity'),
    capacity_spend: metaSum(rows, 'upgrade', 'capacity_cost'),
    unlocks: metaSum(rows, 'upgrade', 'unlocks'),
    unlock_spend: metaSum(rows, 'upgrade', 'unlock_cost'),
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

    // How the guard behaved — a spike here means it is taking from honest play
    clamps: countOf(rows, 'clamp'),
    clamped_joints: sumOf(rows, 'clamp'),
    restored_joints: sumOf(rows, 'restore'),

    // Standings at the end of the day
    players_total: players.length,
    players_automated: automated,
    bottleneck,
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
    .map(r => {
      let data = {};
      try { data = JSON.parse(r.data) } catch { /* rebuild below */ }
      // Old rows counted every npub-bearing event as activity. Rebuild lazily
      // when they are requested so the Health endpoint never mixes definitions
      // and no one-off migration has to race the live event log.
      if (data.metrics_version !== METRICS_VERSION) data = rollupDay(r.day);
      return { day: r.day, ...data };
    });
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
