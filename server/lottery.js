import { randomInt } from 'crypto';
import { db, ensureOpenRound } from './db.js';
import cron from 'node-cron';
import * as wsHub from './ws.js';
import { publishLotteryWinNote } from './zap.js';

export const MAX_WINNERS = 21;
export const SAT_PER_TICKET = 100;

// Fesselnde Preiskurve: easy start → peak → surprise dip → ramp → endgame
export const TICKET_PRICE_CURVE = [
  500,     // #1  — easy, sofort kaufbar
  1200,    // #2  — easy
  2500,    // #3  — etwas mehr
  4000,    // #4  — medium
  7000,    // #5  — peak early
  5000,    // #6  — ⬇ DIP! "noch einer!"
  3500,    // #7  — ⬇ noch günstiger!
  9000,    // #8  — zurück rauf
  15000,   // #9  — hard
  25000,   // #10 — in 24h erreichbar mit Strategie
  40000,   // #11
  70000,   // #12
  120000,  // #13
  200000,  // #14
  350000,  // #15
  600000,  // #16
  1000000, // #17
  1700000, // #18
  2800000, // #19
  4500000, // #20
  7500000, // #21+
];

export function getTicketPrice(myCount) {
  return TICKET_PRICE_CURVE[Math.min(myCount, TICKET_PRICE_CURVE.length - 1)];
}
export function getMyTicketCount(npub, roundId) {
  return db.prepare(`SELECT COUNT(*) as n FROM lottery_tickets WHERE round_id=? AND npub=?`).get(roundId, npub)?.n || 0;
}
export function getCurrentRound() {
  return db.prepare(`SELECT * FROM lottery_rounds WHERE status='open' ORDER BY id DESC LIMIT 1`).get();
}
export function getRoundTickets(roundId) {
  return db.prepare(`SELECT * FROM lottery_tickets WHERE round_id=?`).all(roundId);
}
export function getPriceCurvePreview(currentCount) {
  return [0,1,2].map(i => ({ n: currentCount+i+1, cost: getTicketPrice(currentCount+i) }));
}

// Atomic ticket purchase transaction
const _buyTicketTx = db.transaction((npub, roundId) => {
  const myCount = getMyTicketCount(npub, roundId);
  const cost = getTicketPrice(myCount);
  // Atomic deduct joints — WHERE joints >= cost prevents overspend
  const deducted = db.prepare('UPDATE players SET joints = joints - ? WHERE npub = ? AND joints >= ?').run(cost, npub, cost);
  if (deducted.changes === 0) return { ok: false, reason: `Not enough Joints (${cost} needed)` };
  db.prepare('INSERT INTO lottery_tickets (round_id, npub, joints_cost) VALUES (?, ?, ?)').run(roundId, npub, cost);
  return { ok: true, myCount: myCount + 1, cost };
});

export function buyTicket(npub) {
  const round = getCurrentRound();
  if (!round) return { ok:false, reason:'No open round' };
  const player = db.prepare('SELECT npub FROM players WHERE npub=?').get(npub);
  if (!player) return { ok:false, reason:'Player not found' };

  const result = _buyTicketTx(npub, round.id);
  if (!result.ok) return result;

  const updatedRound = db.prepare('SELECT total_sats_collected FROM lottery_rounds WHERE id=?').get(round.id);
  const allTickets = getRoundTickets(round.id);

  // Broadcast updated lottery state via WS
  const uniquePlayers = new Set(allTickets.map(t => t.npub)).size;
  wsHub.broadcastLotteryTick({
    draws_at: round.draws_at,
    remaining_ms: Math.max(0, round.draws_at * 1000 - Date.now()),
    pot_sats: Math.floor(updatedRound.total_sats_collected * 0.8),
    total_tickets: allTickets.length,
    unique_players: uniquePlayers,
  });

  return { ok:true, round_id:round.id, my_tickets:result.myCount, total_tickets:allTickets.length,
    pool_sats:updatedRound.total_sats_collected, draws_at:round.draws_at,
    next_ticket_cost:getTicketPrice(result.myCount), price_curve:getPriceCurvePreview(result.myCount) };
}

