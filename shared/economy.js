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

/**
 * The six plots, laid out for a round that ends at ROUND_TARGET.
 *
 * The round has to span from one joint a second to a quadrillion in a week, and
 * that span is what every number here is for. Two things set it:
 *
 *   - **the jump between plots (x50).** The old ladder climbed by about x8, which
 *     over six plots is x32,000 — far too little to reach a quadrillion from a
 *     standing start. At x50 the six plots cover x312 million between them, and
 *     the levels and milestones supply the rest.
 *   - **a flat capacity brake (see CAPACITY_COST_TIERS).** A rising brake caps how
 *     many doublings fit into a week, and with the old tiers that ceiling was
 *     about seventeen. A quadrillion needs thirty-three.
 *
 * The unlock costs are deliberately *not* geometric. The first two are cheap so
 * the third plot lands inside a new player's first session; from Hydroponic on
 * they climb by x100, which is what keeps MegaFarm at the half-way mark instead
 * of arriving in the first quarter with nothing left to do after it.
 *
 * Measured with scripts/tune-pacing.mjs, greedy-optimal player:
 *   round the clock 3.7 d - 8 h a day 8.0 d - 4 h a day 14.0 d,
 *   six plots in every profile, MegaFarm at 45-57 % of the round,
 *   third plot open after 2 hours, first upgrade after 24 seconds.
 */
export const PLANTATION_DEFS = [
  { id: 0, name: 'Balcony Grow',   icon: '\u{1F331}', baseProd: 0.4,         cycleTime: 4,   upgBase: 8,             upgMult: UPG_MULT, mgrCost: 20,  unlockCost: 0 },
  { id: 1, name: 'Outdoor Plot',   icon: '\u{1F331}', baseProd: 20,          cycleTime: 5,   upgBase: 400,           upgMult: UPG_MULT, mgrCost: 100, unlockCost: 3_000 },
  { id: 2, name: 'Indoor Room',    icon: '\u{1F3E0}', baseProd: 1_000,       cycleTime: 4,   upgBase: 20_000,        upgMult: UPG_MULT, mgrCost: 150, unlockCost: 100_000 },
  { id: 3, name: 'Hydroponic Lab', icon: '\u{1F4A7}', baseProd: 50_000,      cycleTime: 3,   upgBase: 1_000_000,     upgMult: UPG_MULT, mgrCost: 200, unlockCost: 300_000_000 },
  { id: 4, name: 'Greenhouse',     icon: '\u{1F333}', baseProd: 2_500_000,   cycleTime: 2.5, upgBase: 50_000_000,    upgMult: UPG_MULT, mgrCost: 250, unlockCost: 30_000_000_000 },
  { id: 5, name: 'MegaFarm',       icon: '\u{1F3ED}', baseProd: 125_000_000, cycleTime: 2,   upgBase: 2_500_000_000, upgMult: UPG_MULT, mgrCost: 300, unlockCost: 3_000_000_000_000 },
]

/**
 * Level a newly unlocked plot starts on: half the highest level already owned.
 *
 * On level 1 a new plot carries no milestone multiplier, so it produces a
 * rounding error next to a developed one — MegaFarm would open at 15 K/s against
 * a Greenhouse already doing 3.5 M/s. Buying a level on the old plot was always
 * the better move, and the last two plots were only ever reached because the old
 * curve ran for months. Inheriting half the ladder makes a new plot competitive
 * the moment it is paid for, which is what turns the climb into the main line of
 * play instead of a dead end.
 */
export const UNLOCK_INHERIT = Number(globalThis.process?.env?.JF_UNLOCK_INHERIT) || 0.5

/**
 * Ceiling on a single plot's level.
 *
 * The greedy-optimal round ends at 37/18/12/17/19/19, so this costs an ordinary
 * player nothing — it exists to close the degenerate line of pouring everything
 * into the starter plot, and it bounds the milestone stack from below as well as
 * MILESTONE_CAP bounds it from above.
 */
export const MAX_PLANT_LEVEL = Number(globalThis.process?.env?.JF_MAX_LEVEL) || 50

/** Level a plot opens on, given the levels already owned. */
/** @param {Array<{level: number}>} plantagen @returns {number} */
export function inheritedLevel(plantagen) {
  const top = Math.max(0, ...(plantagen || []).map(p => p?.level || 0))
  return Math.min(MAX_PLANT_LEVEL, Math.max(1, Math.round(UNLOCK_INHERIT * top)))
}

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

export const MILESTONE_CAP = Number(globalThis.process?.env?.JF_MILESTONE_CAP) || 1024

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

