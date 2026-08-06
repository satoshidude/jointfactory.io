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

import { db } from './db.js';

/** Make this client the owner. Last claim wins, which is the whole rule. */
export function claimSession(npub, sessionId) {
  if (!npub || !sessionId) return false;
  db.prepare('UPDATE players SET active_session = ?, active_session_at = unixepoch() WHERE npub = ?')
    .run(sessionId, npub);
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
