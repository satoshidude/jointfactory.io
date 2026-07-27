/**
 * Shared economy — single source of truth for every curve and formula in the game.
 *
 * Plain ESM JavaScript so the Vite client (src/game/useGameLoop.ts) and the Node
 * server (server/*.js) import the exact same numbers. Anything that decides how
 * many joints a player has, what a ticket costs, or how much a boost is worth
 * belongs here — not in a component and not duplicated per side.
 *
 * Currency rule that runs through all of it: joints are earned by playing and may
 * be reset (prestige), sats are real money and are never destroyed by game logic.
 */

// ── Plantations ──────────────────────────────────────────────────────────────
/**
 * Level-up cost growth per plantation.
 *
 * Still the live 1.28, which outruns output growth (~1.07/level from linear
 * level × milestone multipliers) by 19 % a level and walls every endgame player
 * at ~level 85 — Hakuna's next MegaFarm level costs 18 days of idling.
 *
 * The retune to ~1.12 ships with the season reset, not before: rehydrate()
 * pushes these defs onto every existing save, so changing the number here
 * silently reprices 34 live accounts mid-season. Simulate a candidate with
 *   node scripts/sim-economy.mjs 30 --upgmult=1.12
 */
export const UPG_MULT = Number(globalThis.process?.env?.JF_UPG_MULT) || 1.28

