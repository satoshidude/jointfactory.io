import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as wsHub from './ws.js';
import { verifyNostrAuth, getOrCreatePlayer, checkReferralReward, listReferralBoosts,
        claimReferralBoost, REFERRAL_BOOST } from './auth.js';
import { loadState, saveState, updateProfile, deletePlayer } from './game.js';
import { createInvoice, confirmAndCredit, payToLightningAddress, SAT_PACKS, WEBHOOK_SECRET } from './lightning.js';
import { buyTicket, runDraw, getCurrentRound, getRoundTickets,
        startCron, getTicketPrice, getMyTicketCount, getPriceCurvePreview,
        MAX_WINNERS, SAT_PER_TICKET, ticketsBoughtToday, ticketEligibility } from './lottery.js';
import { db, logRateChange, logEvent } from './db.js';
import { rollupDay, recentStats } from './metrics.js';
import { countLotteryManagers, REQUIRED_MANAGERS, potPayout, winnerCount,
         MAX_TICKETS_PER_DAY, boostMultipliers, BOOSTS } from '../shared/economy.js';
import { buyBoost, getActiveBoosts } from './boosts.js';
import { buySpeed, speedStatus } from './speed.js';
import { solvency, houseBalance } from './house.js';
import { initZapDb, publishWelcomeNote, publishInviteRegistered, publishReferralReward, publishLotteryWinNote, deletePlayerEvents, initLotteryReminder, OWNER_HEX, botSigner } from './zap.js';
import { recipients, campaigns, sendBroadcast } from './broadcast.js';
import { nip19 } from 'nostr-tools';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

initZapDb(db);
initLotteryReminder(db);

const fastify = Fastify({ logger: false, bodyLimit: 1048576 });

fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
  try { done(null, JSON.parse(body)); } catch(e) { done(null, body); }
});
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (!body || body.trim() === '') return done(null, {});
  try { done(null, JSON.parse(body)); } catch(e) { done(null, {}); }
});

await fastify.register(fastifyRateLimit, {
  max: 60,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1'],
});
await fastify.register(fastifyCors, { origin: ['https://jointfactory.io', 'https://dev.jointfactory.io'] });
await fastify.register(fastifyJwt, { secret: process.env.JWT_SECRET || 'devsecret' });
const distDir = path.join(__dirname, '../dist');

await fastify.register(fastifyStatic, { root: distDir, prefix: '/', serve: false });

// Serve static files (JS, CSS, images etc.)
fastify.addHook('onRequest', (req, reply, done) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) return done();
  if (req.url.includes('.')) {
    const filePath = req.url.split('?')[0];
    return reply.sendFile(filePath, distDir);
  }
  done();
});
await fastify.register(fastifyWebsocket);

async function requireAuth(req, reply) {
  try { await req.jwtVerify(); }
  catch(e) { reply.code(401).send({ error: 'Unauthorized' }); }
}

// ── WebSocket endpoint ────────────────────────────────────────────────────────
await fastify.register(async function wsRoutes(fastify) {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    const url = new URL(req.url, 'http://localhost');
    const npub = url.searchParams.get('npub') || null;
    wsHub.handleConnect(socket, npub);

    // Send current lottery state immediately on connect
    const round = getCurrentRound();
    if (round) {
      const tickets = getRoundTickets(round.id);
      const uniquePlayers = new Set(tickets.map(t => t.npub)).size;
      const remaining = Math.max(0, round.draws_at * 1000 - Date.now());
      try {
        socket.send(JSON.stringify({
          type: 'lottery_tick',
          draws_at: round.draws_at,
          remaining_ms: remaining,
          pot_sats: potPayout(round.total_sats_collected),
          total_tickets: tickets.length,
          unique_players: uniquePlayers,
        }));
      } catch(_) {}
    }
  });
});

// ── PoW Challenge ─────────────────────────────────────────────────────────────
import { createHash, randomBytes } from 'crypto';

const POW_DIFFICULTY = 4; // leading hex zeros required (4 = 16^4 = ~65k attempts)
const POW_CHALLENGE_TTL = 120; // seconds
const _powChallenges = new Map(); // challenge -> { expires }

// Cleanup expired challenges every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _powChallenges) {
    if (v.expires < now) _powChallenges.delete(k);
  }
}, 5 * 60 * 1000);

fastify.get('/api/auth/challenge', async () => {
  const challenge = randomBytes(16).toString('hex');
  _powChallenges.set(challenge, { expires: Date.now() + POW_CHALLENGE_TTL * 1000 });
  return { challenge, difficulty: POW_DIFFICULTY };
});

