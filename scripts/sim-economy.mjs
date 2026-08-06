#!/usr/bin/env node
/**
 * Balance simulation for shared/economy.js.
 *
 * Plays a greedy optimal player (always buys the upgrade with the best
 * rate-gain-per-joint) and reports how the curves actually feel over time:
 * time-to-level, when plantations unlock, what the speed ladder costs and what
 * a lottery ticket costs — both relative to the player's own production.
 *
 * Tune curve constants against this, not against the live game.
 *
 *   node scripts/sim-economy.mjs [days]
 */

// --upgmult must be applied before the module reads it, hence the env handoff.
const upgArg = process.argv.find(a => a.startsWith('--upgmult='))
if (upgArg) process.env.JF_UPG_MULT = upgArg.split('=')[1]

const {
  PLANTATION_DEFS, CAPACITY_STEP, BASE_CAPACITY, capacitySteps, capacityCostScale, UPG_MULT,
  plantLevelCost, newPlantation, initialState, throughput,
  ticketPrice, MAX_TICKETS_PER_ROUND, DAY_SECONDS,
  speedCostSeconds, speedMultiplier, SPEED_MONTHLY_CAP,
} = await import('../shared/economy.js')

const DAYS = Number(process.argv.find(a => /^\d+$/.test(a)) || 30)
const HORIZON = DAYS * 86400

