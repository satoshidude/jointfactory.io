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
export const MILESTONE_CYCLE = [
  { gap: 10, mult: 2 },
  { gap: 15, mult: 3 },
  { gap: 20, mult: 4 },
]

export function plantMilestoneInfo(level) {
  let multiplier = 1
  let remaining = level
  let cycleIdx = 0
  while (remaining >= MILESTONE_CYCLE[cycleIdx % MILESTONE_CYCLE.length].gap) {
    const ms = MILESTONE_CYCLE[cycleIdx % MILESTONE_CYCLE.length]
    remaining -= ms.gap
    multiplier *= ms.mult
    cycleIdx++
  }
  const next = MILESTONE_CYCLE[cycleIdx % MILESTONE_CYCLE.length]
  return { multiplier, levelsToNext: next.gap - remaining, nextMult: next.mult }
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
 * The draw used to take min(21, participants), so with 21 or fewer entrants
 * *everyone* won and the pot was split strictly by ticket count — no chance
 * involved. Across 468 rounds with tickets the largest turnout was 8, so the
 * ceiling never once applied: the game has never actually run a lottery.
 *
 * Scaling the winner count with turnout keeps real losers at any size, so a win
 * stays an event. Odds remain proportional to tickets held.
 *
 * @param {number} participants
 * @returns {number}
 */
export function winnerCount(participants) {
  if (participants <= 0) return 0
  return Math.min(MAX_WINNERS, Math.max(1, Math.ceil(participants * WINNER_SHARE)))
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

export const MAX_TICKETS_PER_DAY = 4
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
 * @param {number} boughtToday tickets bought in the last 24 h
 * @param {number} rate joints per second
 * @returns {number}
 */
export function ticketPrice(boughtToday, rate) {
  const n = Math.min(Math.max(0, boughtToday), TICKET_DAY_SHARE.length - 1)
  return Math.max(1, Math.round(rate * DAY_SECONDS * TICKET_DAY_SHARE[n] * ticketScale(rate)))
}

/**
 * Prices for the next few tickets of today's allowance.
 *
 * Capped at three: showing the whole remaining allowance made the row wide and
 * the far entries are not a decision anyone is making yet.
 *
 * @param {number} boughtToday
 * @param {number} rate
 * @param {number} [limit]
 */
export function ticketPreview(boughtToday, rate, limit = 3) {
  const out = []
  for (let n = boughtToday; n < MAX_TICKETS_PER_DAY && out.length < limit; n++) {
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
