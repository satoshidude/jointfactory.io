/**
 * Shared economy — single source of truth for every curve and formula in the game.
 *
 * Plain ESM JavaScript so the Vite client (src/game/useGameLoop.ts) and the Node
 * server (server/*.js) import the exact same numbers. Anything that decides how
 * many joints a player has, what a ticket costs, or how much a boost is worth
 * belongs here — not in a component and not duplicated per side.
 *
 * Currency rule that runs through all of it: joints are earned by playing and buy
 * tickets, speed, levels and capacity; sats are real money and buy boosts and
 * managers. Game logic never destroys what sats paid for.
 */

// ── Plantations ──────────────────────────────────────────────────────────────
/**
 * Level-up cost growth per plantation.
 *
 * The old 1.28 outran output growth (~1.07/level from linear level × milestone
 * multipliers) by 19 % a level and walled every endgame player at ~level 85 —
 * one more MegaFarm level cost the top account 18 days of idling, which is why
 * all six endgame players sat at the same rate.
 *
 * 1.12 leaves a gentle slope rather than a wall no amount of play gets past.
 * rehydrate() writes these defs onto every save, so changing this value reprices
 * every existing plantation at once.
 * Try a candidate with: node scripts/sim-economy.mjs 30 --upgmult=1.15
 */
export const UPG_MULT = Number(globalThis.process?.env?.JF_UPG_MULT) || 1.12

export const PLANTATION_DEFS = [
  { id: 0, name: 'Balcony Grow',   icon: '\u{1F331}', baseProd: 5,       cycleTime: 4,   upgBase: 8,         upgMult: UPG_MULT, mgrCost: 20,  unlockCost: 0 },
  { id: 1, name: 'Outdoor Plot',   icon: '\u{1F331}', baseProd: 60,      cycleTime: 5,   upgBase: 400,       upgMult: UPG_MULT, mgrCost: 100, unlockCost: 50_000 },
  { id: 2, name: 'Indoor Room',    icon: '\u{1F3E0}', baseProd: 400,     cycleTime: 4,   upgBase: 15_000,    upgMult: UPG_MULT, mgrCost: 150, unlockCost: 2_000_000 },
  { id: 3, name: 'Hydroponic Lab', icon: '\u{1F4A7}', baseProd: 3_000,   cycleTime: 3,   upgBase: 100_000,   upgMult: UPG_MULT, mgrCost: 200, unlockCost: 100_000_000 },
  { id: 4, name: 'Greenhouse',     icon: '\u{1F333}', baseProd: 25_000,  cycleTime: 2.5, upgBase: 500_000,   upgMult: UPG_MULT, mgrCost: 250, unlockCost: 10_000_000_000 },
  { id: 5, name: 'MegaFarm',       icon: '\u{1F3ED}', baseProd: 250_000, cycleTime: 2,   upgBase: 2_500_000, upgMult: UPG_MULT, mgrCost: 300, unlockCost: 1_000_000_000_000 },
]

// Milestone cycle: every 10 levels → ×2, then 15 → ×3, then 20 → ×4, repeat.
/**
 * Milestones: a doubling every 10, then 15, then 20 levels, repeating — and no
 * more than ten doublings in total.
 *
 * It used to be x2, then x3, then x4, uncapped. That compounds by x24 every 45
 * levels, so a plot at level 145 carried a x27,600 multiplier and the top
 * accounts were producing tens of billions a second, in steps: hitting a
 * milestone quadrupled a chain in one click. Uniform doublings grow by x8 per 45
 * levels instead, and the cap turns the curve linear where it used to run away.
 *
 * The cap sits at ten doublings, which is level 145 — where the furthest player
 * stands today. Past it a level still adds output, just not another factor.
 */
export const MILESTONE_CYCLE = [
  { gap: 10, mult: 2 },
  { gap: 15, mult: 2 },
  { gap: 20, mult: 2 },
]

export const MILESTONE_CAP = 1024