const fmt = n => {
  if (n < 1000) return n.toFixed(n < 10 ? 2 : 0)
  const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc']
  const i = Math.min(units.length - 1, Math.floor(Math.log10(n) / 3))
  return (n / 1000 ** i).toFixed(2) + units[i]
}
const dur = s => {
  if (s < 60) return `${s.toFixed(1)}s`
  if (s < 3600) return `${(s / 60).toFixed(1)}min`
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`
  return `${(s / 86400).toFixed(1)}d`
}

/** Greedy play from a fresh state at the given bought speed level. */
function playRun(speedLevel, horizon, { verbose = false } = {}) {
  const gs = initialState()
  // Free managers go to the three stations that gate the chain.
  gs.plantagen[0].managerLevel = 1
  gs.courier.mgrLevel = 1
  gs.fabrik.mgrLevel = 1

  const rate = () => throughput(gs, { speedLevel }).jointsPerSec
  let t = 0
  let earned = 0
  const events = []

  while (t < horizon) {
    const th = throughput(gs, { speedLevel })
    const before = th.jointsPerSec
    if (before <= 0) break

    // Only purchases that widen the *current bottleneck* move the chain. Scoring
    // against overall throughput deadlocks the moment two stages tie, because
    // then no single purchase raises the min — a real player buys into the
    // bottleneck stage, so the sim measures gain within that stage.
    const eps = 1 + 1e-9
    const atPlant = th.plant <= before * eps
    const atCourier = th.courier <= before * eps
    const atFabrik = th.fabrik <= before * eps

    const options = []

    if (atPlant) {
      for (let i = 0; i < gs.plantagen.length; i++) {
        const p = gs.plantagen[i]
        const cost = plantLevelCost(p)
        p.level++
        const gain = throughput(gs, { speedLevel }).plant - th.plant
        p.level--
        if (gain > 0) options.push({ kind: 'plant', i, cost, gain, label: `${p.name} → Lvl ${p.level + 1}` })
      }
      if (gs.plantagen.length < PLANTATION_DEFS.length) {
        const def = PLANTATION_DEFS[gs.plantagen.length]
        const p = newPlantation(def)
        p.managerLevel = 1
        gs.plantagen.push(p)
        const gain = throughput(gs, { speedLevel }).plant - th.plant
        gs.plantagen.pop()
        if (gain > 0) options.push({ kind: 'unlock', cost: def.unlockCost, gain, label: `Unlock ${def.name}` })
      }
    }

    if (atCourier) {
      options.push({ kind: 'courier', cost: gs.courier.capCost, gain: th.courier, label: `Courier Kapazität ×2` })
    }
    if (atFabrik) {
      options.push({ kind: 'fabrik', cost: gs.fabrik.capCost, gain: th.fabrik, label: `Fabrik Kapazität ×2` })
    }

    if (!options.length) break
    // Efficiency = bottleneck capacity gained per joint spent.
    options.sort((a, b) => b.gain / b.cost - a.gain / a.cost)
    const pick = options[0]

    const wait = pick.cost / before
    if (t + wait > horizon) break
    t += wait
    earned += pick.cost

    if (pick.kind === 'plant') gs.plantagen[pick.i].level++
    else if (pick.kind === 'courier') { const st = capacitySteps(gs.courier.capacity, BASE_CAPACITY.courier); gs.courier.capacity *= CAPACITY_STEP; gs.courier.capCost = Math.floor(gs.courier.capCost * capacityCostScale(st)) }
    else if (pick.kind === 'fabrik') { const st = capacitySteps(gs.fabrik.capacity, BASE_CAPACITY.fabrik); gs.fabrik.capacity *= CAPACITY_STEP; gs.fabrik.capCost = Math.floor(gs.fabrik.capCost * capacityCostScale(st)) }
    else if (pick.kind === 'unlock') {
      const p = newPlantation(PLANTATION_DEFS[gs.plantagen.length])
      p.managerLevel = 1
      gs.plantagen.push(p)
      gs._unlockIdx = gs.plantagen.length - 1
    }

    if (pick.kind === 'unlock' || verbose) {
      events.push({ t, label: pick.label, cost: pick.cost, wait, rate: rate() })
    }
  }

  return { gs, t, earned, rate: rate(), events }
}

console.log(`\n═══ Joint Factory — Ökonomie-Simulation (${DAYS} Tage, greedy-optimaler Spieler, upgMult ${UPG_MULT}) ═══\n`)

// ── 1. Season 1 from scratch ─────────────────────────────────────────────────
const s1 = playRun(0, HORIZON)
console.log('── Ein Durchlauf ohne gekauften Speed ──')
for (const e of s1.events) {
  console.log(`  ${dur(e.t).padStart(7)}  ${e.label.padEnd(24)} Kosten ${fmt(e.cost).padStart(9)}  Wartezeit ${dur(e.wait).padStart(7)}  → ${fmt(e.rate)}/s`)
}
console.log(`  Endrate nach ${DAYS}d: ${fmt(s1.rate)}/s`)
console.log(`  Lifetime (Ausgaben): ${fmt(s1.earned)} Joints`)
console.log(`  Alle 6 Plantagen erreicht: ${s1.gs.plantagen.length === 6 ? 'ja, nach ' + dur(s1.events.at(-1)?.t ?? 0) : 'nein (' + s1.gs.plantagen.length + ')'}`)

// ── 2. Time-to-level deep in the game (the old wall) ─────────────────────────
console.log('\n── Wartezeit pro MegaFarm-Level (die alte Mauer) ──')
{
  const def = PLANTATION_DEFS[5]
  for (const lvl of [25, 50, 100, 150, 200, 250, 300]) {
    const gs = initialState()
    gs.plantagen[0].managerLevel = 1
    gs.courier.mgrLevel = 1
    gs.fabrik.mgrLevel = 1
    // Give the player a chain wide enough that the plantation is the bottleneck.
    gs.courier.capacity = 1e30
    gs.fabrik.capacity = 1e30
    for (let i = 1; i < 6; i++) {
      const p = newPlantation(PLANTATION_DEFS[i])
      p.managerLevel = 1
      p.level = i === 5 ? lvl : 1
      gs.plantagen.push(p)
    }
    const income = throughput(gs, { speedLevel: 0 }).jointsPerSec
    const cost = plantLevelCost({ ...def, level: lvl })
    console.log(`  Lvl ${String(lvl).padStart(3)} → ${String(lvl + 1).padStart(3)}:  Kosten ${fmt(cost).padStart(9)}  bei ${fmt(income).padStart(9)}/s  =  ${dur(cost / income)}`)
  }
}

// ── 3. Speed ladder ─────────────────────────────────────────────────────────
console.log('\n── Speed: Preis in Produktionszeit ──')
for (const n of [0, 4, 9, 19, 23, 30, 60]) {
  console.log(`  Stufe ${String(n + 1).padStart(3)}: ${dur(speedCostSeconds(n)).padStart(7)} Produktion  →  ×${speedMultiplier(n + 1).toFixed(3)}`)
}
{
  const stepsIn = (budget, from = 0) => { let b = budget, n = from; while (b >= speedCostSeconds(n)) { b -= speedCostSeconds(n); n++ } return n - from }
  const fresh = stepsIn(30 * 86400)
  const steady = stepsIn(30 * 86400, 40)
  console.log(`  30 Tage Produktion aus dem Stand: ${fresh} Stufen → ×${speedMultiplier(fresh).toFixed(2)} (Anlauf)`)
  console.log(`  30 Tage Produktion am Deckel:     ${steady} Stufen → ×${(speedMultiplier(40 + steady) / speedMultiplier(40)).toFixed(3)} (Ziel ≤ ×${SPEED_MONTHLY_CAP})`)
}

// ── 4. Ticket prices relative to production ──────────────────────────────────
console.log('\n── Lotterie-Tickets: Tageskontingent ──')
console.log('  Spieler        Rate         Los #1       4 Lose       = Produktionstage')
for (const [name, rate] of [['Einsteiger', 1.25], ['früh', 1e3], ['Mitte', 6.5e3], ['fortgeschr.', 1e7], ['Top', 1.6e9]]) {
  let sum = 0
  for (let n = 0; n < MAX_TICKETS_PER_ROUND; n++) sum += ticketPrice(n, rate)
  console.log(`  ${name.padEnd(13)} ${fmt(rate).padStart(8)}/s ${fmt(ticketPrice(0, rate)).padStart(10)} ${fmt(sum).padStart(11)}  ${(sum / (rate * DAY_SECONDS)).toFixed(2).padStart(10)}`)
}

console.log('')
