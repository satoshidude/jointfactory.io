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

const RELAY_URL = 'wss://relay.nsnip.io/';
const SITE_URL = 'https://jointfactory.nsnip.io';

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

function publishToRelay(event) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`[nostr] Relay timeout after 10s for event ${event.id}`));
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
            console.log(`[nostr] Event ${event.id} accepted by relay`);
            ws.close();
            resolve();
          } else {
            ws.close();
            reject(new Error(`[nostr] Relay rejected event: ${data[3] || 'unknown reason'}`));
          }
        }
      } catch {
        // ignore non-JSON messages
      }
    });

    ws.addEventListener('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`[nostr] WebSocket error: ${err.message || err}`));
    });

    ws.addEventListener('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
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
