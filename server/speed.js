/**
 * Speed — the scaling joints sink.
 *
 * Joints buy permanent speed for the whole production chain. This replaces
 * prestige, which failed on comprehension: seeds were a second abstract
 * currency, earned only by wiping your progress, measured in quadrillions of
 * lifetime joints, and worth less with every one you held.
 *
 * The price is denominated in *seconds of the buyer's own production*, exactly
 * like a lottery ticket. That is what makes the ceiling hold. A fixed joint
 * price cannot: income grows by roughly a factor of 10^12 over a month, so any
 * fixed curve gets outrun — an earlier draft aimed at +20 % a month and
 * simulated out at x51.
 *
 * It also flattens the head start from the old economy. What counts is not the
 * size of a hoard but how many days of the owner's own output it represents:
 * the largest balance on production, 1.77 quadrillion, is 13 days and buys 24
 * steps (x1.61), while an account with a comparable rate and a smaller pile
 * buys none.
 *
 * Speed and lottery tickets draw on the same joints, and four tickets a day
 * already cost a top player a full day of output. That is the intended
 * decision: chance at sats, or permanent growth.
 */

import { db } from './db.js';
import { speedCost, speedMultiplier, throughput } from '../shared/economy.js';

/**
 * Production rate the price is measured against.
 *
 * Read from the stored game state rather than players.joints_per_sec, which
 * holds whatever the client last reported — pricing off that would let a player
 * post a rate of zero and buy the ladder for nothing. Boosts are excluded so a
 * boost never makes upgrades more expensive; the speed level itself is included,
 * which is what keeps the cost constant in production-time.
 */
export function playerRate(npub) {
  const row = db.prepare('SELECT game_state, speed_level FROM players WHERE npub = ?').get(npub);
  if (!row?.game_state) return 0;
  try {
    return throughput(JSON.parse(row.game_state), { speedLevel: row.speed_level || 0 }).jointsPerSec;
  } catch {
    return 0;
  }
}

export function speedStatus(npub) {
  const row = db.prepare('SELECT speed_level FROM players WHERE npub = ?').get(npub);
  const level = row?.speed_level || 0;
  const rate = playerRate(npub);
  return {
    level,
    multiplier: speedMultiplier(level),
    next_multiplier: speedMultiplier(level + 1),
    next_cost: speedCost(level, rate),
    rate,
  };
}

const _buySpeedTx = db.transaction((npub) => {
  // Priced inside the transaction from the stored level, so two concurrent buys
  // cannot both go through at the old price.
  const row = db.prepare('SELECT joints, speed_level, game_state FROM players WHERE npub = ?').get(npub);
  if (!row) return { ok: false, reason: 'Player not found' };

  const level = row.speed_level || 0;
  let rate = 0;
  try { rate = throughput(JSON.parse(row.game_state || '{}'), { speedLevel: level }).jointsPerSec; } catch { /* no output */ }
  if (rate <= 0) return { ok: false, reason: 'Automate the chain first — speed is priced in production' };

  const cost = speedCost(level, rate);
  const deducted = db.prepare(
    'UPDATE players SET joints = joints - ?, speed_level = speed_level + 1 WHERE npub = ? AND joints >= ?'
  ).run(cost, npub, cost);
  if (deducted.changes === 0) {
    return { ok: false, reason: `Not enough joints — ${cost} needed, you have ${Math.floor(row.joints)}` };
  }

  return { ok: true, cost, level: level + 1, multiplier: speedMultiplier(level + 1) };
});

export function buySpeed(npub) {
  const result = _buySpeedTx(npub);
  if (!result.ok) return result;

  const player = db.prepare('SELECT joints FROM players WHERE npub = ?').get(npub);
  console.log(`[Speed] ${npub.slice(0, 8)}… bought level ${result.level} for ${result.cost} joints (x${result.multiplier.toFixed(2)})`);
  return { ...result, joints: player?.joints ?? 0, ...speedStatus(npub) };
}
