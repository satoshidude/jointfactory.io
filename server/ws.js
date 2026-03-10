/**
 * Joint Factory — WebSocket Hub
 * Manages all connected clients and broadcasts game events.
 */
import { logRateChange } from './db.js';

// Map: rawSocket → { npub|null, alive, stream }
const clients = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(rawSocket, payload) {
  if (rawSocket && rawSocket.readyState === 1 /* OPEN */) {
    try { rawSocket.send(JSON.stringify(payload)); } catch (_) {}
  }
}

export function broadcast(payload) {
  for (const [rawSocket] of clients) {
    if (rawSocket) send(rawSocket, payload);
  }
}

function sendToNpub(npub, payload) {
  for (const [rawSocket, meta] of clients) {
    if (meta.npub === npub) send(rawSocket, payload);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called from Fastify WS route for each new connection.
 * @param {WebSocket} socket  — the WebSocket from @fastify/websocket v11+
 * @param {string|null}  npub   — optional, from query param
 */
export function handleConnect(socket, npub) {
  clients.set(socket, { npub: npub || null, alive: true });
  broadcastOnlineCount();

  // Heartbeat pong
  socket.on('pong', () => {
    const meta = clients.get(socket);
    if (meta) meta.alive = true;
  });

  // Client can send { type:'auth', npub } to register itself after login
  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth' && msg.npub) {
        const meta = clients.get(socket);
        if (meta) meta.npub = msg.npub;
      }
    } catch (_) {}
  });

  socket.on('close', () => {
    const meta = clients.get(socket);
    if (meta?.npub) logRateChange(meta.npub, 0, 0);
    clients.delete(socket);
    broadcastOnlineCount();
  });

  socket.on('error', () => {
    const meta = clients.get(socket);
    if (meta?.npub) logRateChange(meta.npub, 0, 0);
    clients.delete(socket);
  });
}

export function broadcastOnlineCount() {
  broadcast({ type: 'online_count', count: clients.size });
}

export function broadcastLotteryTick(data) {
  broadcast({ type: 'lottery_tick', ...data });
}

export function broadcastLotteryResult({ round_id, winners, pot_sats }) {
  broadcast({ type: 'lottery_result', round_id, winners, pot_sats });
  for (const w of winners) {
    sendToNpub(w.npub, { type: 'lottery_win', payout_sats: w.payout_sats, round_id });
  }
}

export function broadcastPlayerUpdate(npub, joints, total_joints_earned, joints_per_sec) {
  broadcast({ type: 'player_update', npub, joints, total_joints_earned, joints_per_sec: joints_per_sec || 0 });
}

export function getOnlineNpubs() {
  const npubs = new Set();
  for (const [, meta] of clients) {
    if (meta.npub) npubs.add(meta.npub);
  }
  return npubs;
}

export function notifySatsUpdate(npub, sats) {
  sendToNpub(npub, { type: 'sats_update', sats });
}

export function notifyPaymentConfirmed(npub, amount_sats) {
  sendToNpub(npub, { type: 'payment_confirmed', amount_sats });
}

export function getOnlineCount() {
  return clients.size;
}

// ── Heartbeat ping loop (every 30s) ──────────────────────────────────────────
setInterval(() => {
  for (const [rawSocket, meta] of clients) {
    if (!meta.alive) {
      if (meta.npub) logRateChange(meta.npub, 0, 0);
      clients.delete(rawSocket);
      try { rawSocket.terminate(); } catch (_) {}
      continue;
    }
    meta.alive = false;
    try { rawSocket.ping(); } catch (_) {}
  }
}, 30_000);