export function plantMilestoneInfo(level) {
  let multiplier = 1
  let remaining = level
  let cycleIdx = 0
  while (remaining >= MILESTONE_CYCLE[cycleIdx % MILESTONE_CYCLE.length].gap) {
    const ms = MILESTONE_CYCLE[cycleIdx % MILESTONE_CYCLE.length]
    remaining -= ms.gap
    multiplier *= ms.mult
    cycleIdx++
    // Capped: the plot keeps growing with its level, but not by another factor.
    if (multiplier >= MILESTONE_CAP) {
      return { multiplier: MILESTONE_CAP, levelsToNext: 0, nextMult: 1, capped: true }
    }
  }
  const next = MILESTONE_CYCLE[cycleIdx % MILESTONE_CYCLE.length]
  return { multiplier, levelsToNext: next.gap - remaining, nextMult: next.mult, capped: false }
}

/** Cannabis per production cycle. `globalMult` carries bought speed + boosts. */
export function plantOutput(p, globalMult = 1) {
  const { multiplier } = plantMilestoneInfo(p.level)
  return p.level * p.baseProd * multiplier * globalMult
}

export function plantEffectiveCycle(p) {
  return p.speed > 0 ? p.cycleTime / p.speed : p.cycleTime
}

export function plantRate(p, globalMult = 1) {
  return plantOutput(p, globalMult) / plantEffectiveCycle(p)
}

export function plantLevelCost(p) {
  return Math.floor(p.upgBase * Math.pow(p.upgMult, p.level))
}

// Per-station speed levels are no longer sold — the global speed ladder below
// replaced them. Saved `speed` values still divide every cycle time, so what
// players bought keeps working; there is simply nothing that mints new ones.

// ── Courier / factory ────────────────────────────────────────────────────────

export const COST_SCALE = 2.5 // courier/fabrik capacity upgrade cost multiplier

/** @param {any} c @param {number} [boostMult] @returns {number} */
export function courierTripTime(c, boostMult = 1) {
  const speed = c.speed * boostMult
  return speed > 0 ? c.tripDuration / speed : c.tripDuration
}

/** @param {any} f @param {number} [boostMult] @returns {number} */
export function fabrikCycleTime(f, boostMult = 1) {
  const speed = f.speed * boostMult
  return speed > 0 ? f.processTime / speed : f.processTime
}

// ── Managers ─────────────────────────────────────────────────────────────────
// FREE_MANAGERS matches REQUIRED_MANAGERS for the lottery on purpose: a new
// player must be able to reach the reward loop without depositing bitcoin.
//
// Beyond the free three, a manager costs sats (see mgrCost in PLANTATION_DEFS:
// 100, 150, 200, 250, 300). Automating all six plantations is 1000 sats, all of
// which passes through the lottery pot — the old 30-to-200 scale was small
// enough that the whole ladder cost less than a couple of boosts.

export const FREE_MANAGERS = 3
export const REQUIRED_MANAGERS = 3

/** Total managers hired across all stations. Accepts a state object or JSON string. */
/** @param {any} gameState @returns {number} */
export function countManagers(gameState) {
  if (!gameState) return 0
  let gs = gameState
  if (typeof gs === 'string') {
    try { gs = JSON.parse(gs) } catch { return 0 }
  }
  let count = 0
  for (const p of gs.plantagen || []) { if (p.managerLevel > 0) count++ }
  if (gs.courier?.mgrLevel > 0) count++
  if (gs.fabrik?.mgrLevel > 0) count++
  return count
}

/** Managers on the three stations the lottery requires (plant #1, courier, factory). */
/** @param {any} gameState @returns {number} */
export function countLotteryManagers(gameState) {
  if (!gameState) return 0
  let gs = gameState
  if (typeof gs === 'string') {
    try { gs = JSON.parse(gs) } catch { return 0 }
  }
  let count = 0
  if (gs.plantagen?.[0]?.managerLevel > 0) count++
  if (gs.courier?.mgrLevel > 0) count++
  if (gs.fabrik?.mgrLevel > 0) count++
  return count
}

// ── Boosts (the recurring sats sink) ─────────────────────────────────────────
// Permanent upgrades exhaust themselves; consumables keep the same sats cycling
// through pot → winners → boosts → pot, burning the 20 % house cut each lap.