function verifyPow(challenge, nonce) {
  const entry = _powChallenges.get(challenge);
  if (!entry) return false;
  if (entry.expires < Date.now()) { _powChallenges.delete(challenge); return false; }
  const hash = createHash('sha256').update(challenge + ':' + nonce).digest('hex');
  const valid = hash.startsWith('0'.repeat(POW_DIFFICULTY));
  if (valid) _powChallenges.delete(challenge); // one-time use
  return valid;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
fastify.post('/api/auth/nostr', async (req, reply) => {
  const event = req.body?.event || req.body;
  const referralCode = req.body?.referral_code || null;
  const { pow_challenge, pow_nonce, website: honeypot } = req.body || {};
  if (!event?.pubkey) return reply.code(400).send({ error: 'No valid event' });

  // Honeypot check — bots fill hidden fields
  if (honeypot) return reply.code(400).send({ error: 'Verification failed' });

  // PoW check — only for new accounts
  const existing = db.prepare('SELECT npub FROM players WHERE npub=?').get(event.pubkey);
  if (!existing) {
    if (!pow_challenge || !pow_nonce) return reply.code(400).send({ error: 'Proof of work required' });
    if (!verifyPow(pow_challenge, pow_nonce)) return reply.code(400).send({ error: 'Invalid proof of work' });
  }

  const result = await verifyNostrAuth(event);
  if (!result.ok) return reply.code(401).send({ error: result.reason });
  const { player, is_new, referral_rewarded } = getOrCreatePlayer(result.npub, referralCode);
  const token = fastify.jwt.sign({ npub: result.npub }, { expiresIn: '7d' });
  // Fire-and-forget welcome note + invite notification for new players
  if (is_new) {
    publishWelcomeNote(result.npub, player.display_name)
      .catch(err => console.error('[welcome] Failed:', err.message));
    // Notify referrer if this player was invited
    if (player.referred_by) {
      const referrer = db.prepare('SELECT display_name FROM players WHERE npub=?').get(player.referred_by);
      publishInviteRegistered(player.referred_by, referrer?.display_name, result.npub, player.display_name)
        .catch(err => console.error('[invite] Registration note failed:', err.message));
    }
  }
  return {
    ok: true, token, is_new, referral_rewarded,
    player: {
      npub: player.npub,
      joints: player.joints,
      sats: player.sats,
      total_joints_earned: player.total_joints_earned || 0,
      total_deposited: player.total_deposited || 0,
      display_name: player.display_name || null,
      lightning_address: player.lightning_address || null,
      invite_code: player.invite_code || null,
    },
  };
});

// ── Game state ────────────────────────────────────────────────────────────────

/** Strongest station multiplier a player's active boosts produce, 1 if none. */
function activeBoostFactor(npub) {
  const m = boostMultipliers(getActiveBoosts(npub), Math.floor(Date.now() / 1000));
  return Math.max(m.plant, m.courier, m.fabrik);
}

/** Push the current pot to every connected client. Fired whenever sats spend
 *  feeds the open round — manager purchases, speed upgrades, boosts. */
function broadcastPotUpdate() {
  const round = getCurrentRound();
  if (!round) return;
  const tickets = getRoundTickets(round.id);
  wsHub.broadcastLotteryTick({
    draws_at: round.draws_at,
    remaining_ms: Math.max(0, round.draws_at * 1000 - Date.now()),
    pot_sats: potPayout(round.total_sats_collected),
    total_tickets: tickets.length,
    unique_players: new Set(tickets.map(t => t.npub)).size,
  });
}

fastify.get('/api/game/state', { preHandler: requireAuth }, async (req) => {
  const state = loadState(req.user.npub);
  if (!state) return { error: 'not found' };
  // Boost expiry is server state — the client applies the multipliers but never
  // decides when they end.
  return {
    ...state,
    boosts: getActiveBoosts(req.user.npub),
    // Unclaimed invite rewards — rendered as tiles in the boost card.
    boost_grants: listReferralBoosts(req.user.npub),
    speed: speedStatus(req.user.npub),
  };
});
fastify.post('/api/game/state',   { preHandler: requireAuth }, async (req) => {
  const result = saveState(req.user.npub, req.body);
  if (!result.ok) return result;
  const { joints, total_joints_earned, joints_per_sec } = req.body;
  if (joints !== undefined) {
    wsHub.broadcastPlayerUpdate(req.user.npub, Math.floor(joints || 0), Math.floor(total_joints_earned || 0), joints_per_sec || 0);
    logRateChange(req.user.npub, joints_per_sec || 0, total_joints_earned || 0, activeBoostFactor(req.user.npub));
  }
  if (result.potUpdated) broadcastPotUpdate();

  // An invite pays off when the invited player automates their chain, which is
  // something that can only become true on a save. Cheap to check: the guard
  // inside returns immediately unless this account was referred and unrewarded.
  const referral = checkReferralReward(req.user.npub);
  if (referral) {
    const buddy = db.prepare('SELECT display_name FROM players WHERE npub=?').get(req.user.npub);
    const referrer = db.prepare('SELECT display_name FROM players WHERE npub=?').get(referral.referrerNpub);
    publishReferralReward(referral.referrerNpub, referrer?.display_name, req.user.npub, buddy?.display_name)
      .catch(err => console.error('[invite] Referral reward note failed:', err.message));
  }

  // A reward is unlocked by the *buddy's* save, on someone else's account, so a
  // referrer has no other way to hear about it. Riding along on their own saves
  // makes the tile appear within one autosave interval without a poll.
  return { ...result, boost_grants: listReferralBoosts(req.user.npub) };
});
fastify.post('/api/game/profile', { preHandler: requireAuth }, async (req) => updateProfile(req.user.npub, req.body));

// Speed: the scaling joints sink. Priced in seconds of the buyer's own
// production, so the monthly ceiling holds however large their output grows.
fastify.post('/api/game/speed', { preHandler: requireAuth }, async (req, reply) => {
  const result = buySpeed(req.user.npub);
  if (!result.ok) return reply.code(400).send({ error: result.reason });
  wsHub.broadcastPlayerUpdate(req.user.npub, Math.floor(result.joints), 0, result.rate);
  return result;
});

// Boosts: the recurring sats sink. 80 % of the price feeds the lottery pot,
// same split as every other sats spend.
fastify.post('/api/game/boost', { preHandler: requireAuth }, async (req, reply) => {
  const { type } = req.body || {};
  const result = buyBoost(req.user.npub, type);
  if (!result.ok) return reply.code(400).send({ error: result.reason });
  broadcastPotUpdate();
  wsHub.notifySatsUpdate(req.user.npub, result.sats);
  return result;
});

// Claim the hour of double output a buddy earned. Free, so no pot share and no
// sats move — the only thing that changes hands is time.
fastify.post('/api/game/boost/claim', { preHandler: requireAuth }, async (req, reply) => {
  const { buddy_npub } = req.body || {};
  const result = claimReferralBoost(req.user.npub, buddy_npub);
  if (!result.ok) return reply.code(400).send({ error: result.reason });
  return {
    ...result,
    boosts: getActiveBoosts(req.user.npub),
    boost_grants: listReferralBoosts(req.user.npub),
  };
});

// ── Admin ───────────────────────────────────────────────────────────────────
// Everything below is owner-only. The check is here rather than in a preHandler
// so there is exactly one line to read when asking who can send DMs.
async function requireOwner(req, reply) {
  try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
  if (req.user.npub !== OWNER_HEX) return reply.code(403).send({ error: 'Forbidden' });
}

/** Who a campaign would reach, and what has gone out already. */
fastify.get('/api/admin/broadcast', { preHandler: requireOwner }, async (req) => {
  const campaign = String(req.query?.campaign || '');
  const signer = botSigner();
  const list = recipients(campaign, signer.pubkey);
  return {
    ok: true,
    bot: { pubkey: signer.pubkey, offline: signer.offline },
    campaign,
    total: list.length,
    pending: list.filter(r => !r.sent_at).length,
    recipients: list.map(r => ({
      npub: r.npub,
      name: r.display_name,
      last_seen_at: r.last_seen_at,
      created_at: r.created_at,
      sent_at: r.sent_at,
    })),
    campaigns: campaigns(),
  };
});

/**
 * Send the broadcast. Dry by default — `dry_run: false` has to be asked for, and
 * `confirm` has to spell out the campaign name, because there is no unsending a
 * DM that reached a relay.
 */
fastify.post('/api/admin/broadcast', { preHandler: requireOwner }, async (req, reply) => {
  const { message, campaign, dry_run = true, limit = 0, only = null, confirm = null } = req.body || {};
  const live = dry_run === false;
  if (live && confirm !== campaign) {
    return reply.code(400).send({ error: 'To send for real, confirm must repeat the campaign name' });
  }
  const signer = botSigner();
  const result = await sendBroadcast(
    { message, campaign, dryRun: !live, limit: Number(limit) || 0, only },
    signer.publish,
    signer.secretKey,
  );
  if (!result.ok) return reply.code(400).send({ error: result.reason });
  return result;
});

// ── Metrics ─────────────────────────────────────────────────────────────────
// Aggregates only, no npubs, so it can be read from a browser without exposing
// anyone's account. Owner-only all the same: it is revenue and retention data.
fastify.get('/api/health/metrics', { preHandler: requireOwner }, async (req) => {
  const days = Math.min(365, Math.max(1, Number(req.query?.days) || 30));
  // Today is rolled up on a half-hour cron; refresh it here so a look is current.
  rollupDay();
  return { ok: true, solvency: solvency(), days: recentStats(days) };
});

// Delete own account
fastify.delete('/api/game/profile', { preHandler: requireAuth }, async (req) => {
  const npub = req.user.npub;
  const result = deletePlayer(npub);
  if (result.ok) {
    // Clean up relay events in background
    deletePlayerEvents(npub).catch(err => console.error('[Delete] Relay cleanup failed:', err.message));
  }
  return result;
});

// Beacon endpoint for page unload saves (token in body since sendBeacon can't set headers)
fastify.post('/api/game/beacon', async (req, reply) => {
  const { token, ...payload } = req.body || {};
  if (!token) return reply.code(401).send({ error: 'No token' });
  try {
    const decoded = fastify.jwt.verify(token);
    const result = saveState(decoded.npub, payload);
    if (!result.ok) return result;
    const { joints, total_joints_earned, joints_per_sec } = payload;
    if (joints !== undefined) {
      wsHub.broadcastPlayerUpdate(decoded.npub, Math.floor(joints || 0), Math.floor(total_joints_earned || 0), joints_per_sec || 0);
      logRateChange(decoded.npub, joints_per_sec || 0, total_joints_earned || 0, activeBoostFactor(decoded.npub));
    }
    if (result.potUpdated) broadcastPotUpdate();
    return result;
  } catch(e) { return reply.code(401).send({ error: 'Invalid token' }); }
});

// ── Lightning ─────────────────────────────────────────────────────────────────
fastify.get('/api/lightning/packs', async () => ({ packs: SAT_PACKS }));
fastify.post('/api/lightning/invoice', { preHandler: requireAuth }, async (req, reply) => {
  const { packId } = req.body || {};
  if (!packId) return reply.code(400).send({ error: 'packId required' });
  try { return await createInvoice(req.user.npub, packId); }
  catch(e) { return reply.code(400).send({ error: e.message }); }
});
fastify.post('/api/lightning/webhook', async (req, reply) => {
  // LNbits calls back with the token that was baked into the webhook URL at
  // invoice creation. Nothing is credited on the strength of this alone — the
  // amount is confirmed with LNbits either way — but it keeps unsolicited
  // callers from making us do the lookup at all.
  if (WEBHOOK_SECRET && req.query?.token !== WEBHOOK_SECRET) {
    return reply.code(401).send({ ok: false });
  }
  const body = req.body || {};
  const payment_hash = body.payment_hash || body.checking_id;
  if (!payment_hash) return { ok: false };
  const result = await confirmAndCredit(payment_hash);
  // Notify player via WS if paid
  if (result?.ok && result?.npub && result?.sats) {
    const player = db.prepare('SELECT sats FROM players WHERE npub=?').get(result.npub);
    wsHub.notifyPaymentConfirmed(result.npub, result.sats);
    if (player) wsHub.notifySatsUpdate(result.npub, player.sats);
  }
  return result;
});

// ── Lottery ───────────────────────────────────────────────────────────────────
fastify.get('/api/lottery/current', async (req) => {
  const round = getCurrentRound();
  if (!round) return { round: null };
  const tickets = getRoundTickets(round.id);
  const uniquePlayers = new Set(tickets.map(t => t.npub)).size;

  let myTickets = 0, nextCost = 0, preview = [], ticketsToday = 0, eligibility = null, rate = 0;
  try {
    await req.jwtVerify();
    myTickets    = getMyTicketCount(req.user.npub, round.id);
    ticketsToday = ticketsBoughtToday(req.user.npub);
    nextCost     = getTicketPrice(req.user.npub);
    preview      = getPriceCurvePreview(req.user.npub);
    // Server-side truth. The lottery page used to read this from the game loop,
    // which only runs on the Grow page — landing on /lottery directly told a
    // fully automated player to "hire more managers".
    eligibility  = ticketEligibility(req.user.npub);
    // The rate the price is measured against, so the page can turn a shortfall
    // into a waiting time instead of quoting an unreachable-looking number.
    rate         = speedStatus(req.user.npub).rate;
  } catch(e) {
    // Anonymous visitor: no game state, so no meaningful price to quote.
    preview = [];
  }

  return {
    round: {
      id: round.id,
      draws_at: round.draws_at,
      total_sats_collected: round.total_sats_collected,
      total_tickets: tickets.length,
      unique_players: uniquePlayers,
      pot_sats: potPayout(round.total_sats_collected),
      // Winners this round would produce, not the absolute ceiling.
      max_winners: winnerCount(uniquePlayers),
      sat_per_ticket: SAT_PER_TICKET,
    },
    my_tickets: myTickets,
    tickets_today: ticketsToday,
    max_tickets_per_day: MAX_TICKETS_PER_DAY,
    next_ticket_cost: nextCost,
    price_preview: preview,
    eligibility,
    production_rate: rate,
    my_total_won_sats: req.user ? (() => {
      const rows = db.prepare(`
        SELECT winner_payout_sats FROM lottery_rounds
        WHERE status = 'closed' AND winner_npub IS NOT NULL
          AND (',' || winner_npub || ',') LIKE ('%,' || ? || ',%')
      `).all(req.user.npub);
      let total = 0;
      for (const r of rows) {
        try { const p = JSON.parse(r.winner_payout_sats); total += (p[req.user.npub] || 0); }
        catch { total += (Number(r.winner_payout_sats) || 0); }
      }
      return total;
    })() : 0,
    my_last_win: req.user ? (() => {
      const row = db.prepare(`
        SELECT id, winner_payout_sats, winner_paid_at FROM lottery_rounds
        WHERE status = 'closed' AND winner_npub IS NOT NULL
          AND (',' || winner_npub || ',') LIKE ('%,' || ? || ',%')
        ORDER BY winner_paid_at DESC LIMIT 1
      `).get(req.user.npub);
      if (!row) return null;
      let amount = 0;
      try { const p = JSON.parse(row.winner_payout_sats); amount = p[req.user.npub] || 0; }
      catch { amount = Number(row.winner_payout_sats) || 0; }
      return { round_id: row.id, amount_sats: amount, paid_at: row.winner_paid_at };
    })() : null,
  };
});

// ── Eligibility: the chain must actually run ─────────────────────────────────
// countLotteryManagers counts plantation #1, courier and factory — the three
// stations that have to be automated for joints to flow. Deliberately not the
// same as countManagers (every station), which governs the free quota. Both
// live in shared/economy.js so client and server agree on the numbers.
const countManagers = countLotteryManagers;

fastify.post('/api/lottery/buy', { preHandler: requireAuth }, async (req, reply) => {
  const player = db.prepare('SELECT game_state FROM players WHERE npub=?').get(req.user.npub);
  const mgrs = countManagers(player?.game_state);
  if (mgrs < REQUIRED_MANAGERS)
    return reply.code(400).send({ error: `Hire ${REQUIRED_MANAGERS - mgrs} more auto-manager${REQUIRED_MANAGERS - mgrs !== 1 ? 's' : ''} first` });
  const result = buyTicket(req.user.npub);
  if (!result.ok) return reply.code(400).send({ error: result.reason });
  return result;
});

// ── Withdraw ──────────────────────────────────────────────────────────────────
fastify.post('/api/game/withdraw', { preHandler: requireAuth }, async (req, reply) => {
  const { lightning_address, amount_sats } = req.body || {};
  const amt = Math.floor(Number(amount_sats) || 0);
  if (!lightning_address || amt < 1)
    return reply.code(400).send({ ok:false, reason:'Enter an amount to withdraw' });
  // Validate lightning address format
  const [lnUser, lnDomain] = (lightning_address || '').split('@');
  if (!lnUser || !lnDomain || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(lnDomain))
    return reply.code(400).send({ ok:false, reason:'Invalid lightning address' });

  // Check eligibility
  const player = db.prepare('SELECT sats, game_state FROM players WHERE npub=?').get(req.user.npub);
  if (!player) return reply.send({ ok:false, reason:'Player not found' });
  const mgrs = countManagers(player.game_state);
  if (mgrs < REQUIRED_MANAGERS)
    return reply.send({ ok:false, reason: `Hire ${REQUIRED_MANAGERS - mgrs} more auto-manager${REQUIRED_MANAGERS - mgrs !== 1 ? 's' : ''} before withdrawing` });

  // ATOMIC: Deduct sats FIRST with WHERE sats >= amt (prevents race condition)
  const deducted = db.prepare('UPDATE players SET sats = sats - ? WHERE npub = ? AND sats >= ?').run(amt, req.user.npub, amt);
  if (deducted.changes === 0)
    return reply.send({ ok:false, reason: `Not enough sats (${player.sats} available)` });

  try {
    await payToLightningAddress(lightning_address, amt, 'Withdraw from Joint Factory');
    db.prepare('INSERT INTO withdrawals (npub, amount_sats, lightning_address) VALUES (?, ?, ?)').run(req.user.npub, amt, lightning_address);
    logEvent(req.user.npub, 'withdraw', amt, { to: lightning_address.split('@')[1] || null });
    const updated = db.prepare('SELECT sats FROM players WHERE npub=?').get(req.user.npub);
    wsHub.notifySatsUpdate(req.user.npub, updated?.sats || 0);
    return reply.send({ ok:true, paid:amt });
  } catch(e) {
    // Payment failed — refund sats
    db.prepare('UPDATE players SET sats = sats + ? WHERE npub = ?').run(amt, req.user.npub);
    const refunded = db.prepare('SELECT sats FROM players WHERE npub=?').get(req.user.npub);
    wsHub.notifySatsUpdate(req.user.npub, refunded?.sats || 0);
    return reply.send({ ok:false, reason: e.message });
  }
});

// ── Lottery history ───────────────────────────────────────────────────────────
fastify.get('/api/lottery/history', async () => {
  const rows = db.prepare(`
    SELECT id, draws_at, winner_npub, winner_payout_sats, winner_paid_at, total_sats_collected,
    (SELECT COUNT(*) FROM lottery_tickets WHERE round_id = lottery_rounds.id) as tickets_sold
    FROM lottery_rounds WHERE status = 'closed' ORDER BY id DESC LIMIT 30
  `).all();
  const rounds = rows.map(r => {
    let payouts = {};
    try { payouts = JSON.parse(r.winner_payout_sats); } catch {
      const winners = r.winner_npub ? r.winner_npub.split(',') : [];
      const per = Math.floor((Number(r.winner_payout_sats) || 0) / (winners.length || 1));
      for (const npub of winners) payouts[npub.trim()] = per;
    }
    // Tickets per player for this round
    const ticketRows = db.prepare(
      'SELECT npub, COUNT(*) as count FROM lottery_tickets WHERE round_id=? GROUP BY npub'
    ).all(r.id);
    const tickets_per_player = {};
    for (const t of ticketRows) tickets_per_player[t.npub] = t.count;
    // Display names for winners
    const winner_names = {};
    const winners = r.winner_npub ? r.winner_npub.split(',') : [];
    for (const npub of winners) {
      const p = db.prepare('SELECT display_name FROM players WHERE npub=?').get(npub.trim());
      winner_names[npub.trim()] = p?.display_name || null;
    }
    return { ...r, winner_payouts: payouts, tickets_per_player, winner_names };
  });
  return { rounds };
});

fastify.post('/api/lottery/draw', async (req, reply) => {
  if (process.env.NODE_ENV === 'production') return reply.code(403).send({ error: 'Not in production' });
  return await runDraw();
});

// Zap receipts history (legacy — kept for backwards compat)
fastify.get('/api/lottery/zaps', async () => {
  try {
    const zaps = db.prepare(`
      SELECT z.round_id, z.recipient_npub, z.amount_sats, z.nostr_event_id, z.created_at,
             p.display_name
      FROM zap_receipts z
      LEFT JOIN players p ON p.npub = z.recipient_npub
      ORDER BY z.created_at DESC LIMIT 50
    `).all();
    return { zaps };
  } catch { return { zaps: [] }; }
});

// ── Misc ──────────────────────────────────────────────────────────────────────
fastify.get('/api/health', async () => ({ status: 'ok', ts: Date.now(), online: wsHub.getOnlineCount() }));

// Is every sat a player holds actually backed by one that came in over
// Lightning? A negative gap means sats were minted somewhere.
fastify.get('/api/health/solvency', async () => solvency());

// ── Players list ─────────────────────────────────────────────────────────────
fastify.get('/api/players', async () => {
  // Get players
  const allPlayers = db.prepare(`
    SELECT npub, display_name, joints, total_joints_earned, joints_per_sec, speed_level,
           last_seen_at, created_at, game_state
    FROM players WHERE COALESCE(is_bot, 0) = 0
    ORDER BY total_joints_earned DESC LIMIT 1000
  `).all().map(p => {
    const mgrs = countManagers(p.game_state);
    const { game_state, ...rest } = p;
    return { ...rest, manager_count: mgrs };
  });
  // Calculate total won sats from lottery payouts (JSON or legacy integer)
  const closedRounds = db.prepare(`
    SELECT winner_payout_sats, winner_npub FROM lottery_rounds
    WHERE status = 'closed' AND winner_npub IS NOT NULL AND winner_npub != ''
  `).all();
  const wonMap = {};
  for (const r of closedRounds) {
    try {
      const p = JSON.parse(r.winner_payout_sats);
      for (const [npub, sats] of Object.entries(p)) {
        wonMap[npub] = (wonMap[npub] || 0) + sats;
      }
    } catch {
      // Legacy: single integer split equally among winners
      const winners = r.winner_npub.split(',');
      const per = Math.floor((Number(r.winner_payout_sats) || 0) / (winners.length || 1));
      for (const npub of winners) {
        wonMap[npub.trim()] = (wonMap[npub.trim()] || 0) + per;
      }
    }
  }
  const players = allPlayers.map(p => ({ ...p, total_won_sats: wonMap[p.npub] || 0 }));
  const onlineNpubs = wsHub.getOnlineNpubs();
  return { players: players.map(p => ({ ...p, is_online: onlineNpubs.has(p.npub) })) };
});

// ── Public player profile ────────────────────────────────────────────────────
fastify.get('/api/player/:npub/public', async (req, reply) => {
  let hexPub = req.params.npub;
  // Accept both npub1-encoded and hex
  if (hexPub.startsWith('npub1')) {
    try { const d = nip19.decode(hexPub); hexPub = d.data; } catch { return reply.code(400).send({ error: 'Invalid npub' }); }
  }
  const player = db.prepare(`
    SELECT npub, display_name, avatar, nip05, created_at, last_seen_at,
           joints, total_joints_earned, joints_per_sec, game_state
    FROM players WHERE npub = ?
  `).get(hexPub);
  if (!player) return reply.code(404).send({ error: 'Player not found' });

  // Rank
  const rankRow = db.prepare(`SELECT COUNT(*) + 1 as rank FROM players WHERE total_joints_earned > ?`).get(player.total_joints_earned);
  const totalPlayers = db.prepare(`SELECT COUNT(*) as n FROM players`).get();

  // Station info from game_state
  let stations = null;
  try {
    const gs = JSON.parse(player.game_state || '{}');
    const plantations = (gs.plantagen || []).map(p => ({
      name: p.name || 'Plant', icon: p.icon || '', level: p.level || 0,
      has_manager: (p.managerLevel || 0) > 0
    }));
    stations = {
      plantations,
      courier: gs.courier ? { capacity: gs.courier.capacity || 0, speed_level: gs.courier.speedLevel || 0, has_manager: (gs.courier.mgrLevel || 0) > 0 } : null,
      fabrik: gs.fabrik ? { capacity: gs.fabrik.capacity || 0, speed_level: gs.fabrik.speedLevel || 0, has_manager: (gs.fabrik.mgrLevel || 0) > 0 } : null,
      manager_count: countManagers(player.game_state),
    };
  } catch {}

  // Lottery wins
  const winRounds = db.prepare(`
    SELECT id, draws_at, winner_payout_sats FROM lottery_rounds
    WHERE status = 'closed' AND winner_npub IS NOT NULL
      AND (',' || winner_npub || ',') LIKE ('%,' || ? || ',%')
    ORDER BY id DESC LIMIT 20
  `).all(hexPub);
  const wins = [];
  let totalSatsWon = 0;
  for (const r of winRounds) {
    let amount = 0;
    try { const p = JSON.parse(r.winner_payout_sats); amount = p[hexPub] || 0; }
    catch { amount = Number(r.winner_payout_sats) || 0; }
    if (amount > 0) { wins.push({ round_id: r.id, amount_sats: amount, draws_at: r.draws_at }); totalSatsWon += amount; }
  }

  // Total tickets
  const ticketRow = db.prepare(`SELECT COUNT(*) as n FROM lottery_tickets WHERE npub = ?`).get(hexPub);

  const isOnline = wsHub.getOnlineNpubs().has(hexPub);
  let npubEncoded;
  try { npubEncoded = nip19.npubEncode(hexPub); } catch { npubEncoded = hexPub; }

  return {
    ok: true,
    player: {
      npub: hexPub, npub_encoded: npubEncoded,
      display_name: player.display_name, avatar: player.avatar, nip05: player.nip05,
      created_at: player.created_at, last_seen_at: player.last_seen_at, is_online: isOnline,
    },
    production: {
      joints: player.joints, total_joints_earned: player.total_joints_earned,
      joints_per_sec: player.joints_per_sec || 0,
      rank: rankRow?.rank || 0, total_players: totalPlayers?.n || 0,
    },
    stations,
    lottery: {
      total_tickets_purchased: ticketRow?.n || 0,
      total_sats_won: totalSatsWon,
      wins,
    },
  };
});

// ── Rate log for production race chart ───────────────────────────────────────
fastify.get('/api/players/rate-log', async () => {
  const rows = db.prepare(`
    SELECT r.npub, r.ts, r.rate, r.total, COALESCE(r.boost, 1) AS boost FROM rate_log r
    JOIN players p ON p.npub = r.npub
    WHERE COALESCE(p.is_bot, 0) = 0
    ORDER BY r.ts ASC
  `).all();
  return { logs: rows };
});

fastify.get('/api/lightning/status/:hash', { preHandler: requireAuth }, async (req, reply) => {
  const { hash } = req.params;
  const row = db.prepare('SELECT status, amount_sats, npub FROM lightning_payments WHERE payment_hash = ? AND npub = ?').get(hash, req.user.npub);
  if (!row) return { paid: false, found: false };
  if (row.status === 'paid') return { paid: true, status: 'paid', amount_sats: row.amount_sats };
  // Not marked paid yet — ask LNbits through the same verified path the webhook
  // uses, so there is one place that decides whether a deposit is real.
  try {
    const result = await confirmAndCredit(hash);
    if (result?.ok) {
      if (result.npub && result.sats) {
        const player = db.prepare('SELECT sats FROM players WHERE npub=?').get(result.npub);
        wsHub.notifyPaymentConfirmed(result.npub, result.sats);
        if (player) wsHub.notifySatsUpdate(result.npub, player.sats);
      }
      return { paid: true, status: 'paid', amount_sats: row.amount_sats };
    }
  } catch(_) {}
  return { paid: false, status: row.status, amount_sats: row.amount_sats };
});

fastify.get('/api/player/payments', { preHandler: requireAuth }, async (req) => {
  const npub = req.user.npub;
  const deposits = db.prepare(`
    SELECT 'deposit' as type, amount_sats, paid_at as ts, payment_hash as ref
    FROM lightning_payments WHERE npub = ? AND status = 'paid'
    ORDER BY paid_at DESC LIMIT 50
  `).all(npub);
  // Lottery wins: parse JSON payouts to get this player's share
  const lotteryRounds = db.prepare(`
    SELECT winner_payout_sats, winner_paid_at as ts, id as ref
    FROM lottery_rounds
    WHERE winner_npub LIKE ? AND status = 'closed' AND winner_paid_at IS NOT NULL
    ORDER BY winner_paid_at DESC LIMIT 20
  `).all('%' + npub + '%');
  const lotteryWins = lotteryRounds.map(r => {
    let amount = 0;
    try {
      const payouts = JSON.parse(r.winner_payout_sats);
      amount = payouts[npub] || 0;
    } catch { amount = Number(r.winner_payout_sats) || 0; }
    return { type: 'lottery_win', amount_sats: amount, ts: r.ts, ref: r.ref };
  }).filter(r => r.amount_sats > 0);
  // Ticket purchases
  const tickets = db.prepare(`
    SELECT 'ticket' as type, joints_cost as amount_sats, purchased_at as ts, round_id as ref
    FROM lottery_tickets WHERE npub = ?
    ORDER BY purchased_at DESC LIMIT 50
  `).all(npub);
  // Withdrawals
  const withdrawals = db.prepare(`
    SELECT 'withdraw' as type, amount_sats, created_at as ts, id as ref
    FROM withdrawals WHERE npub = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(npub);
  // Referral rewards are boosts now, not sats — they have no place in a sats
  // ledger, and the row claimed 10 while the code paid 20.
  const all = [...deposits, ...lotteryWins, ...tickets, ...withdrawals].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 80);
  const player = db.prepare('SELECT sats, joints FROM players WHERE npub=?').get(npub);
  return { ok: true, payments: all, sats: player?.sats || 0, joints: player?.joints || 0 };
});

// ── Invite info ──────────────────────────────────────────────────────────────
fastify.get('/api/player/invite', { preHandler: requireAuth }, async (req) => {
  const player = db.prepare('SELECT invite_code FROM players WHERE npub = ?').get(req.user.npub);
  const referrals = db.prepare(`
    SELECT npub, display_name, created_at, referral_rewarded, referral_claimed_at, game_state
    FROM players WHERE referred_by = ? ORDER BY created_at DESC
  `).all(req.user.npub).map(r => ({
    npub: r.npub,
    display_name: r.display_name,
    created_at: r.created_at,
    rewarded: !!r.referral_rewarded,
    // The hour is collected by hand from the boost card, so the page shows
    // whether it is still waiting there.
    claimed: !!r.referral_claimed_at,
    managers: countLotteryManagers(r.game_state),
  }));
  const rewardedCount = referrals.filter(r => r.rewarded).length;
  const reward = BOOSTS[REFERRAL_BOOST];
  return {
    ok: true,
    invite_code: player?.invite_code || null,
    referrals,
    rewarded_count: rewardedCount,
    // There is no cap; max_referrals: 10 was reported here while the code said
    // otherwise. What matters is what an invite is worth.
    reward: { boost: REFERRAL_BOOST, name: reward.name, short: reward.short, minutes: reward.durationSec / 60 },
  };
});

// Remove a buddy (unlink referral)
fastify.delete('/api/player/invite/:buddyNpub', { preHandler: requireAuth }, async (req) => {
  const { buddyNpub } = req.params;
  const result = db.prepare('UPDATE players SET referred_by = NULL WHERE npub = ? AND referred_by = ?').run(buddyNpub, req.user.npub);
  if (result.changes === 0) return { ok: false, reason: 'Buddy not found' };
  return { ok: true };
});

// ── Start ─────────────────────────────────────────────────────────────────────
// SPA fallback — serve index.html for non-API routes
try {
  fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/ws")) {
      return reply.code(404).send({ error: "Not found" });
    }
    reply.sendFile("index.html", distDir);
  });
} catch(e) {
  fastify.addHook('onRequest', (req, reply, done) => {
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/ws') && !req.url.includes('.')) {
      reply.sendFile('index.html', distDir);
      return;
    }
    done();
  });
}

const PORT = parseInt(process.env.PORT || '3420');
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`\n🌿 Joint Factory on port ${PORT} (WS enabled)`);
  startCron();
});