export async function runDraw(roundId) {
  const now = Math.floor(Date.now()/1000);
  const round = roundId
    ? db.prepare(`SELECT * FROM lottery_rounds WHERE id=? AND status='open'`).get(roundId)
    : db.prepare(`SELECT * FROM lottery_rounds WHERE status='open' AND draws_at<=? ORDER BY draws_at ASC LIMIT 1`).get(now);
  if (!round) return { ok:false, reason:'No due round' };
  db.prepare(`UPDATE lottery_rounds SET status='drawing' WHERE id=?`).run(round.id);
  const tickets = getRoundTickets(round.id);
  if (tickets.length === 0) {
    db.prepare(`UPDATE lottery_rounds SET status='closed' WHERE id=?`).run(round.id);
    ensureOpenRound(); return { ok:true, winners:[] };
  }
  // Count tickets per player
  const ticketsByPlayer = {};
  for (const t of tickets) {
    ticketsByPlayer[t.npub] = (ticketsByPlayer[t.npub] || 0) + 1;
  }
  const totalTickets = tickets.length;

  // Select winners (unique players drawn from ticket pool — more tickets = higher chance)
  const pool = tickets.map(t => t.npub);
  const winners = []; const remaining = [...pool];
  const maxW = Math.min(MAX_WINNERS, new Set(pool).size);
  while (winners.length < maxW && remaining.length > 0) {
    const idx = randomInt(0, remaining.length);
    const w = remaining[idx];
    if (!winners.includes(w)) winners.push(w);
    for (let i = remaining.length - 1; i >= 0; i--) { if (remaining[i] === w) remaining.splice(i, 1); }
  }

  // Calculate payout proportional to tickets held by each winner
  const payoutPool = Math.floor(round.total_sats_collected * 0.8);
  const winnerTickets = winners.reduce((sum, npub) => sum + ticketsByPlayer[npub], 0);
  const payouts = {}; // { npub: sats }
  let distributed = 0;
  for (const npub of winners) {
    const share = Math.floor(payoutPool * ticketsByPlayer[npub] / winnerTickets);
    payouts[npub] = share;
    distributed += share;
  }
  // Give remainder to first winner to avoid dust
  if (winners.length > 0) payouts[winners[0]] += (payoutPool - distributed);

  const payoutsJson = JSON.stringify(payouts);
  db.prepare(`UPDATE lottery_rounds SET status='closed',winner_npub=?,winner_payout_sats=? WHERE id=?`)
    .run(winners.join(','), payoutsJson, round.id);

  // Credit winnings directly to player wallets
  for (const npub of winners) {
    const payout = payouts[npub];
    if (payout > 0) {
      db.prepare('UPDATE players SET sats=sats+? WHERE npub=?').run(payout, npub);
      console.log(`[Lottery] Credited ${payout} sats to ${npub.slice(0,12)}`);
    }
  }
  db.prepare(`UPDATE lottery_rounds SET winner_paid_at=unixepoch() WHERE id=?`).run(round.id);

  // Broadcast result via WS
  const winnerList = winners.map(npub => {
    const player = db.prepare('SELECT display_name FROM players WHERE npub=?').get(npub);
    return { npub, payout_sats: payouts[npub], tickets: ticketsByPlayer[npub], display_name: player?.display_name || null };
  });
  wsHub.broadcastLotteryResult({ round_id: round.id, winners: winnerList, pot_sats: payoutPool });
  // Update sats for each winner
  for (const npub of winners) {
    const p = db.prepare('SELECT sats FROM players WHERE npub=?').get(npub);
    if (p) wsHub.notifySatsUpdate(npub, p.sats);
  }

  // Publish lottery win note on Nostr
  publishLotteryWinNote(round.id, winnerList)
    .catch(err => console.error('[Lottery] Nostr win note failed:', err.message));

  ensureOpenRound();
  return { ok:true, round_id:round.id, winners: winnerList, total_tickets:tickets.length, pot_sats: payoutPool };
}

export function startCron() {
  // Every minute: check for due draws
  cron.schedule('* * * * *', async () => {
    const now = Math.floor(Date.now()/1000);
    const due = db.prepare(`SELECT id FROM lottery_rounds WHERE status='open' AND draws_at<=?`).get(now);
    if (due) { console.log('[Lottery] Drawing round', due.id); await runDraw(due.id); }
  });

  // Every second: broadcast lottery tick via WS
  setInterval(() => {
    const round = getCurrentRound();
    if (!round) return;
    if (wsHub.getOnlineCount() === 0) return;
    const tickets = getRoundTickets(round.id);
    const uniquePlayers = new Set(tickets.map(t => t.npub)).size;
    const remaining = Math.max(0, round.draws_at * 1000 - Date.now());
    wsHub.broadcastLotteryTick({
      draws_at: round.draws_at,
      remaining_ms: remaining,
      pot_sats: Math.floor(round.total_sats_collected * 0.8),
      total_tickets: tickets.length,
      unique_players: uniquePlayers,
    });
  }, 1000);

  console.log('[Lottery] Cron active — draws at 0h, 5h, 11h, 16h, 19h, 21h Berlin + WS tick every second');
}