export const BOOSTS = {
  fertilizer:   { id: 'fertilizer',   name: 'Fertilizer',   short: '2x Grow',    cost: 21,  durationSec: 1800, plant: 2 },
  express:      { id: 'express',      name: 'Express Run',  short: '3x Courier', cost: 21,  durationSec: 1800, courier: 3 },
  doubleshift:  { id: 'doubleshift',  name: 'Double Shift', short: '2x Factory', cost: 21,  durationSec: 1800, fabrik: 2 },
  fullthrottle: { id: 'fullthrottle', name: 'Full Throttle', short: '2x Everything', cost: 50,  durationSec: 3600, plant: 2, courier: 2, fabrik: 2 },
}

/**
 * Fold a list of `{ type, expires_at }` rows into per-station multipliers.
 * Same type extends its expiry (see server/boosts.js); different types combine.
 *
 * @param {Array<{ type: string, expires_at: number }> | null | undefined} activeBoosts
 * @param {number} nowSec
 * @returns {{ plant: number, courier: number, fabrik: number }}
 */
export function boostMultipliers(activeBoosts, nowSec) {
  const m = { plant: 1, courier: 1, fabrik: 1 }
  for (const b of activeBoosts || []) {
    if (!b || b.expires_at <= nowSec) continue
    const def = BOOSTS[b.type]
    if (!def) continue
    if (def.plant) m.plant *= def.plant
    if (def.courier) m.courier *= def.courier
    if (def.fabrik) m.fabrik *= def.fabrik
  }
  return m
}

// ── Speed (the scaling joints sink) ─────────────────────────────────────────
//
// Joints buy permanent speed for the whole chain. This replaces prestige, which
// failed on comprehension twice: seeds were a second abstract currency, earned
// only by resetting, measured in a unit nobody feels (quadrillions of lifetime
// joints), and worth less with every one you owned — at 343 seeds another was
// worth +0.28 %.
//
// The price is denominated in *seconds of the buyer's own production*, not in a
// fixed number of joints. That is what makes the ceiling hold: income grows by
// something like a factor of 10^12 over a month, so any fixed joint curve gets
// outrun — an earlier draft aimed at +20 % a month and produced x51.

export const SPEED_STEP = 0.02

/** Ceiling on speed growth: spending a full month's output buys at most +20 %. */
export const SPEED_MONTHLY_CAP = 1.20

const MONTH_SECONDS = 30 * 86400
const STEPS_PER_MONTH = Math.log(SPEED_MONTHLY_CAP) / Math.log(1 + SPEED_STEP)

/** Cost ceiling per step, derived from the monthly cap — about 3.26 days. */
export const SPEED_MAX_SECONDS = MONTH_SECONDS / STEPS_PER_MONTH

const SPEED_FIRST_SECONDS = 300   // the first step is five minutes of output
const SPEED_SECONDS_GROWTH = 1.35 // ~24 steps to reach the ceiling

/**
 * Production time the next step costs, in seconds.
 * Grows geometrically until it hits the monthly-cap ceiling, then stays flat.
 *
 * @param {number} level steps already bought
 * @returns {number}
 */
export function speedCostSeconds(level) {
  return Math.min(SPEED_MAX_SECONDS, SPEED_FIRST_SECONDS * Math.pow(SPEED_SECONDS_GROWTH, level || 0))
}

/**
 * Price of the next speed step in joints.
 *
 * @param {number} level steps already bought
 * @param {number} rate joints per second, including speed, excluding boosts
 * @returns {number}
 */
export function speedCost(level, rate) {
  return Math.max(1, Math.round((rate || 0) * speedCostSeconds(level)))
}

/**
 * Chain-wide multiplier from bought speed. Multiplicative, so +2 % is always
 * worth +2 % — the property the additive seed bonus lacked.
 *
 * @param {number} level
 * @returns {number}
 */
export function speedMultiplier(level) {
  return Math.pow(1 + SPEED_STEP, level || 0)
}

// ── Throughput ───────────────────────────────────────────────────────────────
// The real joints/sec is the bottleneck of the chain, not the plantation sum.
// Reporting the plantation sum made the leaderboard and growth race show numbers
// players never actually earned — a player without a factory manager earns zero.

