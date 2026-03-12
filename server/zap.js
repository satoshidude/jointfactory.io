/**
 * Nostr publishing for Joint Factory
 *
 * Publishes Kind 1 notes and notifications to relay.nsnip.io
 * using the server's bot keypair (NOSTR_ZAP_NSEC).
 */

import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { finalizeEvent, getPublicKey, generateSecretKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RELAY_URLS = [
  'wss://relay.nsnip.io/',
  'wss://relay.damus.io/',
  'wss://nos.lol/',
  'wss://relay.snort.social/',
  'wss://relay.nostr.band/',
];
const RELAY_URL = RELAY_URLS[0]; // for deletePlayerEvents
const SITE_URL = 'https://jointfactory.io';

// ---------------------------------------------------------------------------
// Server keypair
// ---------------------------------------------------------------------------

let serverSecretKey;

if (process.env.NOSTR_ZAP_NSEC) {
  const decoded = nip19.decode(process.env.NOSTR_ZAP_NSEC);
  if (decoded.type !== 'nsec') {
    throw new Error('NOSTR_ZAP_NSEC must be a valid nsec-encoded private key');
  }
  serverSecretKey = decoded.data;
} else {
  serverSecretKey = generateSecretKey();
  const nsec = nip19.nsecEncode(serverSecretKey);
  console.warn(
    '[nostr] No NOSTR_ZAP_NSEC found in env — generated ephemeral keypair.\n' +
    `[nostr] To persist, set NOSTR_ZAP_NSEC=${nsec}`
  );
}

const serverPubkeyHex = getPublicKey(serverSecretKey);

// ---------------------------------------------------------------------------
// Database setup (kept for backwards compat — zap_receipts table)
// ---------------------------------------------------------------------------

let _db = null;

export function initZapDb(db) {
  _db = db;
  _db.exec(`
    CREATE TABLE IF NOT EXISTS zap_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER,
      recipient_npub TEXT,
      amount_sats INTEGER,
      nostr_event_id TEXT,
      nostr_event JSON,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);
}

// ---------------------------------------------------------------------------
// Relay publishing
// ---------------------------------------------------------------------------

function publishToSingleRelay(event, relayUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`[nostr] Relay timeout after 10s: ${relayUrl}`));
    }, 10_000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(['EVENT', event]));
    });

    ws.addEventListener('message', (msg) => {
      try {
        const data = JSON.parse(typeof msg.data === 'string' ? msg.data : msg.data.toString());
        if (Array.isArray(data) && data[0] === 'OK') {
          clearTimeout(timeout);
          if (data[2] === true) {
            console.log(`[nostr] Event ${event.id} accepted by ${relayUrl}`);
            ws.close();
            resolve();
          } else {
            ws.close();
            reject(new Error(`[nostr] Rejected by ${relayUrl}: ${data[3] || 'unknown'}`));
          }
        }
      } catch {
        // ignore non-JSON messages
      }
    });

    ws.addEventListener('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`[nostr] WebSocket error ${relayUrl}: ${err.message || err}`));
    });

    ws.addEventListener('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function publishToAllRelays(event) {
  const results = await Promise.allSettled(
    RELAY_URLS.map(url => publishToSingleRelay(event, url))
  );
  const accepted = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected');
  failed.forEach(r => console.warn(r.reason?.message || r.reason));
  console.log(`[nostr] Event ${event.id} broadcast: ${accepted}/${RELAY_URLS.length} relays accepted`);
  if (accepted === 0) throw new Error('[nostr] No relay accepted the event');
}

function publishToRelay(event) {
  return publishToAllRelays(event);
}

// ---------------------------------------------------------------------------
// Generic note publishing (Kind 1)
// ---------------------------------------------------------------------------

export async function publishNote(content, tags = []) {
  const note = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    content,
    tags: [
      ...tags,
      ['t', 'JointFactory'],
      ['t', 'Bitcoin'],
      ['t', 'Lightning'],
    ],
  }, serverSecretKey);

  await publishToRelay(note);
  console.log(`[nostr] Kind 1 note published: ${note.id}`);
  return note;
}

// ---------------------------------------------------------------------------
// Notification (tagged Kind 1 — shows as mention in clients)
// ---------------------------------------------------------------------------

export async function publishNotification(recipientHexPubkey, message) {
  const npubEncoded = nip19.npubEncode(recipientHexPubkey);
  return publishNote(
    `nostr:${npubEncoded} ${message}`,
    [['p', recipientHexPubkey]]
  );
}

// ---------------------------------------------------------------------------
// Welcome note for new players
// ---------------------------------------------------------------------------

// Welcome, invite, referral — no longer posted to relay (kept as no-ops for caller compat)
export async function publishWelcomeNote() {}
export async function publishInviteRegistered() {}
export async function publishReferralReward() {}

// ---------------------------------------------------------------------------
// Lottery win note — public announcement
// ---------------------------------------------------------------------------

export async function publishLotteryWinNote(roundId, winners) {
  if (!winners || winners.length === 0) return;
  const winnerLines = winners.map(w => {
    const npubEncoded = nip19.npubEncode(w.npub);
    return `nostr:${npubEncoded} — ${w.payout_sats.toLocaleString()} sats`;
  }).join('\n');
  const totalPot = winners.reduce((s, w) => s + w.payout_sats, 0);
  const tags = winners.map(w => ['p', w.npub]);

  await publishNote(
    `Lightning Lottery Round #${roundId} — ${totalPot.toLocaleString()} sats paid out! ⚡🎰\n\nWinners:\n${winnerLines}\n\n${SITE_URL}`,
    tags
  );
}

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

export function getServerPubkey() {
  return serverPubkeyHex;
}

// Delete all bot events that mention a player (p-tagged) from the relay
export async function deletePlayerEvents(hexPubkey) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_URL);
    const collected = [];
    const timeout = setTimeout(() => { ws.close(); resolve(collected); }, 8000);

    ws.on('open', () => {
      // Find all events from bot that tag this player
      ws.send(JSON.stringify(['REQ', 'cleanup', { authors: [serverPubkeyHex], '#p': [hexPubkey] }]));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[2]?.id) {
          collected.push(msg[2].id);
        }
        if (msg[0] === 'EOSE') {
          // Got all events, now send deletion events (Kind 5)
          if (collected.length === 0) {
            clearTimeout(timeout);
            ws.close();
            resolve([]);
            return;
          }
          const deleteEvent = finalizeEvent({
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            tags: collected.map(id => ['e', id]),
            content: 'Player account deleted',
          }, serverSecretKey);
          ws.send(JSON.stringify(['EVENT', deleteEvent]));
          console.log(`[nostr] Deleting ${collected.length} events for player ${hexPubkey.slice(0, 12)}`);
          setTimeout(() => { clearTimeout(timeout); ws.close(); resolve(collected); }, 2000);
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}


// ---------------------------------------------------------------------------
// Bot profile & relay list publishing (runs once on startup)
// ---------------------------------------------------------------------------

async function publishBotProfile() {
  try {
    const profile = finalizeEvent({
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify({
        name: 'jointfactory.io',
        about: 'Official Joint Factory Bot — Idle Tycoon Game on Nostr with Lightning Lottery ⚡\n\n🕐 Daily lottery draws at: 00:00 · 05:00 · 11:00 · 16:00 · 19:00 · 21:00 (Berlin time)\n\n🎮 Grow cannabis, roll joints, win sats! Check the webapp and all its amazing features!',
        picture: 'https://jointfactory.io/avatar.gif',
        banner: 'https://jointfactory.io/banner.jpg',
        nip05: 'jointfactory@nsnip.io',
        lud16: 'jointfactory@nsnip.io',
        website: 'https://jointfactory.io',
      }),
      tags: [],
    }, serverSecretKey);
    await publishToAllRelays(profile);
    console.log('[nostr] Bot profile (kind 0) published to all relays');

    // Publish relay list (NIP-65 kind 10002)
    const relayList = finalizeEvent({
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: RELAY_URLS.map(url => ['r', url, 'write']),
    }, serverSecretKey);
    await publishToAllRelays(relayList);
    console.log('[nostr] Bot relay list (kind 10002) published to all relays');
  } catch (err) {
    console.error('[nostr] Failed to publish bot profile:', err.message);
  }
}

// Publish on startup (delayed 5s to let connections settle)
setTimeout(publishBotProfile, 5000);

// ---------------------------------------------------------------------------
// Lottery reminder (1 hour before each draw)
// ---------------------------------------------------------------------------

import cron from 'node-cron';

let _reminderDb = null;
const _postedReminders = new Set();

export function initLotteryReminder(db) {
  _reminderDb = db;
  console.log('[nostr] Lottery reminder cron started');
}

// Check every minute if a draw is ~60 min away
cron.schedule('* * * * *', async () => {
  if (!_reminderDb) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now + 55 * 60;
    const windowEnd = now + 65 * 60;
    const round = _reminderDb.prepare(
      `SELECT id, draws_at, total_sats_collected FROM lottery_rounds WHERE status='open' AND draws_at >= ? AND draws_at <= ? LIMIT 1`
    ).get(windowStart, windowEnd);

    if (!round) return;
    if (_postedReminders.has(round.id)) return;
    _postedReminders.add(round.id);

    const potSats = round.total_sats_collected || 0;
    const potLine = potSats > 0
      ? `Current pot: ${potSats.toLocaleString()} sats \u2014 and growing.`
      : 'The pot is empty \u2014 be the first to roll and set the stakes!';

    const ticketCount = _reminderDb.prepare(
      `SELECT COUNT(*) as n FROM lottery_tickets WHERE round_id=?`
    ).get(round.id)?.n || 0;

    await publishNote(
      `\u26a1 Lightning Lottery draws in 1 hour!\n\n${potLine}\n${ticketCount} ticket${ticketCount !== 1 ? 's' : ''} in play.\n\nRoll your joints, grab your tickets and don\u2019t miss the draw!\n\n\ud83d\udc49 ${SITE_URL}`,
      []
    );
    console.log(`[nostr] Lottery reminder posted for round ${round.id}`);
  } catch (err) {
    console.error('[nostr] Lottery reminder error:', err.message);
  }
});
