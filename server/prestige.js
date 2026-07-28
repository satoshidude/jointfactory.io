/**
 * Prestige ("Harvest") — the only way past the upgrade wall.
 *
 * Plantation costs grow faster than plantation output, so progression stalls:
 * the top live account needs 18 days of idling for a single MegaFarm level and
 * ~135 days for the next milestone. Every endgame player therefore sits at the
 * same rate. A harvest trades that stalled run for a permanent multiplier.
 *
 * Two rules make it safe:
 *
 * 1. Only joints-bought progress resets — levels, capacities, unlocks, the
 *    joint balance. Everything sats paid for survives: speed levels, managers,
 *    the wallet. Game logic must never destroy real money. Sats-bought upgrades
 *    on plantations that get locked again are parked and restored on re-unlock.
 *
 * 2. Seeds derive from all-time total_joints_earned, which never decreases, so
 *    the count is monotone and a second harvest without progress yields nothing.
 *    Existing accounts convert on their own at the season reset — no special
 *    case, no migration table.
 */

import { db } from './db.js';
import { prestigeReset, prestigeGain, prestigeMultiplier, nextSeedAt, throughput } from '../shared/economy.js';

const _prestigeTx = db.transaction((npub) => {
  const player = db.prepare(
    'SELECT total_joints_earned, prestige_seeds, game_state FROM players WHERE npub = ?'
  ).get(npub);
  if (!player) return { ok: false, reason: 'Player not found' };

  const lifetime = player.total_joints_earned || 0;
  const current = player.prestige_seeds || 0;
  const gain = prestigeGain(lifetime, current);
  if (gain <= 0) {
    return { ok: false, reason: 'Not enough lifetime joints for another harvest yet' };
  }

  let gs = {};
  try { gs = JSON.parse(player.game_state || '{}'); } catch { /* start fresh */ }
  const reset = prestigeReset(gs);
  const seeds = current + gain;

  db.prepare(`
    UPDATE players SET
      prestige_seeds = ?,
      joints = 0,
      game_state = ?,
      joints_per_sec = ?,
      last_seen_at = unixepoch()
    WHERE npub = ?
  `).run(seeds, JSON.stringify(reset), throughput(reset, { seeds }).jointsPerSec, npub);

  return { ok: true, seeds, gained: gain, multiplier: prestigeMultiplier(seeds), gameState: reset };
});

export function doPrestige(npub) {
  const result = _prestigeTx(npub);
  if (result.ok) {
    console.log(`[Prestige] ${npub.slice(0, 12)}… harvested +${result.gained} seeds (now ${result.seeds}, x${result.multiplier.toFixed(2)})`);
  }
  return result;
}

/** What a harvest would yield right now, for the UI. */
export function prestigeStatus(npub) {
  const player = db.prepare(
    'SELECT total_joints_earned, prestige_seeds FROM players WHERE npub = ?'
  ).get(npub);
  if (!player) return { seeds: 0, gain: 0, multiplier: 1, nextAt: 0 };

  const lifetime = player.total_joints_earned || 0;
  const seeds = player.prestige_seeds || 0;
  const gain = prestigeGain(lifetime, seeds);

  return { seeds, gain, multiplier: prestigeMultiplier(seeds), lifetime, nextAt: nextSeedAt(seeds + gain) };
}
