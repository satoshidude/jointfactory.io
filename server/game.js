import { db } from './db.js';
import { rehydrate } from '../shared/economy.js';

export function loadState(npub) {
  const player = db.prepare('SELECT * FROM players WHERE npub = ?').get(npub);
  if (!player) return null;

  let gameState = {};
  try { gameState = JSON.parse(player.game_state || '{}'); } catch(e) {}
  // Definition fields (name, icon, baseProd, upgMult …) come from the defs, not
  // from the save — see rehydrate() in shared/economy.js.
  rehydrate(gameState);

  return {
    npub: player.npub,
    display_name: player.display_name,
    avatar: player.avatar,
    lightning_address: player.lightning_address,
    nip05: player.nip05,
    joints: player.joints,
    sats: player.sats,
    total_joints_earned: player.total_joints_earned,
    total_deposited: player.total_deposited || 0,
    speed_level: player.speed_level || 0,
    gameState,
  };
}

// Atomic saveState transaction
const _saveStateTx = db.transaction((npub, payload) => {
  const { gameState, joints, total_joints_earned, joints_per_sec, manager_sats_spent } = payload;
  let potUpdated = false;

  // Sats the client reports as spent this session — managers beyond the free
  // quota and speed upgrades. Deducted unconditionally.
  //
  // This used to be gated on `countManagers(gameState) >= 3`, counting only
  // plantation #1, courier and factory. Anyone who had not yet automated all
  // three got their purchases for free: the upgrade persisted in game_state
  // while the balance was never touched. The gate protected nothing — an
  // over-reported amount only costs the player their own sats, whereas the
  // skipped deduction handed out speed levels and managers for nothing.
  const mgrSpent = Math.floor(manager_sats_spent || 0);
  if (mgrSpent > 0) {
    // Atomic deduct — no-op when the balance does not cover it, in which case
    // the client keeps the amount pending and retries on the next save.
    const deducted = db.prepare(`UPDATE players SET sats = sats - ? WHERE npub = ? AND sats >= ?`).run(mgrSpent, npub, mgrSpent);
    if (deducted.changes > 0) {
      // Gross into the pot — the house cut is taken once, at payout.
      db.prepare(`UPDATE lottery_rounds SET total_sats_collected = total_sats_collected + ?
                  WHERE id = (SELECT id FROM lottery_rounds WHERE status = 'open' ORDER BY id DESC LIMIT 1)`).run(mgrSpent);
      console.log(`[Lottery] Adding ${mgrSpent} sats from ${npub.slice(0, 8)}... to pot`);
      potUpdated = true;
    } else {
      console.warn(`[Game] Spend of ${mgrSpent} sats by ${npub.slice(0, 12)}… exceeds balance — not deducted`);
    }
  }

  // Guard: reject saves that would reset a player's progress to zero
  const incomingTotal = Math.floor(total_joints_earned || 0);
  if (incomingTotal === 0) {
    const existing = db.prepare('SELECT total_joints_earned FROM players WHERE npub = ?').get(npub);
    if (existing && existing.total_joints_earned > 0) {
      console.warn(`[Game] BLOCKED state reset for ${npub.slice(0, 12)}… (server: ${existing.total_joints_earned}, incoming: 0)`);
      return { ok: false, reason: 'state_reset_blocked' };
    }
  }

  // Save game state — sats is NEVER written from client
  db.prepare(`
    UPDATE players SET
      game_state = ?,
      joints = ?,
      total_joints_earned = ?,
      joints_per_sec = ?,
      last_seen_at = unixepoch()
    WHERE npub = ?
  `).run(
    JSON.stringify(gameState || {}),
    Math.floor(joints || 0),
    Math.floor(total_joints_earned || 0),
    joints_per_sec || 0,
    npub
  );

  return { ok: true, potUpdated };
});

export function saveState(npub, payload) {
  return _saveStateTx(npub, payload);
}

// Atomic delete: remove player and all dependencies, keep invited buddies
const _deletePlayerTx = db.transaction((npub) => {
  const player = db.prepare('SELECT npub, display_name FROM players WHERE npub = ?').get(npub);
  if (!player) return { ok: false, reason: 'Player not found' };

  // Clear referral link for invited buddies (they stay, just lose the link)
  db.prepare('UPDATE players SET referred_by = NULL WHERE referred_by = ?').run(npub);

  // Delete from all dependent tables
  db.prepare('DELETE FROM lottery_tickets WHERE npub = ?').run(npub);
  db.prepare('DELETE FROM lightning_payments WHERE npub = ?').run(npub);
  db.prepare('DELETE FROM redemptions WHERE npub = ?').run(npub);
  db.prepare('DELETE FROM zap_receipts WHERE recipient_npub = ?').run(npub);
  db.prepare('DELETE FROM rate_log WHERE npub = ?').run(npub);
  db.prepare('DELETE FROM withdrawals WHERE npub = ?').run(npub);

  // Delete the player
  db.prepare('DELETE FROM players WHERE npub = ?').run(npub);

  console.log(`[Game] Deleted player ${player.display_name || npub.slice(0, 12)}`);
  return { ok: true, display_name: player.display_name };
});

export function deletePlayer(npub) {
  return _deletePlayerTx(npub);
}

export function updateProfile(npub, { display_name, avatar, lightning_address, nip05 }) {
  const fields = [];
  const vals = [];
  if (display_name !== undefined) { fields.push('display_name = ?'); vals.push(display_name); }
  if (avatar !== undefined) { fields.push('avatar = ?'); vals.push(avatar); }
  if (lightning_address !== undefined) { fields.push('lightning_address = ?'); vals.push(lightning_address); }
  if (nip05 !== undefined) { fields.push('nip05 = ?'); vals.push(nip05); }
  if (fields.length === 0) return { ok: false, reason: 'Nothing to update' };
  vals.push(npub);
  db.prepare(`UPDATE players SET ${fields.join(', ')} WHERE npub = ?`).run(...vals);
  return { ok: true };
}
