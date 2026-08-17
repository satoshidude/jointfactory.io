/**
 * One client at a time.
 *
 * Two clients logged into the same account both run the chain and both post the
 * state they believe in. Neither is wrong from where it stands, but the server
 * has one row: the save guard clamps each against what the other stored, and an
 * upgrade bought in one is invisible to the other, which buys it again. A live
 * account paid for the same capacity step nine times in an hour and had 137
 * million joints clamped away across 83 saves.
 *
 * So the newest client owns the account and the others stop writing. The id is
 * minted per page load rather than per login, because two tabs on one machine
 * share a token and are exactly the case nobody notices.
 *
 * Reads are never blocked — an older tab can still show the wallet, the boards
 * and its own frozen chain. Only writing is exclusive.
 */

import { db, logEvent } from './db.js';

/** Make this client the owner. Last claim wins, which is the whole rule. */
export function claimSession(npub, sessionId) {
  if (!npub || !sessionId) return false;
  const player = db.prepare(
    'SELECT last_seen_at, COALESCE(is_bot, 0) AS is_bot FROM players WHERE npub = ?'
  ).get(npub);
  if (!player) return false;

  const now = Math.floor(Date.now() / 1000);
  const away = player.last_seen_at == null ? null : Math.max(0, now - player.last_seen_at);

  // `active` means one real session start, not "some event had an npub". The
  // claim is the first authenticated action on every page load and still has
  // the previous last_seen_at; auth used to overwrite that timestamp before the
  // save path could measure the absence, so genuine returns disappeared.
  // Reloads and tab takeovers inside thirty minutes remain the same analytical
  // session. Bots never enter product metrics.
  if (!player.is_bot && (away == null || away > 1800)) {
    logEvent(npub, 'active', 0, {
      away_hours: away == null ? null : Math.round(away / 360) / 10,
      source: 'claim',
    });
  }

  db.prepare(`UPDATE players SET active_session = ?, active_session_at = ?, last_seen_at = ?
              WHERE npub = ?`).run(sessionId, now, now, npub);
  return true;
}

/**
 * May this client write?
 *
 * An account that has never claimed has no owner yet, and an old client that
 * never sent an id would otherwise be locked out of its own account by a
 * deployment — so both cases pass, and the first save claims.
 */
export function isMasterSession(npub, sessionId) {
  const row = db.prepare('SELECT active_session FROM players WHERE npub = ?').get(npub);
  if (!row) return true;
  if (!row.active_session) { if (sessionId) claimSession(npub, sessionId); return true; }
  if (!sessionId) return true;
  return row.active_session === sessionId;
}
