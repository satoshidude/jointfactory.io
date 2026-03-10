/**
 * One-off script: publish Kind 1 feature notes as JF bot.
 * Run on server: node scripts/publish-articles.mjs
 * Requires NOSTR_ZAP_NSEC in env (loaded from ../.env).
 */

import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = resolve(__dirname, '../.env');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
} catch {}

const RELAY_URL = 'wss://relay.nsnip.io/';
const SITE_URL = 'https://jointfactory.nsnip.io';

// Keypair
const decoded = nip19.decode(process.env.NOSTR_ZAP_NSEC);
const sk = decoded.data;
const pk = getPublicKey(sk);
console.log('Publishing as:', nip19.npubEncode(pk));

function publishToRelay(event) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_URL);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 10000);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'OK') {
          clearTimeout(timeout);
          ws.close();
          if (msg[2]) resolve();
          else reject(new Error(msg[3] || 'Rejected'));
        }
      } catch {}
    });
    ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

const articles = [
  {
    content: `🌿 Joint Factory — Idle Tycoon on Bitcoin Lightning ⚡

Grow weed, roll joints, win sats. Joint Factory is a browser-based idle game where every upgrade and every lottery ticket is powered by real Bitcoin Lightning payments.

Factory, Courier, Plantations, Lightning Lottery — all running 24/7 on Nostr.

Play free, stack sats: ${SITE_URL}

${SITE_URL}/jfbanner.jpg`,
    tags: [
      ['t', 'JointFactory'], ['t', 'Bitcoin'], ['t', 'Lightning'], ['t', 'Nostr'], ['t', 'Gaming'],
      ['r', `${SITE_URL}/jfbanner.jpg`],
    ],
  },
  {
    content: `🌱 Plantations — 6 Tiers of Green Production

Start with a humble Balcony Grow and work your way up to a MegaFarm producing 250K base per 2s cycle.

Each tier unlocks at a higher price — from Balcony Grow to Outdoor Plot, Indoor Room, Hydroponic Lab, Greenhouse, and finally the legendary MegaFarm.

Level up for more output, buy speed boosts with sats, and hire Auto Managers to keep harvesting while you're away.

${SITE_URL}/jfplantations.jpg

${SITE_URL}`,
    tags: [
      ['t', 'JointFactory'], ['t', 'Bitcoin'], ['t', 'Lightning'],
      ['r', `${SITE_URL}/jfplantations.jpg`],
    ],
  },
  {
    content: `🚚 The Courier — Fast Delivery, More Joints

The Courier picks up weed from your plantations and delivers it to the Factory. Upgrade payload capacity and trip speed to keep your supply chain flowing.

Pay sats for speed boosts — every 1% faster means more joints per second. Hire an Auto Manager and the courier runs nonstop, even while you sleep.

${SITE_URL}/jfcourier.jpg

${SITE_URL}`,
    tags: [
      ['t', 'JointFactory'], ['t', 'Bitcoin'], ['t', 'Lightning'],
      ['r', `${SITE_URL}/jfcourier.jpg`],
    ],
  },
  {
    content: `🏭 The Factory — Where Weed Becomes Joints

The Factory processes incoming weed into joints. Upgrade batch size and rolling speed to maximize output. Current stats: 200/s batch rate at 1.0x speed.

Double your capacity or boost speed with Lightning sats. With an Auto Manager, the factory keeps rolling around the clock.

${SITE_URL}/jffactory.jpg

${SITE_URL}`,
    tags: [
      ['t', 'JointFactory'], ['t', 'Bitcoin'], ['t', 'Lightning'],
      ['r', `${SITE_URL}/jffactory.jpg`],
    ],
  },
  {
    content: `⚡ Lightning Lottery — Win Real Sats Every Round

Every few hours a new lottery round draws. Buy tickets with joints, and if you win, real Bitcoin sats are paid to your Lightning address.

The pot grows with every ticket sold. More players = bigger prizes. Last win: 50 sats in Round #68.

Will you be next? 🎰

${SITE_URL}/jflottery.jpg

${SITE_URL}`,
    tags: [
      ['t', 'JointFactory'], ['t', 'Bitcoin'], ['t', 'Lightning'], ['t', 'Lottery'],
      ['r', `${SITE_URL}/jflottery.jpg`],
    ],
  },
];

// Publish with 3s delay between each to avoid relay rate limiting
for (let i = 0; i < articles.length; i++) {
  const a = articles[i];
  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000) - (articles.length - 1 - i) * 60, // space timestamps 1min apart
    content: a.content,
    tags: a.tags,
  }, sk);

  try {
    await publishToRelay(event);
    console.log(`✓ Published article ${i + 1}/${articles.length}: ${event.id}`);
  } catch (e) {
    console.error(`✗ Failed article ${i + 1}:`, e.message);
  }

  if (i < articles.length - 1) await new Promise(r => setTimeout(r, 3000));
}

console.log('Done!');