/**
 * @param {any} gs
 * @param {{ speedLevel?: number, boosts?: Array<{ type: string, expires_at: number }>, nowSec?: number }} [opts]
 * @returns {{ plant: number, courier: number, fabrik: number, jointsPerSec: number }}
 */
export function throughput(gs, { speedLevel = 0, boosts = [], nowSec = 0, ignoreManagers = false } = {}) {
  const empty = { plant: 0, courier: 0, fabrik: 0, jointsPerSec: 0 }
  if (!gs || !gs.plantagen) return empty

  const m = boostMultipliers(boosts, nowSec)
  // Chain-wide, not a plantation bonus. Applying a multiplier to plantations
  // alone is worthless: the chain is capped by its weakest stage, so a bonus
  // sitting behind a narrow courier buys nothing.
  const speed = speedMultiplier(speedLevel)

  // ignoreManagers asks what the chain could produce if every station ran flat
  // out — which is what a player tapping by hand is aiming at. It is the ceiling
  // the save guard needs: measured against automated output alone, a newcomer
  // who has not hired all three managers has a modelled rate of zero, and every
  // joint they tapped for was clamped away on the next save.
  const runs = (level) => ignoreManagers || level > 0

  let plant = 0
  for (const p of gs.plantagen) {
    if (runs(p.managerLevel)) plant += plantRate(p, speed * m.plant)
  }

  const c = gs.courier
  const f = gs.fabrik
  // Courier does a round trip per load, so throughput is capacity / (2 × trip).
  const courier = c && runs(c.mgrLevel) ? speed * c.capacity / (2 * courierTripTime(c, m.courier)) : 0
  const fabrik = f && runs(f.mgrLevel) ? speed * f.capacity / fabrikCycleTime(f, m.fabrik) : 0

  return { plant, courier, fabrik, jointsPerSec: Math.min(plant, courier, fabrik) }
}

// ── Lottery pot ──────────────────────────────────────────────────────────────

/**
 * Share of the pot paid out to winners; the rest is the house cut.
 *
 * `lottery_rounds.total_sats_collected` holds the **gross** sats a round has
 * collected. The cut is taken exactly once, at payout. It used to be applied
 * twice — sats spend entered the pot already reduced by 20 %, and the draw took
 * another 20 % off that — so a player got 57–64 % back from a loop advertised
 * as 80 %. Anything writing to or reading from the pot uses this constant.
 */
export const POT_PAYOUT_SHARE = 0.8

/** Sats paid out to winners for a given gross pot. */
export function potPayout(grossSats) {
  return Math.floor((grossSats || 0) * POT_PAYOUT_SHARE)
}

/** Hard ceiling on winners per draw, whatever the turnout. */
export const MAX_WINNERS = 21

/** Fraction of participants that wins a draw. */
export const WINNER_SHARE = 1 / 3

/**
 * How many of `participants` win a draw.
 *
 * A third of the field, rounded up, with a floor of two.
 *
 * The floor is what round 904 was missing: two entrants made one winner, who
 * took the whole 721-sat pot while the other had paid a full ticket. At this
 * game's turnout — four players on a good day — a third rounds down to "one
 * takes everything" almost every time. From three entrants up there is still
 * always somebody who goes home empty, which is what keeps it a draw; at two,
 * both are paid but the draw decides who gets 70 % and who gets 30 %.
 *
 * (Before that it took min(21, participants), so with 21 or fewer entrants
 * everyone "won" and the pot was split by ticket count — no chance involved at
 * all. The largest turnout in 468 rounds with tickets was eight.)
 *
 * @param {number} participants
 * @returns {number}
 */
export function winnerCount(participants) {
  if (participants <= 0) return 0
  if (participants === 1) return 1
  return Math.min(MAX_WINNERS, participants, Math.max(2, Math.ceil(participants * WINNER_SHARE)))
}

/**
 * How the payout splits between the winners of a draw, by rank.
 *
 * It used to go by ticket count among the drawn winners, which at this game's
 * real turnout meant one player taking everything: two entrants produce one
 * winner, and the other went home with nothing after paying a full ticket. The
 * draw still decides the order — that is where the chance lives — but second
 * place is now worth something.
 *
 * The table covers the sizes this game actually reaches; the largest turnout in
 * 468 rounds with tickets was eight. `prizeShares` continues it geometrically so
 * the rule is defined all the way to MAX_WINNERS rather than having a hole.
 */
