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
import { verifyNostrAuth, getOrCreatePlayer } from './auth.js';
import { loadState, saveState, updateProfile, deletePlayer } from './game.js';
import { createInvoice, handleWebhook, payToLightningAddress, SAT_PACKS } from './lightning.js';
import { buyTicket, runDraw, getCurrentRound, getRoundTickets,
        startCron, getTicketPrice, getMyTicketCount, getPriceCurvePreview,
        MAX_WINNERS, SAT_PER_TICKET, TICKET_PRICE_CURVE } from './lottery.js';
import { db, logRateChange } from './db.js';
import { initZapDb, publishWelcomeNote, publishInviteRegistered, publishReferralReward, publishLotteryWinNote, deletePlayerEvents, initLotteryReminder } from './zap.js';
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
// Host-based static file serving: dev.jointfactory.io → dist-dev/, else → dist/
const distDir = path.join(__dirname, '../dist');
const distDevDir = path.join(__dirname, '../dist-dev');

function isDevHost(req) {
  return (req.headers.host || '').split(':')[0] === 'dev.jointfactory.io';
}

await fastify.register(fastifyStatic, { root: distDir, prefix: '/', serve: false });
await fastify.register(fastifyStatic, { root: distDevDir, prefix: '/dev-static/', decorateReply: false });

