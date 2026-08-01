import { db, logEvent } from './db.js';
import { getActiveBoosts } from './boosts.js';
import { rehydrate, throughput, countManagers } from '../shared/economy.js';

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
    joints_rev: player.joints_rev || 0,
    gameState,
  };
}

// Atomic saveState transaction
const _saveStateTx = db.transaction((npub, payload) => {
  const { gameState, joints, total_joints_earned, joints_per_sec, manager_sats_spent, joints_rev } = payload;
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
      // Managers are the only sats spend the client reports rather than requests,
      // so this is where that money becomes visible to the analytics.
      logEvent(npub, 'manager', mgrSpent, { managers: countManagers(gameState) });
      potUpdated = true;
    } else {
      console.warn(`[Game] Spend of ${mgrSpent} sats by ${npub.slice(0, 12)}… exceeds balance — not deducted`);
    }
  }

  const existing = db.prepare(
    'SELECT joints, total_joints_earned, speed_level, last_seen_at, joints_rev FROM players WHERE npub = ?'
  ).get(npub);

  // One row per player per session, for retention: last_seen_at only ever holds
  // the latest visit, so how often anyone came back was unrecoverable. A gap of
  // half an hour counts as a new session.
  if (existing && (Math.floor(Date.now() / 1000) - (existing.last_seen_at || 0)) > 1800) {
    logEvent(npub, 'active', 0, { away_hours: Math.round((Date.now() / 1000 - (existing.last_seen_at || 0)) / 360) / 10 });
  }

  // Guard: reject saves that would reset a player's progress to zero
  const incomingTotal = Math.floor(total_joints_earned || 0);
  if (incomingTotal === 0 && existing && existing.total_joints_earned > 0) {
    console.warn(`[Game] BLOCKED state reset for ${npub.slice(0, 12)}… (server: ${existing.total_joints_earned}, incoming: 0)`);
    return { ok: false, reason: 'state_reset_blocked' };
  }

  // Cap the reported balance at what the stored one could plausibly have grown
  // into since the last save.
  //
  // The client owns its joint count and posts an absolute figure. Without a cap
  // any server-side deduction is undone by the very next autosave — buying a
  // ticket or a speed level appeared to cost nothing, because thirty seconds
  // later the client reported the balance it still believed it had. It is also
  // the cheat surface: joints convert to real sats through the lottery.
  //
  // Generous on purpose. The factor covers boosts and clock drift, and the flat
  // term keeps small balances from tripping over rounding; the point is to bound
  // the number, not to recompute it.
  let plausible = Math.floor(joints || 0);

  // A purchase made since the client last read its balance bumps joints_rev.
  // The client echoes the revision it knows; a mismatch means it is about to
  // post a figure from before the deduction, so the balance stays as it is and
  // the rest of the state still saves. Without this a ticket or speed purchase
  // refunded itself on the next autosave — the plausibility ceiling below is
  // far too generous to catch it, by design.
  const reported = plausible;
  const staleBalance = existing && joints_rev !== undefined && joints_rev !== existing.joints_rev;
  if (staleBalance) {
    console.warn(`[Game] Stale balance from ${npub.slice(0, 12)}… (rev ${joints_rev} vs ${existing.joints_rev}) — keeping server figure`);
    plausible = existing.joints;
  } else if (existing) {
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - (existing.last_seen_at || 0));
    let rate = 0;
    try {
      // Boosts count towards what is plausible. Express Run alone triples the
      // courier, and a chain bottlenecked there legitimately produces three
      // times the unboosted rate — right at the old headroom, so an honest
      // boosted player was being clamped and quietly losing what they earned.
      rate = throughput(gameState, {
        speedLevel: existing.speed_level || 0,
        boosts: getActiveBoosts(npub),
        nowSec: Math.floor(Date.now() / 1000),
        // What the chain could do with every station running, not just the
        // automated ones: tapping by hand is legitimate production, and a
        // player who has not hired all three managers had a modelled rate of
        // zero — so everything they earned by hand was clamped away.
        ignoreManagers: true,
      }).jointsPerSec;
    } catch { /* no output */ }
    const ceiling = existing.joints + rate * elapsed * 3 + 1000;
    if (plausible > ceiling) {
      console.warn(`[Game] Clamped joints for ${npub.slice(0, 12)}…: reported ${plausible}, ceiling ${Math.floor(ceiling)}`);
      plausible = Math.floor(ceiling);
    }
  }

  // Whatever the server decided is what the account has. Telling the client is
  // the half that was missing: a clamped client kept its own inflated figure,
  // re-posted it every thirty seconds, and showed a balance that did not exist.
  // Purchases then failed for "not enough joints" against a number the player
  // could see on screen — which reads as being robbed, not as being corrected.
  const corrected = plausible !== reported;
  if (corrected) logEvent(npub, 'clamp', reported - plausible, { reported, kept: plausible, stale: !!staleBalance });

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
    plausible,
    Math.floor(total_joints_earned || 0),
    joints_per_sec || 0,
    npub
  );

  const rev = db.prepare('SELECT joints_rev FROM players WHERE npub = ?').get(npub)?.joints_rev ?? 0;
  return { ok: true, potUpdated, joints: plausible, joints_rev: rev, corrected };
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