export const PRIZE_SPLIT = {
  1: [1],
  2: [0.70, 0.30],
  3: [0.60, 0.25, 0.15],
  4: [0.50, 0.25, 0.15, 0.10],
  5: [0.44, 0.23, 0.15, 0.10, 0.08],
  6: [0.40, 0.22, 0.14, 0.10, 0.08, 0.06],
}

const PRIZE_TAIL_RATIO = 0.75

/**
 * Shares for `n` winners, summing to 1.
 *
 * @param {number} n
 * @returns {number[]}
 */
export function prizeShares(n) {
  const count = Math.max(0, Math.floor(n || 0))
  if (count === 0) return []
  if (PRIZE_SPLIT[count]) return PRIZE_SPLIT[count]
  const weights = Array.from({ length: count }, (_, i) => Math.pow(PRIZE_TAIL_RATIO, i))
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map(w => w / total)
}

/**
 * Whole-sat payouts for a pot, by rank. The rounding remainder goes to first
 * place, so the parts always add up to the pot exactly.
 *
 * @param {number} pot sats to distribute
 * @param {number} winners
 * @returns {number[]}
 */
export function prizeAmounts(pot, winners) {
  const shares = prizeShares(winners)
  if (shares.length === 0) return []
  const amounts = shares.map(share => Math.floor((pot || 0) * share))
  amounts[0] += (pot || 0) - amounts.reduce((a, b) => a + b, 0)
  return amounts
}

// ── Lottery tickets (the scaling joints sink) ────────────────────────────────
//
// Two calibration points define the whole curve:
//   a top player affords four tickets a day, a beginner one every two days.
//
// A single "seconds of production per ticket" figure cannot do that — it gives
// everyone the same tickets per day whatever their rate. So the yardstick moves
// with the player: a beginner pays many days of output per ticket, a top player
// a few hours, interpolated on a log-rate axis between the two anchors.
//
// The daily cap exists on top of the pricing because it has to. Balances carry
// over from the old economy — the largest is about thirteen days of production
// banked — so price alone would let a hoarder empty the round on day one.

// Per draw, not per calendar day. The cap used to sit on the day while draws sit
// on the week: with two or three days between them a daily player accumulated
// eight to twelve tickets against a casual player's one — 92 % odds against 8 %.
// Four per round holds the spread at 4:1, and "four tickets per draw" is also the
// simpler sentence.
export const MAX_TICKETS_PER_ROUND = 4
export const DAY_SECONDS = 86400

/**
 * Share of one day's production each of the four daily tickets costs, for a
 * player at the top anchor. Rising, so a further ticket the same day costs
 * more; the four together are exactly one day of output.
 *
 * The first was 15 %, i.e. 3.6 hours of production. Reachable in principle, but
 * not in practice: levels pay themselves back in seconds, so an active player's
 * balance is always freshly spent and the ticket sat permanently out of reach.
 * At 10 % the first one is about two and a half hours of output — long enough to
 * be a decision, short enough to be a plan. The steeper tail keeps the full
 * allowance at one day, so nobody sweeps a round cheaply.
 */
export const TICKET_DAY_SHARE = [0.10, 0.18, 0.28, 0.44]

/** A fresh plantation with the three free managers: 1.25 joints/s. */
export const RATE_BEGINNER = 1.25
/**
 * Where the beginner discount runs out: at or above this rate a ticket costs
 * exactly its share of the buyer's day. It was set from the fastest player at
 * the time; the leaders have since passed it by more than an order of magnitude,
 * which changes nothing for them — the scale simply bottoms out at 1.
 */
export const RATE_TOP = 1.6e9

// Beginner target: the first ticket of the day costs two days of production.
const BEGINNER_SCALE = (2 * DAY_SECONDS) / (DAY_SECONDS * TICKET_DAY_SHARE[0])

/**
 * Multiplier on the top-anchor price, by production rate.
 * 1 at the top anchor, ~13.3 at the beginner anchor, log-interpolated between.
 *
 * @param {number} rate joints per second
 * @returns {number}
 */
