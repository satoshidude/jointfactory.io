import { randomInt } from 'crypto';
import { db, ensureOpenRound, logEvent } from './db.js';
import { DRAW_LABEL } from '../shared/schedule.js';
import { potPayout, ticketPrice, ticketPreview, winnerCount, countLotteryManagers,
         prizeAmounts, prizeShares, MAX_WINNERS, MAX_TICKETS_PER_ROUND,
         REQUIRED_MANAGERS } from '../shared/economy.js';
import cron from 'node-cron';
import * as wsHub from './ws.js';
import { publishLotteryWinNote } from './zap.js';
import { houseCredit, solvency } from './house.js';
import { rollupDay, yesterday, pruneEvents } from './metrics.js';
import { playerRate } from './speed.js';

export { MAX_WINNERS };
export const SAT_PER_TICKET = 100;

export { MAX_TICKETS_PER_ROUND };

// Ticket prices are measured against the same rate the speed ladder uses —
// server-computed from the stored state, boosts excluded. See server/speed.js.

/**
 * Tickets this account holds in a round — the allowance, and the index the price
 * curve steps along.
 *
 * It used to count the last 24 hours, which put the cap on the calendar while
 * the draw sits on the week: two or three days between draws let a daily player
 * carry eight to twelve tickets into a round against a casual player's one.
 * Counting per round holds the spread at four to one.
 */
export function ticketsInRound(npub, roundId = null) {
  if (!npub) return 0;
  const id = roundId ?? getCurrentRound()?.id;
  if (!id) return 0;
  return db.prepare('SELECT COUNT(*) AS n FROM lottery_tickets WHERE npub = ? AND round_id = ?')
    .get(npub, id)?.n || 0;
}

export function getTicketPrice(npub) {
  return ticketPrice(ticketsInRound(npub), playerRate(npub));
}

/**
 * May this account enter a draw?
 *
 * The three-manager rule was only ever enforced in the UI, which made it an
 * open door: a ticket costs a share of the buyer's production, and an account
 * with no chain produces nothing, so the price fell to the one-joint floor.
 * Four joints bought four entries in a round paying real sats. The rule lives
 * here now, and the page reads it from here instead of guessing.
 */
export function ticketEligibility(npub) {
  const row = db.prepare('SELECT game_state FROM players WHERE npub = ?').get(npub);
  const managers = countLotteryManagers(row?.game_state);
  return {
    eligible: managers >= REQUIRED_MANAGERS,
    managers,
    required: REQUIRED_MANAGERS,
    missing: Math.max(0, REQUIRED_MANAGERS - managers),
  };
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
  return ticketPreview(ticketsInRound(npub), playerRate(npub));
}

