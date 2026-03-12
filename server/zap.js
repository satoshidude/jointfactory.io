/**
 * Nostr publishing for Joint Factory
 *
 * Publishes Kind 1 notes and notifications to relay.nsnip.io
 * using the server's bot keypair (NOSTR_ZAP_NSEC).
 */

import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { finalizeEvent, getPublicKey, generateSecretKey } from 'nostr-tools/pure';
import { nip04, nip19 } from 'nostr-tools';
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

const MAX_WIN_NOTES = 6;
const KV_WIN_NOTES_KEY = 'win_note_ids';

function loadWinNoteIds(db) {
  const row = db.prepare('SELECT value FROM kv_store WHERE key=?').get(KV_WIN_NOTES_KEY);
  try { return row ? JSON.parse(row.value) : []; } catch { return []; }
}

function saveWinNoteIds(db, ids) {
  db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(KV_WIN_NOTES_KEY, JSON.stringify(ids));
}

async function deleteOldestWinNote(db, ids) {
  while (ids.length > MAX_WIN_NOTES) {
    const oldId = ids.shift();
    try {
      const deleteEvent = finalizeEvent({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        content: 'Rotating old winner announcement',
        tags: [['e', oldId]],
      }, serverSecretKey);
      await publishToAllRelays(deleteEvent);
      console.log(`[nostr] Deleted old win note ${oldId}`);
    } catch (err) {
      console.error('[nostr] Failed to delete old win note:', err.message);
    }
  }
  saveWinNoteIds(db, ids);
}