export function ticketScale(rate) {
  if (!rate || rate <= RATE_BEGINNER) return BEGINNER_SCALE
  if (rate >= RATE_TOP) return 1
  const t = Math.log10(rate / RATE_BEGINNER) / Math.log10(RATE_TOP / RATE_BEGINNER)
  return BEGINNER_SCALE + t * (1 - BEGINNER_SCALE)
}

/**
 * Price of a player's next ticket.
 *
 * @param {number} held tickets already held in this round
 * @param {number} rate joints per second
 * @returns {number}
 */
export function ticketPrice(held, rate) {
  const n = Math.min(Math.max(0, held), TICKET_DAY_SHARE.length - 1)
  return Math.max(1, Math.round(rate * DAY_SECONDS * TICKET_DAY_SHARE[n] * ticketScale(rate)))
}

/**
 * Prices for the next few tickets of today's allowance.
 *
 * Capped at three: showing the whole remaining allowance made the row wide and
 * the far entries are not a decision anyone is making yet.
 *
 * @param {number} held tickets already held in this round
 * @param {number} rate
 * @param {number} [limit]
 */
export function ticketPreview(held, rate, limit = 3) {
  const out = []
  for (let n = held; n < MAX_TICKETS_PER_ROUND && out.length < limit; n++) {
    out.push({ n: n + 1, cost: ticketPrice(n, rate) })
  }
  return out
}

// ── Initial / reset state ────────────────────────────────────────────────────
// Lives here because the server builds starting state too — a new account is
// created server-side and must match what the client would have produced.

export function newPlantation(def) {
  return {
    id: def.id, name: def.name, icon: def.icon,
    level: 1, baseProd: def.baseProd, cycleTime: def.cycleTime,
    timer: def.cycleTime, speed: 1, speedLevel: 0,
    managerLevel: 0, mgrCost: def.mgrCost,
    upgBase: def.upgBase, upgMult: def.upgMult,
    totalProduced: 0,
  }
}

export function initialState() {
  return {
    cannabis: 0,
    cannabisAtFactory: 0,
    plantagen: [newPlantation(PLANTATION_DEFS[0])],
    _unlockIdx: 0,
    courier: {
      state: 'idle', posX: 15, carrying: 0,
      capacity: 20, speed: 1, speedLevel: 0,
      tripTimer: 0, tripDuration: 4,
      mgrLevel: 0, mgrCost: 20,
      capCost: 200, speedCost: 0,
    },
    fabrik: {
      capacity: 100, speed: 1, speedLevel: 0,
      processing: false, timer: 0, processTime: 8,
      autoTimer: 0, mgrLevel: 0, mgrCost: 20,
      capCost: 400, speedCost: 0,
      total: 0, _currentCharge: 0,
    },
    _ts: Date.now(),
  }
}

/**
 * Overwrite definition-derived fields in a loaded save from PLANTATION_DEFS.
 *
 * newPlantation() copies static data (name, icon, baseProd, cycleTime, upgBase,
 * upgMult, mgrCost) into the persisted state, so anything changed in the defs
 * never reached existing players: the very first account still showed the
 * Lightning-Mines era names (NerdMiner, BitAxe, Antminer S9 …) months after the
 * theme changed, and a retuned upgMult would have been silently ignored for all
 * 34 saves the same way. Call this on every load, client and server.
 *
 * Only genuine player state survives: level, timer, speed, speedLevel,
 * managerLevel, totalProduced, capacity, capCost.
 */
/** @template T @param {T} gs @returns {T} */
/**
 * Joints the difference between two saved states must have cost.
 *
 * Levels, capacity and unlocks are bought in the client — the server only ever
 * sees the result. Without pricing the difference, a state that claims a higher
 * level while reporting an untouched balance is indistinguishable from an honest
 * one, and the upgrade is free. The save guard subtracts this from what the
 * balance may plausibly be.
 *
 * Prices come from the *previous* state, which is the one the player actually
 * paid against. Anything that did not grow costs nothing.
 *
 * @param {any} prev stored state
 * @param {any} next incoming state
 * @returns {number} joints
 */
