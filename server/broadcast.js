/**
 * Owner broadcast — one Nostr DM per player, sent by hand from the admin page.
 *
 * The reason this is a module and not a loop in a route: a broadcast is the one
 * thing in the game that cannot be taken back. Thirty-four encrypted DMs land in
 * real inboxes, and a relay hiccup halfway through used to mean either giving up
 * or messaging the first half twice. So:
 *
 *  - every send is written to `dm_log` under a campaign name, with a UNIQUE
 *    constraint on (campaign, npub). Re-running a campaign skips whoever already
 *    has it and picks up where it stopped.
 *  - `recipients()` answers who *would* get it, so the page can show the list and
 *    the count before anything is sent.
 *  - dry runs go through the identical path and stop short of the relay.
 *
 * NIP-04 rather than NIP-17: it is what the bot already uses for owner reports,
 * and what every client in the players' hands can decrypt today.
 */

import { nip04, finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { db, logEvent } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS dm_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign TEXT NOT NULL,
    npub TEXT NOT NULL,
    event_id TEXT,
    sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (campaign, npub)
  );
`);

/**
 * Players who can be written to, newest first. Bot accounts and malformed
 * pubkeys are out, and so is the sender: the bot has a player row of its own, and
 * counting it made the "will receive" figure on the page one too high.
 *
 * @param {string} campaign name whose send state to report
 * @param {string} [self]   sender's hex pubkey, excluded from the list
 */
export function recipients(campaign, self = null) {
  return db.prepare(`
    SELECT p.npub, p.display_name, p.last_seen_at, p.created_at,
           (SELECT sent_at FROM dm_log WHERE dm_log.campaign = ? AND dm_log.npub = p.npub) AS sent_at
    FROM players p
    WHERE COALESCE(p.is_bot, 0) = 0
      AND LENGTH(p.npub) = 64
      AND p.npub IS NOT ?
    ORDER BY p.last_seen_at DESC
  `).all(campaign || '', self);
}

/** What a campaign has done so far. */
export function campaigns() {
  return db.prepare(`
    SELECT campaign, COUNT(*) AS sent, MAX(sent_at) AS last_sent
    FROM dm_log GROUP BY campaign ORDER BY last_sent DESC
  `).all();
}

/**
 * Send one DM per player who has not had this campaign yet.
 *
 * @param {object} opts
 * @param {string} opts.message   plain text; `{name}` is replaced per recipient
 * @param {string} opts.campaign  name that makes the send idempotent
 * @param {boolean} [opts.dryRun] resolve everything, send nothing
 * @param {number} [opts.limit]   stop after n recipients (a first test run)
 * @param {string[]} [opts.only]  restrict to these hex pubkeys
 * @param {(event: object) => Promise<void>} publish  relay publisher
 * @param {Uint8Array} secretKey  bot key
 */
export async function sendBroadcast({ message, campaign, dryRun = true, limit = 0, only = null }, publish, secretKey) {
  if (!message?.trim()) return { ok: false, reason: 'Message is empty' };
  if (!campaign?.trim()) return { ok: false, reason: 'Name the campaign — it is what stops a double send' };
  if (!secretKey) return { ok: false, reason: 'Bot key missing (NOSTR_ZAP_NSEC)' };

  const from = getPublicKey(secretKey);
  let queue = recipients(campaign, from).filter(r => !r.sent_at);
  if (only?.length) queue = queue.filter(r => only.includes(r.npub));
  if (limit > 0) queue = queue.slice(0, limit);

  const results = [];
  for (const r of queue) {
    const name = r.display_name || 'grower';
    const text = message.replaceAll('{name}', name);
    try {
      const content = await nip04.encrypt(secretKey, r.npub, text);
      const event = finalizeEvent({
        kind: 4,
        created_at: Math.floor(Date.now() / 1000),
        content,
        tags: [['p', r.npub]],
      }, secretKey);

      if (dryRun) {
        results.push({ npub: r.npub, name, ok: true, dry_run: true });
        continue;
      }

      await publish(event);
      // Written after the relay accepted, so a failure can be retried rather
      // than silently marked done.
      db.prepare('INSERT OR IGNORE INTO dm_log (campaign, npub, event_id) VALUES (?, ?, ?)')
        .run(campaign, r.npub, event.id);
      logEvent(r.npub, 'dm', 0, { campaign });
      results.push({ npub: r.npub, name, ok: true, event_id: event.id });

      // Relays throttle bursts, and thirty-odd DMs in one breath look like spam.
      await new Promise(res => setTimeout(res, 700));
    } catch (err) {
      results.push({ npub: r.npub, name, ok: false, error: err.message });
    }
  }

  const sent = results.filter(r => r.ok).length;
  console.log(`[Broadcast] ${campaign}: ${dryRun ? 'dry run over' : 'sent to'} ${sent}/${queue.length}`);
  return {
    ok: true,
    dry_run: dryRun,
    campaign,
    queued: queue.length,
    sent,
    failed: results.filter(r => !r.ok).length,
    results: results.map(r => ({ ...r, npub_bech32: nip19.npubEncode(r.npub) })),
  };
}
