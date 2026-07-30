import { db, logEvent } from './db.js';
import { activateBoost } from './boosts.js';
import { countLotteryManagers, REQUIRED_MANAGERS } from '../shared/economy.js';
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
    logEvent(npub, 'signup', 0, { referred: !!referredBy });
    if (referredBy) logEvent(referredBy, 'invite_signup', 0, { buddy: npub });
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

/**
 * Referral reward: one hour of double output across the whole chain.
 *
 * It used to pay the referrer 20 sats once the invited player had deposited 50
 * — which put the only reward for inviting behind someone else's bitcoin, and
 * minted sats besides. The reward is now a Full Throttle boost, and the trigger
 * is the invited player automating their chain: three managers, all of them
 * free, so nobody has to spend anything for an invite to pay off.
 *
 * The hour is *claimable*, not automatic. A boost that starts by itself is
 * usually spent while the referrer is not looking, and an unclaimed tile in the
 * boost card is also how they find out someone took their link. Every buddy is
 * one tile: locked while that buddy is still setting up, clickable once they
 * automate, gone once collected. Several buddies mean several tiles, and
 * claiming them one after another stacks the duration.
 *
 * No cap on referrals.
 */
export const REFERRAL_BOOST = 'fullthrottle';

const _referralRewardTx = db.transaction((npub) => {
  const player = db.prepare(
    'SELECT referred_by, referral_rewarded, game_state FROM players WHERE npub = ?'
  ).get(npub);
  if (!player?.referred_by || player.referral_rewarded) return null;
  if (countLotteryManagers(player.game_state) < REQUIRED_MANAGERS) return null;

  // Atomic mark, so two concurrent saves cannot both unlock the same reward.
  const marked = db.prepare('UPDATE players SET referral_rewarded = 1 WHERE npub = ? AND referral_rewarded = 0').run(npub);
  if (marked.changes === 0) return null;

  const referrerNpub = player.referred_by;
  const rewardedCount = db.prepare('SELECT COUNT(*) as c FROM players WHERE referred_by = ? AND referral_rewarded = 1').get(referrerNpub)?.c || 0;
  logEvent(referrerNpub, 'invite_unlock', 0, { buddy: npub, nth: rewardedCount });
  console.log(`[Invite] Reward #${rewardedCount} unlocked for ${referrerNpub.slice(0, 8)}… — buddy ${npub.slice(0, 8)}… automated their chain`);
  return { referrerNpub, rewardedCount, buddyNpub: npub };
});

export function checkReferralReward(npub) {
  return _referralRewardTx(npub);
}

/**
 * The referrer's outstanding invite rewards, one entry per buddy who has not
 * been collected yet — including those still short of three managers, so the
 * tile appears the moment someone signs up through the link.
 */
export function listReferralBoosts(npub) {
  const rows = db.prepare(`
    SELECT npub, display_name, referral_rewarded, created_at, game_state
    FROM players WHERE referred_by = ? AND referral_claimed_at IS NULL
    ORDER BY referral_rewarded DESC, created_at
  `).all(npub);
  return rows.map(r => ({
    buddy_npub: r.npub,
    buddy_name: r.display_name || 'Buddy',
    managers: countLotteryManagers(r.game_state),
    required: REQUIRED_MANAGERS,
    ready: r.referral_rewarded === 1,
    created_at: r.created_at,
  }));
}

const _claimReferralBoostTx = db.transaction((npub, buddyNpub) => {
  // One statement decides it: the row moves out of the claimable set and nobody
  // else can take it, so a double click cannot collect the same hour twice.
  const claimed = db.prepare(`
    UPDATE players SET referral_claimed_at = unixepoch()
    WHERE npub = ? AND referred_by = ? AND referral_rewarded = 1 AND referral_claimed_at IS NULL
  `).run(buddyNpub, npub);
  if (claimed.changes === 0) return { ok: false, reason: 'Nothing to claim from this buddy' };

  const boost = activateBoost(npub, REFERRAL_BOOST, `invite by ${buddyNpub.slice(0, 8)}`);
  return { ok: true, boost };
});

export function claimReferralBoost(npub, buddyNpub) {
  if (!buddyNpub) return { ok: false, reason: 'No buddy given' };
  return _claimReferralBoostTx(npub, buddyNpub);
}