export const MAX_LEVEL_STEP = 500

/**
 * Largest level jump between two states. A save is at most a second or two of
 * clicking apart, so anything past MAX_LEVEL_STEP is not a purchase history —
 * and pricing it would mean running the cost formula that many times on the save
 * path, which is a free way to burn the server's CPU.
 *
 * @param {any} prev @param {any} next @returns {number}
 */
export function maxLevelJump(prev, next) {
  if (!prev?.plantagen || !next?.plantagen) return 0
  let jump = 0
  for (let i = 0; i < next.plantagen.length; i++) {
    const before = prev.plantagen[i]?.level ?? 0
    const after = next.plantagen[i]?.level ?? 0
    jump = Math.max(jump, after - before)
  }
  return jump
}

export function progressCost(prev, next) {
  return progressBreakdown(prev, next).cost
}

/**
 * The same difference, itemised — which is what makes the spending readable
 * afterwards. Levels, capacity and unlocks are bought in the client, so without
 * this the largest joints sink in the game leaves no trace at all: the server
 * only ever sees the resulting state.
 *
 * @param {any} prev stored state
 * @param {any} next incoming state
 * @returns {{cost: number, levels: number, level_cost: number, capacity: number,
 *            capacity_cost: number, unlocks: number, unlock_cost: number}}
 */
export function progressBreakdown(prev, next) {
  const out = {
    cost: 0,
    levels: 0, level_cost: 0,
    capacity: 0, capacity_cost: 0,
    unlocks: 0, unlock_cost: 0,
  }
  if (!prev?.plantagen || !next?.plantagen) return out

  for (let i = 0; i < next.plantagen.length; i++) {
    const before = prev.plantagen[i]
    const after = next.plantagen[i]
    if (!after) continue
    if (!before) {
      // A plot that was not there before had to be unlocked.
      out.unlocks += 1
      out.unlock_cost += PLANTATION_DEFS[i]?.unlockCost || 0
      continue
    }
    // Each level is priced from the level below it, up to a bounded number of
    // steps — see maxLevelJump for why the loop must not follow an arbitrary
    // claim.
    const walker = { ...before }
    const top = Math.min(after.level || 0, before.level + MAX_LEVEL_STEP)
    for (let lvl = before.level; lvl < top; lvl++) {
      walker.level = lvl
      out.levels += 1
      out.level_cost += plantLevelCost(walker)
    }
  }

  // Capacity doubles per purchase and the price scales with it, so the cost of
  // going from one capacity to another is the geometric run of capCost.
  for (const key of ['courier', 'fabrik']) {
    const before = prev[key]
    const after = next[key]
    if (!before || !after) continue
    let capacity = before.capacity || 0
    let price = before.capCost || 0
    // Doubling reaches any reachable number in a few dozen steps; the bound is
    // there so a nonsense capacity cannot spin the loop.
    for (let step = 0; step < 64 && capacity > 0 && capacity < (after.capacity || 0); step++) {
      out.capacity += 1
      out.capacity_cost += price
      capacity *= 2
      price = Math.floor(price * COST_SCALE)
    }
  }

  out.cost = out.level_cost + out.capacity_cost + out.unlock_cost
  return out
}

export function rehydrate(gs) {
  if (!gs || !gs.plantagen) return gs

  gs.plantagen.forEach((p, idx) => {
    const defIdx = Number.isInteger(p.id) && PLANTATION_DEFS[p.id] ? p.id : idx
    const def = PLANTATION_DEFS[defIdx]
    if (!def) return
    p.id = def.id
    p.name = def.name
    p.icon = def.icon
    p.baseProd = def.baseProd
    p.cycleTime = def.cycleTime
    p.upgBase = def.upgBase
    p.upgMult = def.upgMult
    p.mgrCost = def.mgrCost
  })

  const fresh = initialState()
  if (gs.courier) {
    gs.courier.tripDuration = fresh.courier.tripDuration
    gs.courier.mgrCost = fresh.courier.mgrCost
  }
  if (gs.fabrik) {
    gs.fabrik.processTime = fresh.fabrik.processTime
    gs.fabrik.mgrCost = fresh.fabrik.mgrCost
  }

  return gs
}