// Atomic ticket purchase transaction
const _buyTicketTx = db.transaction((npub, roundId) => {
  // Counted and priced inside the transaction, from the same rows the deduction
  // reads, so two concurrent purchases cannot both pass the daily check.
  const { eligible, missing } = ticketEligibility(npub);
  if (!eligible) {
    return { ok: false, reason: `Automate the chain first — ${missing} more manager${missing === 1 ? '' : 's'} needed` };
  }
  const held = ticketsInRound(npub, roundId);
  if (held >= MAX_TICKETS_PER_ROUND) {
    return { ok: false, reason: `That is your ${MAX_TICKETS_PER_ROUND} for this draw — the next one opens after tonight's` };
  }
  const cost = ticketPrice(held, playerRate(npub));
  // Atomic deduct joints — WHERE joints >= cost prevents overspend
  const deducted = db.prepare(
    'UPDATE players SET joints = joints - ?, joints_rev = joints_rev + 1 WHERE npub = ? AND joints >= ?'
  ).run(cost, npub, cost);
  if (deducted.changes === 0) return { ok: false, reason: `Not enough Joints (${cost} needed)` };
  db.prepare('INSERT INTO lottery_tickets (round_id, npub, joints_cost) VALUES (?, ?, ?)').run(roundId, npub, cost);
  return { ok: true, myCount: getMyTicketCount(npub, roundId), heldInRound: held + 1, cost };
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

  // The balance goes back with the response so the client can adopt it. Without
  // it the client keeps its own figure, the deduction stays invisible, and the
  // next autosave used to undo it outright.
  const bal = db.prepare('SELECT joints, joints_rev FROM players WHERE npub=?').get(npub);
  const balance = bal?.joints ?? 0;
  logEvent(npub, 'ticket', result.cost, { round: round.id, nth_in_round: result.heldInRound });

  return { ok:true, round_id:round.id, my_tickets:result.myCount, total_tickets:allTickets.length,
    pool_sats:updatedRound.total_sats_collected, draws_at:round.draws_at,
    tickets_this_round: result.heldInRound, max_tickets_per_round: MAX_TICKETS_PER_ROUND,
    joints: balance, joints_rev: bal?.joints_rev ?? 0, cost: result.cost,
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
    // Nobody entered — the pot goes to the house.
    //
    // It used to roll into the next round, which sounds generous but pays the
    // operator's own sats forward indefinitely: a dormant week compounds a pot
    // nobody played for, and the money can only leave again as a payout. An
    // unentered round has no claim on it, so it settles as revenue. The pot
    // players see is fed by what players spend, not by what an empty round
    // carried over.
    const unclaimed = round.total_sats_collected || 0;
    db.prepare(`UPDATE lottery_rounds SET status='closed' WHERE id=?`).run(round.id);
    ensureOpenRound();
    if (unclaimed > 0) {
      houseCredit(unclaimed, `round ${round.id} unclaimed — no entries`);
      logEvent(null, 'draw', unclaimed, { round: round.id, entries: 0, to_house: unclaimed });
      console.log(`[Lottery] Round ${round.id} had no entries — ${unclaimed} sats to the house`);
    }
    return { ok:true, winners:[], to_house: unclaimed };
  }
  // Count tickets per player
  const ticketsByPlayer = {};
  for (const t of tickets) {
    ticketsByPlayer[t.npub] = (ticketsByPlayer[t.npub] || 0) + 1;
  }
  const totalTickets = tickets.length;
  const entrants = Object.keys(ticketsByPlayer).length;

  // A draw needs somebody to lose to.
  //
  // With one entrant there is no chance involved — they would simply be handed
  // the pot for having been the only one paying attention. The round carries
  // instead: pot and tickets move to the next one, so nothing is taken from the
  // player who did turn up, and the next draw is worth more.
  if (entrants < 2) {
    const carried = round.total_sats_collected || 0;
    db.prepare(`UPDATE lottery_rounds SET status='closed' WHERE id=?`).run(round.id);
    ensureOpenRound();
    const next = getCurrentRound();
    if (next) {
      // Tickets move with the pot, so they keep their value — and keep counting
      // against the four-per-draw allowance, which is what stops a carry from
      // being a way to stockpile.
      db.prepare('UPDATE lottery_tickets SET round_id = ? WHERE round_id = ?').run(next.id, round.id);
      if (carried > 0) {
        db.prepare('UPDATE lottery_rounds SET total_sats_collected = total_sats_collected + ? WHERE id = ?')
          .run(carried, next.id);
      }
    }
    logEvent(null, 'draw', carried, { round: round.id, entries: entrants, tickets: totalTickets, carried: true, to_round: next?.id ?? null });
    console.log(`[Lottery] Round ${round.id} had ${entrants} entrant — ${carried} sats and ${totalTickets} ticket(s) carried to round ${next?.id}`);
    return { ok: true, winners: [], carried, carried_to: next?.id ?? null, entrants };
  }

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

  // Payout by rank, in the order the draw produced.
  //
  // It used to divide by ticket count among the winners, which at this turnout
  // put the whole pot in one pair of hands: two entrants make one winner, and
  // the other paid a full ticket for nothing. Chance still decides the order —
  // more tickets, more likely to be drawn first — but the runner-up is paid.
  const gross = round.total_sats_collected || 0;
  const payoutPool = potPayout(gross);
  // The cut is what funds pot seeding and withdrawals; see server/house.js.
  houseCredit(gross - payoutPool, `round ${round.id} cut`);

  const amounts = prizeAmounts(payoutPool, winners.length);
  const payouts = {}; // { npub: sats }
  winners.forEach((npub, i) => { payouts[npub] = amounts[i] || 0; });

  // A rank whose share rounds to nothing is not a win. Drop it, and hand what it
  // would have had to first place, so the pot still adds up.
  const paidWinners = winners.filter(npub => payouts[npub] > 0);
  if (paidWinners.length < winners.length) {
    for (const npub of winners) if (payouts[npub] === 0) delete payouts[npub];
    winners.length = 0;
    winners.push(...paidWinners);
  }

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
  logEvent(null, 'draw', gross, { round: round.id, entries: new Set(pool).size, tickets: totalTickets,
                                  winners: winners.length, paid: payoutPool - botShare, cut: gross - payoutPool, bot_share: botShare });
  for (const npub of winners) logEvent(npub, 'win', payouts[npub] || 0, { round: round.id, tickets: ticketsByPlayer[npub] });

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
                WHERE id = (SELECT id FROM lottery_rounds WHERE status = 'open' ORDER BY id DESC LIMIT 1)`).run(botShare);
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

  // Roll yesterday up shortly after Berlin midnight, and today again every
  // hour, so a look at the numbers is never more than an hour stale. Rebuilding
  // a day is idempotent — every figure is derived, nothing is incremented.
  cron.schedule('12 0 * * *', () => {
    try {
      rollupDay(yesterday());
      pruneEvents();
    } catch (err) { console.error('[Metrics] daily rollup failed:', err.message); }
  }, { timezone: 'Europe/Berlin' });

  cron.schedule('*/30 * * * *', () => {
    try { rollupDay(); } catch (err) { console.error('[Metrics] rollup failed:', err.message); }
  }, { timezone: 'Europe/Berlin' });

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