export const PLANTATION_DEFS = [
  { id: 0, name: 'Balcony Grow',   icon: '\u{1F331}', baseProd: 5,       cycleTime: 4,   upgBase: 8,         upgMult: UPG_MULT, mgrCost: 20,  unlockCost: 0 },
  { id: 1, name: 'Outdoor Plot',   icon: '\u{1F331}', baseProd: 60,      cycleTime: 5,   upgBase: 400,       upgMult: UPG_MULT, mgrCost: 30,  unlockCost: 50_000 },
  { id: 2, name: 'Indoor Room',    icon: '\u{1F3E0}', baseProd: 400,     cycleTime: 4,   upgBase: 15_000,    upgMult: UPG_MULT, mgrCost: 40,  unlockCost: 2_000_000 },
  { id: 3, name: 'Hydroponic Lab', icon: '\u{1F4A7}', baseProd: 3_000,   cycleTime: 3,   upgBase: 100_000,   upgMult: UPG_MULT, mgrCost: 60,  unlockCost: 100_000_000 },
  { id: 4, name: 'Greenhouse',     icon: '\u{1F333}', baseProd: 25_000,  cycleTime: 2.5, upgBase: 500_000,   upgMult: UPG_MULT, mgrCost: 100, unlockCost: 10_000_000_000 },
  { id: 5, name: 'MegaFarm',       icon: '\u{1F3ED}', baseProd: 250_000, cycleTime: 2,   upgBase: 2_500_000, upgMult: UPG_MULT, mgrCost: 200, unlockCost: 1_000_000_000_000 },
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

/** Cannabis per production cycle. `globalMult` carries prestige + boosts. */
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

// ── Speed upgrades (the permanent sats sink) ─────────────────────────────────
// 60 levels from 1× to 3× at 21–210 sats. The old curve asked ~302k sats per
// station for +0.7 % a level — the whole player base bought 132 of 8000 levels.

export const MAX_SPEED_LEVEL = 60
export const MAX_SPEED = 3

export function getSpeedUpgrade(currentLevel) {
  if (currentLevel >= MAX_SPEED_LEVEL) return null
  const t = currentLevel / MAX_SPEED_LEVEL
  const cost = Math.round(21 + 189 * Math.pow(t, 0.7))
  const nextLevel = currentLevel + 1
  const speed = +(1 + (nextLevel / MAX_SPEED_LEVEL) * (MAX_SPEED - 1)).toFixed(2)
  const pct = Math.round((speed - 1) * 100)
  return { speed, cost, label: `+${pct}%` }
}

/** Old saves stored speedLevel on a 0–1000 scale. Used by the season migration. */
export function migrateSpeedLevel(oldLevel) {
  const lvl = Math.min(MAX_SPEED_LEVEL, Math.round((oldLevel || 0) / 1000 * MAX_SPEED_LEVEL))
  const speed = +(1 + (lvl / MAX_SPEED_LEVEL) * (MAX_SPEED - 1)).toFixed(2)
  return { speedLevel: lvl, speed }
}

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
  fullthrottle: { id: 'fullthrottle', name: 'Full Throttle', short: '2x Everything', cost: 100, durationSec: 3600, plant: 2, courier: 2, fabrik: 2 },
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

// ── Prestige ─────────────────────────────────────────────────────────────────
// Seeds are the only thing that survives a harvest besides sats-bought upgrades.

export const PRESTIGE = {
  minLifetime: 1e9, // all-time joints before the first "Ernte" unlocks
  seedScale: 50,    // seeds per decade of lifetime
  seedBonus: 0.05,  // +5 % chain-wide production per seed
}

/**
 * Seeds from *all-time* joints earned — logarithmic on purpose.
 *
 * A power-law (seeds ∝ lifetime^0.4) runs away here: joint costs are fixed
 * numbers, so a ×M throughput bonus makes every rung of the upgrade ladder M
 * times faster to buy, which compounds into doubly-exponential growth. The
 * simulation reached 7e21 seeds by cycle 5. Logarithmic seed gain turns each
 * harvest into a bounded, predictable step (~+50 seeds per 10× lifetime).
 *
 * Reading all-time totals rather than per-season ones keeps seeds monotone, so
 * `players.total_joints_earned` is the only counter needed — and existing
 * accounts convert on their own at the season reset with no special-casing.
 */
export function prestigeSeeds(lifetimeJoints) {
  if (!lifetimeJoints || lifetimeJoints < PRESTIGE.minLifetime) return 0
  return Math.floor(PRESTIGE.seedScale * Math.log10(1 + lifetimeJoints / 1e9))
}

export function prestigeMultiplier(seeds) {
  return 1 + (seeds || 0) * PRESTIGE.seedBonus
}

/** Seeds a harvest right now would add on top of what the player already holds. */
export function prestigeGain(lifetimeJoints, currentSeeds) {
  return Math.max(0, prestigeSeeds(lifetimeJoints) - (currentSeeds || 0))
}

// ── Throughput ───────────────────────────────────────────────────────────────
// The real joints/sec is the bottleneck of the chain, not the plantation sum.
// Reporting the plantation sum made the leaderboard and growth race show numbers
// players never actually earned — a player without a factory manager earns zero.

/**
 * @param {any} gs
 * @param {{ seeds?: number, boosts?: Array<{ type: string, expires_at: number }>, nowSec?: number }} [opts]
 * @returns {{ plant: number, courier: number, fabrik: number, jointsPerSec: number }}
 */
export function throughput(gs, { seeds = 0, boosts = [], nowSec = 0 } = {}) {
  const empty = { plant: 0, courier: 0, fabrik: 0, jointsPerSec: 0 }
  if (!gs || !gs.plantagen) return empty

  const m = boostMultipliers(boosts, nowSec)
  // Prestige is a *chain-wide* multiplier, not a plantation bonus. Applying it
  // only to plantations makes it worthless: the chain is capped by its weakest
  // stage, so a ×50 plantation bonus behind a fresh courier buys nothing. The
  // simulation showed prestige cycle 2 earning less than cycle 1 because of it.
  const prestige = prestigeMultiplier(seeds)

  let plant = 0
  for (const p of gs.plantagen) {
    if (p.managerLevel > 0) plant += plantRate(p, prestige * m.plant)
  }

  const c = gs.courier
  const f = gs.fabrik
  // Courier does a round trip per load, so throughput is capacity / (2 × trip).
  const courier = c && c.mgrLevel > 0 ? prestige * c.capacity / (2 * courierTripTime(c, m.courier)) : 0
  const fabrik = f && f.mgrLevel > 0 ? prestige * f.capacity / fabrikCycleTime(f, m.fabrik) : 0

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

// ── Lottery tickets (the scaling joints sink) ────────────────────────────────
// Priced in *seconds of the player's own production* instead of absolute joints.
// The absolute curve stays as a floor so beginners pay what they always paid,
// while an endgame player no longer buys a full set for 17 ms of output.

export const TICKET_PRICE_CURVE = [
  500, 1200, 2500, 4000, 7000, 5000, 3500, 9000, 15_000, 25_000, 40_000,
  70_000, 120_000, 200_000, 350_000, 600_000, 1_000_000, 1_700_000,
  2_800_000, 4_500_000, 7_500_000,
]

// Keeps the shape of the old curve: peak at #5, the "noch einer!" dip at #6/#7.
const TICKET_DIP = [1, 1, 1, 1, 1.4, 0.7, 0.45]

export const TICKET_SECONDS = TICKET_PRICE_CURVE.map(
  (_, n) => Math.round(300 * Math.pow(1.25, n) * (TICKET_DIP[n] ?? 1))
)

export function ticketPrice(myCount, jointsPerSec) {
  const n = Math.min(myCount, TICKET_PRICE_CURVE.length - 1)
  return Math.max(
    TICKET_PRICE_CURVE[n],
    Math.round((jointsPerSec || 0) * TICKET_SECONDS[n])
  )
}

// ── Initial / reset state ────────────────────────────────────────────────────
// Lives here because the server needs it too: prestige and the season reset are
// server-authoritative, the client never resets its own progress.

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

/**
 * Prestige reset: wipe everything joints bought, keep everything sats bought.
 * Managers and speed levels survive because a player paid real money for them —
 * game logic must never destroy that.
 */
export function prestigeReset(gs) {
  const fresh = initialState()
  if (!gs) return fresh

  // Plantation #1 always exists; carry its sats-bought parts over.
  const old0 = gs.plantagen?.[0]
  if (old0) {
    fresh.plantagen[0].speedLevel = old0.speedLevel || 0
    fresh.plantagen[0].speed = old0.speed || 1
    fresh.plantagen[0].managerLevel = old0.managerLevel || 0
  }
  // Higher plantations are joints-unlocked, so they are gone — but their speed
  // levels are parked so re-unlocking restores what was paid for in sats.
  fresh._parkedSpeed = (gs.plantagen || []).slice(1).map(p => ({
    id: p.id, speedLevel: p.speedLevel || 0, speed: p.speed || 1, managerLevel: p.managerLevel || 0,
  }))

  fresh.courier.speedLevel = gs.courier?.speedLevel || 0
  fresh.courier.speed = gs.courier?.speed || 1
  fresh.courier.mgrLevel = gs.courier?.mgrLevel || 0
  fresh.fabrik.speedLevel = gs.fabrik?.speedLevel || 0
  fresh.fabrik.speed = gs.fabrik?.speed || 1
  fresh.fabrik.mgrLevel = gs.fabrik?.mgrLevel || 0

  return fresh
}
