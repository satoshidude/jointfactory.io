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
      INSERT INTO players (npub, display_name, sats, joints, invite_code, referred_by, referral_rewarded) VALUES (?, ?, 0, 0, ?, ?, 0)
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

// Atomic referral reward — triggered when referred user deposits 50+ sats
// Only the referrer gets 20 sats. The referred user gets nothing (must invite others themselves).
// No cap on number of referrals.
const _referralRewardTx = db.transaction((npub) => {
  const player = db.prepare('SELECT referred_by, referral_rewarded, total_deposited FROM players WHERE npub = ?').get(npub);
  if (!player?.referred_by || player.referral_rewarded) return null;
  if (player.total_deposited < 50) return null;

  // Atomic mark
  const marked = db.prepare('UPDATE players SET referral_rewarded = 1 WHERE npub = ? AND referral_rewarded = 0').run(npub);
  if (marked.changes === 0) return null;

  const referrerNpub = player.referred_by;

  // Reward: only the referrer gets 20 sats
  db.prepare('UPDATE players SET sats = sats + 20 WHERE npub = ?').run(referrerNpub);

  const rewardedCount = db.prepare('SELECT COUNT(*) as c FROM players WHERE referred_by = ? AND referral_rewarded = 1').get(referrerNpub)?.c || 0;
  console.log(`[Invite] Reward #${rewardedCount} for ${referrerNpub.slice(0, 8)}... (buddy: ${npub.slice(0, 8)}... deposited ${player.total_deposited} sats) +20 sats to referrer`);
  return { referrerNpub, rewardedCount, buddyNpub: npub };
});

export function checkReferralReward(npub) {
  return _referralRewardTx(npub);
}