/**
 * Courier and factory: one purchase multiplies capacity by CAPACITY_STEP and the
 * next one costs COST_SCALE times as much. The ratio between the two is what
 * decides how fast a chain can widen — at 2 and 2.5 the price per unit of
 * throughput rises by only a quarter per step, which is a gentle brake.
 *
 * Both are readable from the environment so `scripts/tune-pacing.mjs` can sweep
 * them without a second copy of the formulas living in the tuner.
 */
export const CAPACITY_STEP = Number(globalThis.process?.env?.JF_CAP_STEP) || 2

/** Where a fresh courier and factory start. The courier is the opening
 *  bottleneck by design: 8 per round trip over 8 seconds is one joint a second,
 *  which is where a new player begins. */
export const BASE_CAPACITY = { courier: 8, fabrik: 40 }

/**
 * How much more each capacity upgrade costs than the last. Flat, and that is the
 * whole point.
 *
 * Capacity doubles per purchase, so a scale of 2 would mean a constant wait per
 * doubling and an unlimited span. Anything above 2 is a brake: at 2.3 each
 * doubling takes 15 % longer than the one before, which lets about thirty-three
 * of them fit into a week — exactly what the span from one joint a second to a
 * quadrillion needs.
 *
 * It used to rise to 3.4 and then 3.9, which capped the span at roughly seventeen
 * doublings. That was right when a round ended at a billion; against a quadrillion
 * it simply made the target unreachable — measured at 46 days, and *slower* the
 * more the late tiers were loosened, because cheaper upgrades mean more of them
 * to accumulate the same total.
 *
 * Readable from JF_CAP_TIERS ("0:2.3" or "0:2.3,20:2.6") so the next calibration
 * needs no code change.
 */
export const CAPACITY_COST_TIERS = parseTiers(globalThis.process?.env?.JF_CAP_TIERS) || [
  { from: 0, scale: 2.3 },
]

/** "0:2.5,10:3.4,18:4" → the tier table, for sweeping without editing code. */
function parseTiers(spec) {
  if (!spec) return null
  const tiers = spec.split(',').map(part => {
    const [from, scale] = part.split(':').map(Number)
    return { from, scale }
  }).filter(t => Number.isFinite(t.from) && Number.isFinite(t.scale))
  return tiers.length ? tiers.sort((a, b) => a.from - b.from) : null
}

/** Steps a station has been widened by, from its capacity. */
export function capacitySteps(capacity, base) {
  if (!(capacity > 0) || !(base > 0) || capacity <= base) return 0
  return Math.round(Math.log(capacity / base) / Math.log(CAPACITY_STEP))
}

/** Cost multiplier for the *next* upgrade of a station that has bought `steps`. */
export function capacityCostScale(steps) {
  let scale = CAPACITY_COST_TIERS[0].scale
  for (const tier of CAPACITY_COST_TIERS) if (steps >= tier.from) scale = tier.scale
  return scale
}

/** Kept for callers that only need the opening rate. */
export const COST_SCALE = CAPACITY_COST_TIERS[0].scale

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

/**
 * What a manager costs, by how many rounds the player has finished.
 *
 * Managers do not survive a reset — they are the one recurring sats sink in the
 * game, and every sat spent on one goes into the lottery pot. Carrying them over
 * would have made the second round free and dried the pot out with it.
 *
 * Instead the price falls as the player comes back: 90 in the first round, 60 in
 * the second, 30 in the third, 21 from the fourth on. A returning player pays
 * less for the same chain every time, which is what makes starting over cheap
 * without making it free.
 */
export const MANAGER_PRICE_BY_ROUND = [90, 60, 30]
export const MANAGER_PRICE_FLOOR = 21

/**
 * Plots whose manager stops costing anything once enough rounds are behind you:
 * Outdoor after the first, Indoor after the second, Hydroponic after the third.
 * Everything else is bought every round, at the price above.
 *
 * Keyed by plantation id, valued in rounds finished.
 */
export const MANAGER_FREE_AFTER = { 1: 1, 2: 2, 3: 3 }

/** @param {number} roundsCompleted @returns {number} sats */
export function managerPrice(roundsCompleted) {
  const done = Math.max(0, Math.floor(roundsCompleted || 0))
  return MANAGER_PRICE_BY_ROUND[done] ?? MANAGER_PRICE_FLOOR
}

/**
 * Station keys are plantation ids as strings, plus 'courier' and 'fabrik' — the
 * same vocabulary the manager helpers in server/rounds.js speak.
 *
 * @param {string} station
 * @param {number} roundsCompleted
 * @returns {boolean}
 */
