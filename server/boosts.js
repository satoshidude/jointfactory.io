/**
 * Timed production boosts — the recurring sats sink.
 *
 * The economy died because every sats sink was one-off: managers cost ~400 sats
 * once, and the 1000-level speed curve asked ~302k sats per station, so the
 * whole player base bought 132 of 8000 levels. Once a player owned their
 * managers they never spent again, and since 80 % of spend feeds the lottery
 * pot, the pot went to zero and with it the reason to play.
 *
 * Consumables fix that: the same sats cycle pot → winners → boosts → pot
 * indefinitely, burning the 20 % house cut each lap.
 *
 * Server-authoritative on purpose — expiry lives in the database, so a client
 * cannot extend a boost by lying about the clock.
 */

import { db } from './db.js';
import { BOOSTS } from '../shared/economy.js';

export function getActiveBoosts(npub) {
  return db.prepare(
    `SELECT type, expires_at FROM active_boosts
     WHERE npub = ? AND expires_at > unixepoch()
     ORDER BY expires_at`
  ).all(npub);
}

const _buyBoostTx = db.transaction((npub, type) => {
  const def = BOOSTS[type];
  if (!def) return { ok: false, reason: 'Unknown boost' };

  // Atomic deduct — the WHERE guard makes a concurrent double-buy impossible.
  const deducted = db.prepare(
    'UPDATE players SET sats = sats - ? WHERE npub = ? AND sats >= ?'
  ).run(def.cost, npub, def.cost);
  if (deducted.changes === 0) {
    const have = db.prepare('SELECT sats FROM players WHERE npub = ?').get(npub)?.sats ?? 0;
    return { ok: false, reason: `Not enough sats — ${def.cost} needed, you have ${have}` };
  }

  // Buying an active boost extends it rather than stacking a second multiplier.
  // Stacking would let a player with a full wallet push the rate arbitrarily
  // high for a moment; extending keeps the ceiling fixed and the maths simple.
  const now = Math.floor(Date.now() / 1000);
  const current = db.prepare(
    'SELECT expires_at FROM active_boosts WHERE npub = ? AND type = ?'
  ).get(npub, type);
  const base = current && current.expires_at > now ? current.expires_at : now;
  const expires_at = base + def.durationSec;

  db.prepare(
    `INSERT INTO active_boosts (npub, type, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(npub, type) DO UPDATE SET expires_at = excluded.expires_at`
  ).run(npub, type, expires_at);

  // Gross into the pot — the house cut is taken once, at payout.
  const toPot = def.cost;
  db.prepare(
    `UPDATE lottery_rounds SET total_sats_collected = total_sats_collected + ?
     WHERE status = 'open'`
  ).run(toPot);

  const sats = db.prepare('SELECT sats FROM players WHERE npub = ?').get(npub)?.sats ?? 0;
  return { ok: true, type, cost: def.cost, toPot, expires_at, sats };
});

export function buyBoost(npub, type) {
  const player = db.prepare('SELECT npub FROM players WHERE npub = ?').get(npub);
  if (!player) return { ok: false, reason: 'Player not found' };

  const result = _buyBoostTx(npub, type);
  if (!result.ok) return result;

  console.log(`[Boost] ${npub.slice(0, 8)}… bought ${type} for ${result.cost} sats (${result.toPot} to pot)`);
  return { ...result, boosts: getActiveBoosts(npub) };
}
