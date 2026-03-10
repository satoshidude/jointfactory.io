import { db } from './db.js';
import { checkReferralReward } from './auth.js';
import { publishReferralReward } from './zap.js';

function countManagers(gameState) {
  if (!gameState) return 0;
  let gs;
  try { gs = typeof gameState === 'string' ? JSON.parse(gameState) : gameState; } catch { return 0; }
  let count = 0;
  if (gs.plantagen?.[0]?.managerLevel > 0) count++;
  if (gs.courier?.mgrLevel > 0) count++;
  if (gs.fabrik?.mgrLevel > 0) count++;
  return count;
}

export function loadState(npub) {
  const player = db.prepare('SELECT * FROM players WHERE npub = ?').get(npub);
  if (!player) return null;

  let gameState = {};
  try { gameState = JSON.parse(player.game_state || '{}'); } catch(e) {}

  return {
    npub: player.npub,
    display_name: player.display_name,
    avatar: player.avatar,
    lightning_address: player.lightning_address,
    nip05: player.nip05,
    joints: player.joints,
    sats: player.sats,
    total_joints_earned: player.total_joints_earned,
    gameState,
  };
}

// Atomic saveState transaction
const _saveStateTx = db.transaction((npub, payload) => {
  const { gameState, joints, total_joints_earned, joints_per_sec, manager_sats_spent } = payload;

  // Manager purchase: deduct sats atomically and feed lottery pot
  const mgrSpent = Math.floor(manager_sats_spent || 0);
  if (mgrSpent > 0) {
    const mgrs = countManagers(gameState);
    if (mgrs >= 3) {
      // Atomic deduct — fails silently if not enough sats
      const deducted = db.prepare(`UPDATE players SET sats = sats - ? WHERE npub = ? AND sats >= ?`).run(mgrSpent, npub, mgrSpent);
      if (deducted.changes > 0) {
        db.prepare(`UPDATE lottery_rounds SET total_sats_collected = total_sats_collected + ? WHERE status = 'open'`).run(mgrSpent);
        console.log(`[Lottery] Adding ${mgrSpent} sats from ${npub.slice(0, 8)}... to pot`);
      }
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

  return { ok: true };
});

export function saveState(npub, payload) {
  const result = _saveStateTx(npub, payload);

  // Check referral reward outside transaction (async nostr publish can't be in tx)
  const referralResult = checkReferralReward(npub, payload.gameState);
  if (referralResult) {
    const buddy = db.prepare('SELECT display_name FROM players WHERE npub=?').get(npub);
    const referrer = db.prepare('SELECT display_name FROM players WHERE npub=?').get(referralResult.referrerNpub);
    publishReferralReward(referralResult.referrerNpub, referrer?.display_name, npub, buddy?.display_name)
      .catch(err => console.error('[invite] Referral reward note failed:', err.message));
  }

  return { ...result, referral_reward: referralResult || undefined };
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