export function managerFreeByRound(station, roundsCompleted) {
  const needed = MANAGER_FREE_AFTER[station]
  return needed !== undefined && Math.floor(roundsCompleted || 0) >= needed
}

/** Every station of a save, as keys, with whether a manager is on it. */
function* stations(gs) {
  for (const p of gs?.plantagen || []) {
    if (Number.isInteger(p?.id)) yield [String(p.id), p.managerLevel > 0]
  }
  if (gs?.courier) yield ['courier', gs.courier.mgrLevel > 0]
  if (gs?.fabrik) yield ['fabrik', gs.fabrik.mgrLevel > 0]
}

/**
 * Free-quota slots already used.
 *
 * A manager that is free because of the round must not eat one: a player in
 * round four would otherwise spend a slot on Outdoor — which costs nothing
 * anyway — and end up paying for a station that should have been covered.
 *
 * @param {any} gs @param {number} roundsCompleted @returns {number}
 */
export function managerQuotaUsed(gs, roundsCompleted) {
  let used = 0
  for (const [key, hired] of stations(gs)) {
    if (hired && !managerFreeByRound(key, roundsCompleted)) used++
  }
  return used
}

/**
 * Price of hiring a manager on one station right now.
 *
 * @param {string} station '0'..'5' | 'courier' | 'fabrik'
 * @param {any} gs current state, for the free quota
 * @param {number} roundsCompleted
 * @returns {number} sats
 */
export function managerCost(station, gs, roundsCompleted) {
  if (managerFreeByRound(station, roundsCompleted)) return 0
  if (managerQuotaUsed(gs, roundsCompleted) < FREE_MANAGERS) return 0
  return managerPrice(roundsCompleted)
}

/**
 * Sats the managers hired between two states must have cost.
 *
 * Priced here rather than taken from the client's word: a save used to report
 * what it had spent and the server simply deducted it, so a client that reported
 * nothing got its managers for nothing. Charged in hire order, because each one
 * may be the one that uses up the free quota.
 *
 * @param {any} prev stored state @param {any} next incoming state
 * @param {number} roundsCompleted
 * @returns {{ cost: number, hired: string[] }}
 */
export function managerSpend(prev, next, roundsCompleted) {
  const out = { cost: 0, hired: [] }
  if (!next) return out
  const before = new Map(stations(prev || {}))
  // Walk a copy of the previous state forward, so the quota is counted as it was
  // when each manager was actually taken on.
  let used = managerQuotaUsed(prev || {}, roundsCompleted)
  for (const [key, hired] of stations(next)) {
    if (!hired || before.get(key)) continue
    out.hired.push(key)
    if (managerFreeByRound(key, roundsCompleted)) continue
    if (used < FREE_MANAGERS) { used++; continue }
    out.cost += managerPrice(roundsCompleted)
  }
  return out
}

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

/** A saved state, whether it arrives as an object or as its JSON. */
function asState(gameState) {
  if (!gameState) return null
  if (typeof gameState !== 'string') return gameState
  try { return JSON.parse(gameState) } catch { return null }
}

/**
 * Managers in this round that cost sats.
 *
 * The free quota covers three, and three is exactly what the lottery has always
 * asked for — so the gate has been standing open: a chain automated entirely
 * for free could draw from a pot it had never paid into.
 */
export const REQUIRED_PAID_MANAGERS = 1

/** @param {any} gameState @param {number} roundsCompleted @returns {number} */
export function paidManagers(gameState, roundsCompleted) {
  const gs = asState(gameState)
  if (!gs) return 0
  return Math.max(0, managerQuotaUsed(gs, roundsCompleted) - FREE_MANAGERS)
}

/**
 * May this account buy a ticket in the round it is playing?
 *
 * Two conditions, and they ask different things. The chain must be automated,
 * because the ticket price is a share of production and an idle account would
 * pay the floor. And the account must have put sats into the pot during this
 * round — a manager or a boost, either one. Those are the only two things sats
 * buy, every sat spent on them goes into the pot gross, and a ticket is a claim
 * on that pot.
 *
 * It used to ask specifically for a paid manager, which was needlessly narrow:
 * a player who spent 21 sats on Full Throttle has funded the round exactly as
 * much as one who spent 21 on a manager.
 *
 * Managers do not survive a reset and boosts last half an hour, so both are
 * re-earned every round.
 *
 * @param {any} gameState
 * @param {number} roundsCompleted
 * @param {number} satsIntoPot sats spent on managers and boosts this round
 */
