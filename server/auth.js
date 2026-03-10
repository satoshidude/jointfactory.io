import { db } from './db.js';
import { verifyEvent } from 'nostr-tools';

// Fantasy name generator (6-10 chars)
const PREFIXES = [
  'Blaze','Kush','Haze','Dank','Bud','Leaf','Hash','Ganja','Herb','Smoke',
  'Cloud','Zen','Nug','Riff','Sage','Jade','Nova','Lux','Rex','Ash',
  'Bolt','Flux','Grim','Jinx','Knox','Lynx','Onyx','Pyro','Vex','Zion',
];
const SUFFIXES = [
  'ling','fox','wolf','kin','zen','run','sky','mix','den','fin',
  'ton','dale','son','man','ace','wick','wood','burn','more','ley',
];
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateFantasyName() {
  const pre = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  const suf = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
  const name = pre + suf;
  if (name.length >= 6 && name.length <= 10) return name;
  return name.slice(0, 10);
}

// Backfill existing players without display_name
const nameless = db.prepare(`SELECT npub FROM players WHERE display_name IS NULL OR display_name = ''`).all();
for (const row of nameless) {
  const name = generateFantasyName();
  db.prepare(`UPDATE players SET display_name = ? WHERE npub = ?`).run(name, row.npub);
  console.log('[Auth] Backfill name:', row.npub.slice(0, 16) + '...', '->', name);
}

// Verify a NIP-98 HTTP Auth event
// event = { kind:27235, pubkey, created_at, tags, content, sig, id }
export async function verifyNostrAuth(event) {
  try {
    if (event.kind !== 27235) return { ok: false, reason: 'wrong kind' };
    const age = Math.floor(Date.now() / 1000) - event.created_at;
    if (age > 60 || age < -10) return { ok: false, reason: 'event too old or future' };
    if (!verifyEvent(event)) return { ok: false, reason: 'invalid signature' };
    return { ok: true, npub: event.pubkey };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Get or create player by npub
export function getOrCreatePlayer(npub, referralCode) {
  let player = db.prepare('SELECT * FROM players WHERE npub = ?').get(npub);
  let is_new = false;
  if (!player) {
    const name = generateFantasyName();
    const inviteCode = generateInviteCode();
    // Check referral — cap at 10 referrals per inviter
    let referredBy = null;
    if (referralCode) {
      const referrer = db.prepare('SELECT npub FROM players WHERE invite_code = ?').get(referralCode);
      if (referrer && referrer.npub !== npub) {
        const refCount = db.prepare('SELECT COUNT(*) as c FROM players WHERE referred_by = ?').get(referrer.npub)?.c || 0;
        if (refCount < 10) {
          referredBy = referrer.npub;
        }
      }
    }
    db.prepare(`
      INSERT INTO players (npub, display_name, sats, joints, invite_code, referred_by, referral_rewarded) VALUES (?, ?, 40, 0, ?, ?, 0)
    `).run(npub, name, inviteCode, referredBy);
    player = db.prepare('SELECT * FROM players WHERE npub = ?').get(npub);
    is_new = true;
    console.log('[Auth] New player:', npub.slice(0, 16) + '...', 'name:', name, 'invite:', inviteCode, referredBy ? 'ref:' + referredBy.slice(0, 8) : '');
  }
  // Backfill invite_code for existing players
  if (player && !player.invite_code) {
    const code = generateInviteCode();
    db.prepare('UPDATE players SET invite_code = ? WHERE npub = ?').run(code, npub);
    player.invite_code = code;
  }
  db.prepare('UPDATE players SET last_seen_at = unixepoch() WHERE npub = ?').run(npub);
  return { player, is_new };
}

// Atomic referral reward transaction
const MAX_REFERRALS = 10;
const _referralRewardTx = db.transaction((npub, gameState) => {
  // Atomic check: only reward if referral_rewarded = 0 (prevents double-reward)
  const player = db.prepare('SELECT referred_by, referral_rewarded FROM players WHERE npub = ?').get(npub);
  if (!player?.referred_by || player.referral_rewarded) return null;

  // Verify managers from server-side game_state (not client-provided)
  const serverPlayer = db.prepare('SELECT game_state FROM players WHERE npub = ?').get(npub);
  let gs;
  try { gs = JSON.parse(serverPlayer?.game_state || '{}'); } catch { return null; }
  let mgrs = 0;
  if (gs.plantagen?.[0]?.managerLevel > 0) mgrs++;
  if (gs.courier?.mgrLevel > 0) mgrs++;
  if (gs.fabrik?.mgrLevel > 0) mgrs++;
  if (mgrs < 3) return null;

  // Atomic mark + reward: UPDATE ... WHERE referral_rewarded = 0 prevents race
  const marked = db.prepare('UPDATE players SET referral_rewarded = 1 WHERE npub = ? AND referral_rewarded = 0').run(npub);
  if (marked.changes === 0) return null; // another request already rewarded

  const referrerNpub = player.referred_by;
  const rewardedCount = db.prepare('SELECT COUNT(*) as c FROM players WHERE referred_by = ? AND referral_rewarded = 1').get(referrerNpub)?.c || 0;
  if (rewardedCount > MAX_REFERRALS) return null;

  if (rewardedCount === 1) {
    grantFreeManager(referrerNpub);
  }

  db.prepare('UPDATE players SET sats = sats + 10 WHERE npub = ?').run(referrerNpub);
  db.prepare('UPDATE players SET sats = sats + 10 WHERE npub = ?').run(npub);

  console.log(`[Invite] Reward #${rewardedCount} for ${referrerNpub.slice(0, 8)}... (buddy: ${npub.slice(0, 8)}...) +10 sats each`);
  return { referrerNpub, rewardedCount, buddyNpub: npub };
});

export function checkReferralReward(npub, gameState) {
  return _referralRewardTx(npub, gameState);
}

// Grant a free auto-manager (next unmanaged station)
function grantFreeManager(npub) {
  const row = db.prepare('SELECT game_state FROM players WHERE npub = ?').get(npub);
  if (!row?.game_state) return;
  try {
    const gs = typeof row.game_state === 'string' ? JSON.parse(row.game_state) : row.game_state;
    if (gs.plantagen?.[0]?.managerLevel === 0) {
      gs.plantagen[0].managerLevel = 1;
    } else if (gs.courier?.mgrLevel === 0) {
      gs.courier.mgrLevel = 1;
    } else if (gs.fabrik?.mgrLevel === 0) {
      gs.fabrik.mgrLevel = 1;
    } else {
      return;
    }
    db.prepare('UPDATE players SET game_state = ? WHERE npub = ?').run(JSON.stringify(gs), npub);
  } catch (e) {
    console.error('[Invite] Failed to grant manager:', e.message);
  }
}