export async function publishLotteryWinNote(roundId, winners) {
  if (!winners || winners.length === 0) return;
  if (!_reminderDb) return;
  const winnerLines = winners.map(w => {
    const npubEncoded = nip19.npubEncode(w.npub);
    return `nostr:${npubEncoded} — ${w.payout_sats.toLocaleString()} sats`;
  }).join('\n');
  const totalPot = winners.reduce((s, w) => s + w.payout_sats, 0);
  const tags = winners.map(w => ['p', w.npub]);

  const note = await publishNote(
    `Lightning Lottery Round #${roundId} — ${totalPot.toLocaleString()} sats paid out! ⚡🎰\n\nWinners:\n${winnerLines}\n\n${SITE_URL}`,
    tags
  );

  const ids = loadWinNoteIds(_reminderDb);
  ids.push(note.id);
  await deleteOldestWinNote(_reminderDb, ids);
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
        about: 'Official Joint Factory Bot — Idle Tycoon Game on Nostr with Lightning Lottery ⚡\n\n🕐 Daily lottery draws at: 00:00 · 05:00 · 11:00 · 16:00 · 19:00 · 21:00 (Berlin time)\n\n🎮 Grow cannabis, transport weed, roll joints, win sats! Check the webapp and all its amazing features!',
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
// Lottery reminders (2h + 1h before each draw, deleted after draw)
// ---------------------------------------------------------------------------

import cron from 'node-cron';

let _reminderDb = null;
const _postedReminders = new Set(); // tracks "roundId-hours" keys
const _reminderEventIds = new Map(); // roundId -> [eventId, ...]

export function initLotteryReminder(db) {
  _reminderDb = db;
  console.log('[nostr] Lottery reminder cron started');
}

async function deleteReminderEvents(roundId) {
  const eventIds = _reminderEventIds.get(roundId);
  if (!eventIds || eventIds.length === 0) return;

  try {
    const deleteEvent = finalizeEvent({
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      content: 'Lottery draw completed',
      tags: eventIds.map(id => ['e', id]),
    }, serverSecretKey);
    await publishToAllRelays(deleteEvent);
    console.log(`[nostr] Deleted ${eventIds.length} reminder(s) for round ${roundId}`);
  } catch (err) {
    console.error('[nostr] Failed to delete reminders:', err.message);
  }
  _reminderEventIds.delete(roundId);
}

async function postReminder(round, hoursLabel) {
  const potSats = round.total_sats_collected || 0;
  const potLine = potSats > 0
    ? `Current pot: ${potSats.toLocaleString()} sats \u2014 and growing.`
    : 'The pot is empty \u2014 be the first to roll and set the stakes!';

  const ticketCount = _reminderDb.prepare(
    `SELECT COUNT(*) as n FROM lottery_tickets WHERE round_id=?`
  ).get(round.id)?.n || 0;

  const note = await publishNote(
    `\u26a1 Lightning Lottery draws in ${hoursLabel}!\n\n${potLine}\n${ticketCount} ticket${ticketCount !== 1 ? 's' : ''} in play.\n\nRoll your joints, grab your tickets and don\u2019t miss the draw!\n\n\ud83d\udc49 ${SITE_URL}`,
    []
  );

  // Track event ID for deletion after draw
  if (!_reminderEventIds.has(round.id)) _reminderEventIds.set(round.id, []);
  _reminderEventIds.get(round.id).push(note.id);

  console.log(`[nostr] Lottery reminder (${hoursLabel}) posted for round ${round.id}`);
}

// ---------------------------------------------------------------------------
// Fake player activity — makes lottery feel alive
// ---------------------------------------------------------------------------

const FAKE_PLAYERS = [
  '7bebd0175ed4a651', // Boyscout
  '7bea3415250cd3c3', // nostr
  '7bdf58828dfcad13', // gorilla
  '7beb9ce8fd686641', // Akki
  '7bdef1f1bd4c153c', // donation 4 nsnip
  'b77d48c5a7e7615c', // Blazedale
  '7be60abd4525c70a', // relaymaster
];
const FAKE_POT_AMOUNTS = [8, 12, 21];
const _scheduledFakeRounds = new Set();

function pickRandom(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function scheduleFakePlayers(round) {
  if (_scheduledFakeRounds.has(round.id)) return;
  // Play every 2nd or 3rd round (~40% chance)
  if (Math.random() > 0.45) return;
  _scheduledFakeRounds.add(round.id);

  const db = _reminderDb;
  const drawsAt = round.draws_at * 1000; // ms
  const playerCount = Math.random() < 0.5 ? 2 : 3;
  const players = pickRandom(FAKE_PLAYERS, playerCount);

  // Schedule: last player at -5min, each previous +20min earlier
  // e.g. 3 players: -45min, -25min, -5min
  players.forEach((npub, i) => {
    const minutesBefore = 5 + (playerCount - 1 - i) * 20;
    const buyAt = drawsAt - minutesBefore * 60 * 1000;
    const delay = Math.max(0, buyAt - Date.now());

    setTimeout(() => {
      try {
        const currentRound = db.prepare(`SELECT id, status FROM lottery_rounds WHERE id=?`).get(round.id);
        if (!currentRound || currentRound.status !== 'open') return;

        // Find full npub
        const player = db.prepare(`SELECT npub, joints FROM players WHERE npub LIKE ?`).get(npub + '%');
        if (!player) return;

        let myCount = db.prepare(`SELECT COUNT(*) as n FROM lottery_tickets WHERE round_id=? AND npub=?`).get(round.id, player.npub)?.n || 0;
        if (myCount > 0) return; // already bought this round

        const CURVE = [500,1200,2500,4000,7000,5000,3500,9000,15000,25000,40000,70000,120000,200000,350000,600000,1000000,1700000,2800000,4500000,7500000];
        const targetTickets = 3 + Math.floor(Math.random() * 10); // 3-12
        let bought = 0;

        for (let t = 0; t < targetTickets; t++) {
          const costIdx = Math.min(myCount, CURVE.length - 1);
          const cost = CURVE[costIdx];
          const currentJoints = db.prepare('SELECT joints FROM players WHERE npub=?').get(player.npub)?.joints || 0;
          if (currentJoints < cost) break;

          db.prepare('UPDATE players SET joints = joints - ? WHERE npub = ? AND joints >= ?').run(cost, player.npub, cost);
          db.prepare('INSERT INTO lottery_tickets (round_id, npub, joints_cost) VALUES (?, ?, ?)').run(round.id, player.npub, cost);
          myCount++;
          bought++;
        }

        if (bought > 0) console.log(`[Fake] ${player.npub.slice(0,12)} bought ${bought} ticket(s) for round ${round.id}`);
      } catch (err) {
        console.error('[Fake] ticket buy error:', err.message);
      }
    }, delay);
  });

  // Fill pot if empty — 65min before draw (before 1h reminder)
  const fillAt = drawsAt - 65 * 60 * 1000;
  const fillDelay = Math.max(0, fillAt - Date.now());
  setTimeout(() => {
    try {
      const r = db.prepare(`SELECT id, total_sats_collected, status FROM lottery_rounds WHERE id=?`).get(round.id);
      if (!r || r.status !== 'open') return;
      if (r.total_sats_collected > 0) return;
      const amount = FAKE_POT_AMOUNTS[Math.floor(Math.random() * FAKE_POT_AMOUNTS.length)];
      db.prepare(`UPDATE lottery_rounds SET total_sats_collected = total_sats_collected + ? WHERE id=?`).run(amount, round.id);
      console.log(`[Fake] Seeded pot with ${amount} sats for round ${round.id}`);
    } catch (err) {
      console.error('[Fake] pot seed error:', err.message);
    }
  }, fillDelay);
}

// Check every minute for upcoming draws and completed draws
cron.schedule('* * * * *', async () => {
  if (!_reminderDb) return;
  try {
    const now = Math.floor(Date.now() / 1000);

    // Post reminders at 2h and 1h before draw
    for (const { minutes, label } of [{ minutes: 120, label: '2 hours' }, { minutes: 60, label: '1 hour' }]) {
      const windowStart = now + (minutes - 5) * 60;
      const windowEnd = now + (minutes + 5) * 60;
      const round = _reminderDb.prepare(
        `SELECT id, draws_at, total_sats_collected FROM lottery_rounds WHERE status='open' AND draws_at >= ? AND draws_at <= ? LIMIT 1`
      ).get(windowStart, windowEnd);

      if (!round) continue;
      const key = `${round.id}-${minutes}`;
      if (_postedReminders.has(key)) continue;
      _postedReminders.add(key);

      // Schedule fake players at 2h mark
      if (minutes === 120) scheduleFakePlayers(round);

      await postReminder(round, label);
    }

    // Delete reminders for recently completed draws
    const recentlyDrawn = _reminderDb.prepare(
      `SELECT id FROM lottery_rounds WHERE status='drawn' AND draws_at >= ? AND draws_at <= ?`
    ).all(now - 10 * 60, now);

    for (const round of recentlyDrawn) {
      if (_reminderEventIds.has(round.id)) {
        await deleteReminderEvents(round.id);
      }
    }
  } catch (err) {
    console.error('[nostr] Lottery reminder error:', err.message);
  }
});

// ---------------------------------------------------------------------------
// New user report DM to satoshidude (3x daily)
// ---------------------------------------------------------------------------

const OWNER_HEX = '661419f8f48b1b496e2249aee97a6ad9d5bea907149dc7bf3eb7479f2bce555e';
const KV_LAST_REPORT_KEY = 'last_user_report_ts';

// Runs at 08:00, 16:00, 22:00 Berlin time
cron.schedule('0 8,16,22 * * *', async () => {
  if (!_reminderDb) return;
  try {
    const db = _reminderDb;

    // Get last report timestamp
    const lastRow = db.prepare('SELECT value FROM kv_store WHERE key=?').get(KV_LAST_REPORT_KEY);
    const lastTs = lastRow ? parseInt(lastRow.value, 10) : 0;
    const now = Math.floor(Date.now() / 1000);

    // Find new players since last report (exclude fake players and bot)
    const fakePubs = [...FAKE_PLAYERS, 'f77c382998682053'];
    const newPlayers = db.prepare(
      `SELECT npub, display_name, created_at FROM players WHERE created_at > ? ORDER BY created_at ASC`
    ).all(lastTs);

    const realNew = newPlayers.filter(p => !fakePubs.some(f => p.npub.startsWith(f)));

    if (realNew.length === 0) return; // nothing to report

    const lines = realNew.map(p => {
      const npubEncoded = nip19.npubEncode(p.npub);
      const name = p.display_name || 'anon';
      return `- ${name}: ${SITE_URL}/u/${npubEncoded}`;
    });

    const msg = `New player${realNew.length > 1 ? 's' : ''} (${realNew.length}) since last report:\n\n${lines.join('\n')}`;

    // Encrypt and send NIP-04 DM
    const encrypted = await nip04.encrypt(serverSecretKey, OWNER_HEX, msg);
    const dm = finalizeEvent({
      kind: 4,
      created_at: now,
      content: encrypted,
      tags: [['p', OWNER_HEX]],
    }, serverSecretKey);
    await publishToAllRelays(dm);
    console.log(`[nostr] DM sent to owner: ${realNew.length} new player(s)`);

    // Update last report timestamp
    db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(KV_LAST_REPORT_KEY, String(now));
  } catch (err) {
    console.error('[nostr] User report DM error:', err.message);
  }
}, { timezone: 'Europe/Berlin' });