export function ticketGate(gameState, roundsCompleted = 0, satsIntoPot = 0) {
  const managers = countLotteryManagers(gameState)
  // The state-derived count is a fallback for the ledger: a hire is always
  // visible in the save, even if its event were ever missing.
  const paid = Math.max(satsIntoPot > 0 ? 1 : 0, paidManagers(gameState, roundsCompleted))
  const missing = Math.max(0, REQUIRED_MANAGERS - managers)
  const missingPaid = Math.max(0, REQUIRED_PAID_MANAGERS - paid)
  return {
    eligible: missing === 0 && missingPaid === 0,
    managers,
    required: REQUIRED_MANAGERS,
    missing,
    paid,
    sats_into_pot: satsIntoPot,
    requiredPaid: REQUIRED_PAID_MANAGERS,
    missingPaid,
    /** What the next manager costs, for the hint that asks for one. */
    price: managerPrice(roundsCompleted),
  }
}

/** The one sentence that says what is still missing. */
export function ticketGateReason(gate) {
  if (gate.missing > 0) {
    return `Automate the chain first — ${gate.missing} more manager${gate.missing === 1 ? '' : 's'} needed`
  }
  if (gate.missingPaid > 0) {
    return `Spend sats this round first — a boost from 10, or a manager for ${gate.price}. They are the pot.`
  }
  return ''
}

// ── Boosts (the recurring sats sink) ─────────────────────────────────────────
// Permanent upgrades exhaust themselves; consumables keep the same sats cycling
// through pot → winners → boosts → pot, burning the 20 % house cut each lap.

