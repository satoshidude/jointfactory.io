import { randomInt } from 'crypto';
import { db, ensureOpenRound } from './db.js';
import { DRAW_LABEL } from '../shared/schedule.js';
import { potPayout, ticketPrice, ticketPreview, throughput, winnerCount,
         MAX_WINNERS, MAX_TICKETS_PER_DAY } from '../shared/economy.js';
import cron from 'node-cron';
import * as wsHub from './ws.js';
import { publishLotteryWinNote } from './zap.js';
import { houseCredit, solvency } from './house.js';

export { MAX_WINNERS };
export const SAT_PER_TICKET = 100;

export { MAX_TICKETS_PER_DAY };

/**
 * Production rate a ticket price is measured against.
 *
 * Computed from the stored game state, not from players.joints_per_sec — that
 * column holds whatever the client last reported, so pricing off it would let a
 * player post a rate of 0 and buy every ticket at the floor price forever.
 *
 * Boosts are deliberately excluded: the price follows base capability, so
 * buying a boost never makes tickets more expensive.
 */
function playerRate(npub) {
  const row = db.prepare('SELECT game_state, prestige_seeds FROM players WHERE npub = ?').get(npub);
  if (!row?.game_state) return 0;
  // Seeds are permanent capability, exactly like plantation levels, so they
  // belong in the price. Leaving them out made tickets ~16x too cheap for a
  // player who had harvested — they produced 23/s and paid as if making 1.3/s.
  try { return throughput(JSON.parse(row.game_state), { seeds: row.prestige_seeds || 0 }).jointsPerSec; }
  catch { return 0; }
}

/** Tickets this player bought in the last 24 hours. */
export function ticketsBoughtToday(npub) {
  if (!npub) return 0;
  return db.prepare(
    `SELECT COUNT(*) AS n FROM lottery_tickets
     WHERE npub = ? AND purchased_at > unixepoch() - 86400`
  ).get(npub)?.n || 0;
}

export function getTicketPrice(npub) {
  return ticketPrice(ticketsBoughtToday(npub), playerRate(npub));
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
export function getPriceCurvePreview(npub) {
  return ticketPreview(ticketsBoughtToday(npub), playerRate(npub));
}

// Atomic ticket purchase transaction
const _buyTicketTx = db.transaction((npub, roundId) => {
  // Counted and priced inside the transaction, from the same rows the deduction
  // reads, so two concurrent purchases cannot both pass the daily check.
  const boughtToday = ticketsBoughtToday(npub);
  if (boughtToday >= MAX_TICKETS_PER_DAY) {
    return { ok: false, reason: `Daily limit reached — ${MAX_TICKETS_PER_DAY} tickets per day` };
  }
  const cost = getTicketPrice(npub);
  // Atomic deduct joints — WHERE joints >= cost prevents overspend
  const deducted = db.prepare('UPDATE players SET joints = joints - ? WHERE npub = ? AND joints >= ?').run(cost, npub, cost);
  if (deducted.changes === 0) return { ok: false, reason: `Not enough Joints (${cost} needed)` };
  db.prepare('INSERT INTO lottery_tickets (round_id, npub, joints_cost) VALUES (?, ?, ?)').run(roundId, npub, cost);
  return { ok: true, myCount: getMyTicketCount(npub, roundId), boughtToday: boughtToday + 1, cost };
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
    pot_sats: potPayout(updatedRound.total_sats_collected),
    total_tickets: allTickets.length,
    unique_players: uniquePlayers,
  });

  return { ok:true, round_id:round.id, my_tickets:result.myCount, total_tickets:allTickets.length,
    pool_sats:updatedRound.total_sats_collected, draws_at:round.draws_at,
    tickets_today: result.boughtToday, max_tickets_per_day: MAX_TICKETS_PER_DAY,
    next_ticket_cost:getTicketPrice(npub), price_curve:getPriceCurvePreview(npub) };
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
    // Nobody entered — carry the pot to the next round. The UI has always
    // promised "pot rolls over"; the sats used to be stranded on the closed
    // round instead, and the next one started at zero.
    const carry = round.total_sats_collected || 0;
    db.prepare(`UPDATE lottery_rounds SET status='closed' WHERE id=?`).run(round.id);
    ensureOpenRound();
    if (carry > 0) {
      db.prepare(`UPDATE lottery_rounds SET total_sats_collected = total_sats_collected + ?
                  WHERE status='open'`).run(carry);
      console.log(`[Lottery] Round ${round.id} had no entries — ${carry} sats rolled over`);
    }
    return { ok:true, winners:[], rolled_over: carry };
  }
  // Count tickets per player
  const ticketsByPlayer = {};
  for (const t of tickets) {
    ticketsByPlayer[t.npub] = (ticketsByPlayer[t.npub] || 0) + 1;
  }
  const totalTickets = tickets.length;

  // Select winners (unique players drawn from ticket pool — more tickets = higher chance).
  // Only a fraction of entrants wins; see winnerCount() for why.
  const pool = tickets.map(t => t.npub);
  const winners = []; const remaining = [...pool];
  const maxW = winnerCount(new Set(pool).size);
  while (winners.length < maxW && remaining.length > 0) {
    const idx = randomInt(0, remaining.length);
    const w = remaining[idx];
    if (!winners.includes(w)) winners.push(w);
    for (let i = remaining.length - 1; i >= 0; i--) { if (remaining[i] === w) remaining.splice(i, 1); }
  }

  // Calculate payout proportional to tickets held by each winner
  const gross = round.total_sats_collected || 0;
  const payoutPool = potPayout(gross);
  // The cut is what funds pot seeding and referral rewards; see server/house.js.
  houseCredit(gross - payoutPool, `round ${round.id} cut`);
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

  // Credit winnings directly to player wallets.
  // A bot's share goes back into the next pot rather than into a balance —
  // bots appear in the results so a round looks alive, but they must never
  // accumulate sats a real player could otherwise have withdrawn.
  let botShare = 0;
  for (const npub of winners) {
    const payout = payouts[npub];
    if (payout <= 0) continue;
    const isBot = db.prepare('SELECT COALESCE(is_bot, 0) AS b FROM players WHERE npub=?').get(npub)?.b;
    if (isBot) {
      botShare += payout;
      console.log(`[Lottery] ${payout} sats won by bot ${npub.slice(0,12)} — returned to pot`);
    } else {
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
  if (botShare > 0) {
    db.prepare(`UPDATE lottery_rounds SET total_sats_collected = total_sats_collected + ?
                WHERE status='open'`).run(botShare);
  }
  return { ok:true, round_id:round.id, winners: winnerList, total_tickets:tickets.length,
           pot_sats: payoutPool, bot_share_returned: botShare };
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
      pot_sats: potPayout(round.total_sats_collected),
      total_tickets: tickets.length,
      unique_players: uniquePlayers,
    });
  }, 1000);

  // Hourly solvency check. A shortfall means sats were credited that no
  // deposit backs, so a withdrawal run could not be honoured.
  cron.schedule('7 * * * *', () => {
    const s = solvency();
    if (s.gap < 0) {
      console.error(`[House] SHORTFALL ${-s.gap} sats — players hold ${s.held}, ledger ${s.house}, backing ${s.backing}`);
    }
  });

  console.log(`[Lottery] Cron active — draws ${DRAW_LABEL} Berlin + WS tick every second`);
}