// Serve static files from correct dist dir based on Host header
fastify.addHook('onRequest', (req, reply, done) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) return done();
  const root = isDevHost(req) ? distDevDir : distDir;
  // For files with extensions (JS, CSS, images etc.)
  if (req.url.includes('.')) {
    const filePath = req.url.split('?')[0];
    return reply.sendFile(filePath, root);
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
          pot_sats: Math.floor(round.total_sats_collected * 0.8),
          total_tickets: tickets.length,
          unique_players: uniquePlayers,
        }));
      } catch(_) {}
    }
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────
fastify.post('/api/auth/nostr', async (req, reply) => {
  const event = req.body?.event || req.body;
  const referralCode = req.body?.referral_code || null;
  if (!event?.pubkey) return reply.code(400).send({ error: 'No valid event' });
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
fastify.get('/api/game/state',    { preHandler: requireAuth }, async (req) => loadState(req.user.npub) || { error: 'not found' });
fastify.post('/api/game/state',   { preHandler: requireAuth }, async (req) => {
  const result = saveState(req.user.npub, req.body);
  const { joints, total_joints_earned, joints_per_sec } = req.body;
  if (joints !== undefined) {
    wsHub.broadcastPlayerUpdate(req.user.npub, Math.floor(joints || 0), Math.floor(total_joints_earned || 0), joints_per_sec || 0);
    logRateChange(req.user.npub, joints_per_sec || 0, total_joints_earned || 0);
  }
  return result;
});
fastify.post('/api/game/profile', { preHandler: requireAuth }, async (req) => updateProfile(req.user.npub, req.body));

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
    const { joints, total_joints_earned, joints_per_sec } = payload;
    if (joints !== undefined) {
      wsHub.broadcastPlayerUpdate(decoded.npub, Math.floor(joints || 0), Math.floor(total_joints_earned || 0), joints_per_sec || 0);
      logRateChange(decoded.npub, joints_per_sec || 0, total_joints_earned || 0);
    }
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
fastify.post('/api/lightning/webhook', async (req) => {
  const body = req.body || {};
  const payment_hash = body.payment_hash || body.checking_id;
  if (!payment_hash) return { ok: false };
  const result = handleWebhook(payment_hash);
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

  let myTickets = 0, nextCost = TICKET_PRICE_CURVE[0], preview = [];
  try {
    await req.jwtVerify();
    myTickets = getMyTicketCount(req.user.npub, round.id);
    nextCost  = getTicketPrice(myTickets);
    preview   = getPriceCurvePreview(myTickets);
  } catch(e) {
    preview = getPriceCurvePreview(0);
  }

  return {
    round: {
      id: round.id,
      draws_at: round.draws_at,
      total_sats_collected: round.total_sats_collected,
      total_tickets: tickets.length,
      unique_players: uniquePlayers,
      pot_sats: Math.floor(round.total_sats_collected * 0.8),
      max_winners: MAX_WINNERS,
      sat_per_ticket: SAT_PER_TICKET,
    },
    my_tickets: myTickets,
    next_ticket_cost: nextCost,
    price_preview: preview,
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

// ── Eligibility: 3 auto-managers required ────────────────────────────────────
const REQUIRED_MANAGERS = 3;

function countManagers(gameState) {
  if (!gameState) return 0;
  let gs;
  try { gs = typeof gameState === 'string' ? JSON.parse(gameState) : gameState; } catch { return 0; }
  let count = 0;
  if (gs.plantagen?.[0]?.managerLevel > 0) count++;
  if (gs.courier?.mgrLevel > 0) count++;
  if (gs.fabrik?.mgrLevel > 0) count++;
  return count;
}

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

// ── Players list ─────────────────────────────────────────────────────────────
fastify.get('/api/players', async () => {
  // Get players
  const allPlayers = db.prepare(`
    SELECT npub, display_name, joints, total_joints_earned, joints_per_sec, last_seen_at, created_at, game_state
    FROM players ORDER BY total_joints_earned DESC LIMIT 1000
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
    SELECT npub, ts, rate, total FROM rate_log
    ORDER BY ts ASC
  `).all();
  return { logs: rows };
});

fastify.get('/api/lightning/status/:hash', { preHandler: requireAuth }, async (req, reply) => {
  const { hash } = req.params;
  const row = db.prepare('SELECT status, amount_sats, npub FROM lightning_payments WHERE payment_hash = ? AND npub = ?').get(hash, req.user.npub);
  if (!row) return { paid: false, found: false };
  if (row.status === 'paid') return { paid: true, status: 'paid', amount_sats: row.amount_sats };
  // Check LNbits directly if not yet marked paid
  try {
    const lnRes = await fetch(`${process.env.LNBITS_URL || 'https://lnbits.nsnip.io'}/api/v1/payments/${hash}`, {
      headers: { 'X-Api-Key': process.env.LNBITS_INVOICE_KEY || '' },
    });
    if (lnRes.ok) {
      const lnData = await lnRes.json();
      if (lnData.paid === true) {
        const result = handleWebhook(hash);
        if (result?.ok && result?.npub && result?.sats) {
          const player = db.prepare('SELECT sats FROM players WHERE npub=?').get(result.npub);
          wsHub.notifyPaymentConfirmed(result.npub, result.sats);
          if (player) wsHub.notifySatsUpdate(result.npub, player.sats);
        }
        return { paid: true, status: 'paid', amount_sats: row.amount_sats };
      }
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
  // Referral rewards (10 sats each for rewarded buddies)
  const referralRewards = db.prepare(`
    SELECT 'referral_reward' as type, 10 as amount_sats, last_seen_at as ts, display_name as ref
    FROM players WHERE referred_by = ? AND referral_rewarded = 1
    ORDER BY last_seen_at DESC LIMIT 20
  `).all(npub);
  const all = [...deposits, ...lotteryWins, ...tickets, ...withdrawals, ...referralRewards].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 80);
  const player = db.prepare('SELECT sats, joints FROM players WHERE npub=?').get(npub);
  return { ok: true, payments: all, sats: player?.sats || 0, joints: player?.joints || 0 };
});

// ── Invite info ──────────────────────────────────────────────────────────────
fastify.get('/api/player/invite', { preHandler: requireAuth }, async (req) => {
  const player = db.prepare('SELECT invite_code FROM players WHERE npub = ?').get(req.user.npub);
  const referrals = db.prepare(`
    SELECT display_name, created_at, referral_rewarded, game_state
    FROM players WHERE referred_by = ? ORDER BY created_at DESC
  `).all(req.user.npub).map(r => {
    let mgrs = 0;
    try {
      const gs = JSON.parse(r.game_state || '{}');
      if (gs.plantagen?.[0]?.managerLevel > 0) mgrs++;
      if (gs.courier?.mgrLevel > 0) mgrs++;
      if (gs.fabrik?.mgrLevel > 0) mgrs++;
    } catch {}
    return {
      display_name: r.display_name,
      created_at: r.created_at,
      rewarded: !!r.referral_rewarded,
      managers: mgrs,
    };
  });
  const rewardedCount = referrals.filter(r => r.rewarded).length;
  return { ok: true, invite_code: player?.invite_code || null, referrals, rewarded_count: rewardedCount, max_referrals: 10 };
});

// ── Start ─────────────────────────────────────────────────────────────────────
// SPA fallback — serve index.html for non-API routes (host-aware)
try {
  fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/ws")) {
      return reply.code(404).send({ error: "Not found" });
    }
    const root = isDevHost(req) ? distDevDir : distDir;
    reply.sendFile("index.html", root);
  });
} catch(e) {
  // Already set by @fastify/static — register SPA fallback via hook instead
  fastify.addHook('onRequest', (req, reply, done) => {
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/ws') && !req.url.includes('.')) {
      const root = isDevHost(req) ? distDevDir : distDir;
      reply.sendFile('index.html', root);
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