// Half an hour each, so the only thing that separates them is what they widen.
// Full Throttle is all three at once and costs about what all three would.
export const BOOSTS = {
  fertilizer:   { id: 'fertilizer',   name: 'Fertilizer',   short: '2x Grow',    cost: 10,  durationSec: 1800, plant: 2 },
  express:      { id: 'express',      name: 'Express Run',  short: '3x Courier', cost: 10,  durationSec: 1800, courier: 3 },
  doubleshift:  { id: 'doubleshift',  name: 'Double Shift', short: '2x Factory', cost: 10,  durationSec: 1800, fabrik: 2 },
  fullthrottle: { id: 'fullthrottle', name: 'Full Throttle', short: '2x Everything', cost: 21,  durationSec: 1800, plant: 2, courier: 2, fabrik: 2 },
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
// Joints buy speed for the whole chain, for the rest of the round.
//
// The price is denominated in *seconds of the buyer's own production*, not in a
// fixed number of joints. That is what keeps it meaningful at every point of a
// curve that spans a quadrillion: a step always costs the same amount of playing
// time, whatever the numbers on screen say.
//
// The step was +2 % and it was dead. A capacity upgrade doubles the narrowest
// station — when that station is the bottleneck, that is +100 % on the chain —
// so against it a 2 % lift never won, and the greedy player bought two steps in a
// whole round. At 5 % it is worth about x1.28 by the end of a round and shortens
// it by roughly a tenth, which is a real decision without being the only one.

export const SPEED_STEP = Number(globalThis.process?.env?.JF_SPEED_STEP) || 0.05

/**
 * Ceiling on how cheap a step may get: spending a full month's output buys at
 * most +20 %. It only sets the price ceiling now — the runaway it was written
 * against cannot happen any more, because speed is cleared with every reset.
 */
export const SPEED_MONTHLY_CAP = 1.20

const MONTH_SECONDS = 30 * 86400
const STEPS_PER_MONTH = Math.log(SPEED_MONTHLY_CAP) / Math.log(1 + SPEED_STEP)

/** Cost ceiling per step, derived from the monthly cap — about 3.26 days. */
export const SPEED_MAX_SECONDS = MONTH_SECONDS / STEPS_PER_MONTH

const SPEED_FIRST_SECONDS = 300   // the first step is five minutes of output
const SPEED_SECONDS_GROWTH = Number(globalThis.process?.env?.JF_SPEED_GROWTH) || 1.35

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

// ── Rounds and prestige ──────────────────────────────────────────────────────
//
// The game used to have no end. A player who reached the top of the curve had
// nothing left to do, and the numbers kept climbing into suffixes nobody feels.
// A round fixes both: it finishes at a billion joints — about a week with
// managers and a few visits a day — and then you may start over.
//
// Resetting is voluntary and buys no advantage. It banks prestige points and a
// time in the Billionaires Club, nothing else: every round is the same race, so
// the times stay comparable across rounds and across players.

export const ROUND_TARGET = Number(globalThis.process?.env?.JF_ROUND_TARGET) || 1_000_000_000_000_000

/**
 * Prestige points a round is worth when the player resets: one.
 *
 * It used to pay a point per doubling past the target, to give a reason to keep
 * playing a finished round. Counting now stops *at* the target — see the cap in
 * useGameLoop and saveState — so there is nothing past it to reward, and a star
 * simply means a round. Which is what the leaderboard was always going to be
 * read as anyway.
 *
 * @param {number} jointsEarned lifetime joints of the round being closed
 * @returns {number}
 */
export function prestigePoints(jointsEarned) {
  return Math.max(0, jointsEarned || 0) >= ROUND_TARGET ? 1 : 0
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
 * Share of one day's production each of the four tickets of a draw costs.
 * Rising, so a further ticket in the same draw costs more; the four together are
 * exactly one day of output.
 *
 * The first was 15 %, i.e. 3.6 hours of production. Reachable in principle, but
 * not in practice: levels pay themselves back in seconds, so an active player's
 * balance is always freshly spent and the ticket sat permanently out of reach.
 * At 10 % the first one is about two and a half hours of output — long enough to
 * be a decision, short enough to be a plan. The steeper tail keeps the full
 * allowance at one day, so nobody sweeps a round cheaply.
 */
export const TICKET_DAY_SHARE = [0.10, 0.18, 0.28, 0.44]

/**
 * Price of a player's next ticket: a share of a day of their own production,
 * and nothing else.
 *
 * There used to be a second factor on top, a "beginner markup" that ran from 20x
 * at one joint a second down to 1x at twenty billion, log-interpolated. It was
 * calibrated when a round ended at a billion. Now a round ends at a quadrillion
 * and spans that whole range by itself — a chain starts at one a second and
 * finishes between ten and twenty-seven billion — so the ramp stopped
 * distinguishing a newcomer from a veteran and started measuring how far into
 * their round somebody was. Managers do not survive a reset, so everyone is a
 * beginner again every round: a player at eight thousand a second paid 12.8x,
 * which put the four tickets of one draw at 12.8 days of production inside a
 * seven-day round, and every upgrade pushed the price further away.
 *
 * What the markup was there for — an idle account buying entries at the
 * one-joint floor — is the job of ticketGate now, which asks for an automated
 * chain and a manager bought with sats. A price is a bad gate; a gate is a good
 * gate.
 *
 * @param {number} held tickets already held in this round
 * @param {number} rate joints per second
 * @returns {number}
 */
export function ticketPrice(held, rate) {
  const n = Math.min(Math.max(0, held), TICKET_DAY_SHARE.length - 1)
  return Math.max(1, Math.round(rate * DAY_SECONDS * TICKET_DAY_SHARE[n]))
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

/**
 * Level the Balcony Grow opens on.
 *
 * At level 1 the tenth-scale curve gives 0.025 joints/s, so the first upgrade
 * would be two and a half minutes of tapping — the old curve managed it in six
 * seconds. Ten levels (0.5/s with the first milestone) puts it back at about
 * twenty seconds. The head start is worth nothing later: the round is the same
 * length with or without it.
 */
export const START_LEVEL = 10

/** @param {any} def @param {number} [level] */
export function newPlantation(def, level = 1) {
  return {
    id: def.id, name: def.name, icon: def.icon,
    level: Math.min(MAX_PLANT_LEVEL, Math.max(1, level)),
    baseProd: def.baseProd, cycleTime: def.cycleTime,
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
    plantagen: [newPlantation(PLANTATION_DEFS[0], START_LEVEL)],
    _unlockIdx: 0,
    courier: {
      state: 'idle', posX: 15, carrying: 0,
      capacity: BASE_CAPACITY.courier, speed: 1, speedLevel: 0,
      tripTimer: 0, tripDuration: 4,
      mgrLevel: 0, mgrCost: 20,
      capCost: 240, speedCost: 0,
    },
    fabrik: {
      capacity: BASE_CAPACITY.fabrik, speed: 1, speedLevel: 0,
      processing: false, timer: 0, processTime: 8,
      autoTimer: 0, mgrLevel: 0, mgrCost: 20,
      capCost: 480, speedCost: 0,
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
    let steps = capacitySteps(capacity, BASE_CAPACITY[key])
    // Each step multiplies; the bound is there so a nonsense capacity cannot
    // spin the loop. The scale has to match what the client charged, or an
    // honest purchase looks unpaid to the save guard.
    for (let i = 0; i < 64 && capacity > 0 && capacity < (after.capacity || 0); i++) {
      out.capacity += 1
      out.capacity_cost += price
      capacity *= CAPACITY_STEP
      price = Math.floor(price * capacityCostScale(steps))
      steps += 1
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
