#!/usr/bin/env node
/**
 * How long until a player reaches a quadrillion?
 *
 * The suffix ladder runs K · M · B · T · Q · Qi · Sx · Sp · Oc · No · Dc, so Q
 * is not the end — but it is where the numbers stop meaning anything to a
 * person, and the current curve gets there in days. This sweeps the four
 * constants that set the pace and reports when each combination crosses it.
 *
 * The player is the greedy optimum from sim-economy: always buys whatever widens
 * the current bottleneck for the fewest joints. A real player is slower, so
 * these are lower bounds on the time.
 *
 * The costScale column is the *opening* rate only — CAPACITY_COST_TIERS raises it
 * to 3.15 after ten upgrades and 3.6 after twenty, which is what stretches the
 * late game without touching the first hour.
 *
 *   node scripts/tune-pacing.mjs             # the sweep
 *   node scripts/tune-pacing.mjs 1.14 3 2 1024   # one set: upgMult costScale capStep cap
 */

const HORIZON = 400 * 86400   // stop looking after a bit over a year

/** One run with the constants set through the environment. */
async function run({ upgMult, costScale, capStep, milestoneCap }) {
  process.env.JF_UPG_MULT = String(upgMult)
  process.env.JF_COST_SCALE = String(costScale)
  process.env.JF_CAP_STEP = String(capStep)
  process.env.JF_MILESTONE_CAP = String(milestoneCap)

  // Fresh module instance per parameter set — the constants are read at import.
  const eco = await import(`../shared/economy.js?v=${upgMult}-${costScale}-${capStep}-${milestoneCap}`)
  const { PLANTATION_DEFS, plantLevelCost, newPlantation, initialState, throughput } = eco

  const gs = initialState()
  gs.plantagen[0].managerLevel = 1
  gs.courier.mgrLevel = 1
  gs.fabrik.mgrLevel = 1

  let t = 0, earned = 0
  const marks = {}
  const record = () => {
    for (const [label, value] of [['T', 1e12], ['Q', 1e15], ['Qi', 1e18]]) {
      if (earned >= value && marks[label] === undefined) marks[label] = t
    }
  }

  while (t < HORIZON) {
    const th = throughput(gs)
    const before = th.jointsPerSec
    if (before <= 0) break
    const eps = 1 + 1e-9
    const options = []

    if (th.plant <= before * eps) {
      for (let i = 0; i < gs.plantagen.length; i++) {
        const p = gs.plantagen[i]
        const cost = plantLevelCost(p)
        p.level++
        const gain = throughput(gs).plant - th.plant
        p.level--
        if (gain > 0) options.push({ kind: 'plant', i, cost, gain })
      }
      if (gs.plantagen.length < PLANTATION_DEFS.length) {
        const def = PLANTATION_DEFS[gs.plantagen.length]
        const p = newPlantation(def); p.managerLevel = 1
        gs.plantagen.push(p)
        const gain = throughput(gs).plant - th.plant
        gs.plantagen.pop()
        if (gain > 0) options.push({ kind: 'unlock', cost: def.unlockCost, gain })
      }
    }
    if (th.courier <= before * eps) options.push({ kind: 'courier', cost: gs.courier.capCost, gain: th.courier })
    if (th.fabrik <= before * eps) options.push({ kind: 'fabrik', cost: gs.fabrik.capCost, gain: th.fabrik })
    if (!options.length) break

    options.sort((a, b) => b.gain / b.cost - a.gain / a.cost)
    const pick = options[0]
    const wait = pick.cost / before
    if (t + wait > HORIZON) break

    // Everything spent had to be earned first, so the lifetime total is the
    // spend plus whatever sits unspent — the greedy player banks nothing.
    t += wait
    earned += pick.cost
    record()

    if (pick.kind === 'plant') gs.plantagen[pick.i].level++
    else if (pick.kind === 'courier') { const st = eco.capacitySteps(gs.courier.capacity, eco.BASE_CAPACITY.courier); gs.courier.capacity *= eco.CAPACITY_STEP; gs.courier.capCost = Math.floor(gs.courier.capCost * eco.capacityCostScale(st)) }
    else if (pick.kind === 'fabrik') { const st = eco.capacitySteps(gs.fabrik.capacity, eco.BASE_CAPACITY.fabrik); gs.fabrik.capacity *= eco.CAPACITY_STEP; gs.fabrik.capCost = Math.floor(gs.fabrik.capCost * eco.capacityCostScale(st)) }
    else { const p = newPlantation(PLANTATION_DEFS[gs.plantagen.length]); p.managerLevel = 1; gs.plantagen.push(p) }
  }
  record()

  return {
    marks,
    rate30: rateAt(30), rate180: rateAt(180),
    plots: gs.plantagen.length,
    finalRate: throughput(gs).jointsPerSec,
  }

  // Rate the chain had reached at a given day — replayed from the same events
  // would need bookkeeping; the final rate and the marks are what matters here.
  function rateAt() { return throughput(gs).jointsPerSec }
}

const d = s => s === undefined ? '—' : s >= 86400 ? (s / 86400).toFixed(1) + ' d' : (s / 3600).toFixed(1) + ' h'
const f = n => n >= 1e12 ? (n / 1e12).toFixed(1) + ' T' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' B' : (n / 1e6).toFixed(1) + ' M'

const args = process.argv.slice(2).filter(a => !a.startsWith('-'))
const sets = args.length >= 4
  ? [{ upgMult: +args[0], costScale: +args[1], capStep: +args[2], milestoneCap: +args[3] }]
  : [
      { upgMult: 1.12, costScale: 2.5, capStep: 2, milestoneCap: 1024 },   // wie eingebaut
      { upgMult: 1.14, costScale: 2.5, capStep: 2, milestoneCap: 1024 },
      { upgMult: 1.12, costScale: 2.2, capStep: 2, milestoneCap: 1024 },
      { upgMult: 1.12, costScale: 2.8, capStep: 2, milestoneCap: 1024 },
    ]

console.log('\n  upgMult  Kosten×  Kap×  Deckel     1 T      1 Q     1 Qi   Plots   Endrate')
for (const set of sets) {
  const r = await run(set)
  const mark = set.upgMult === 1.12 && set.costScale === 2.5 && set.capStep === 2 && set.milestoneCap === 1024 ? '  ← eingebaut' : ''
  console.log(
    `  ${String(set.upgMult).padEnd(8)} ${String(set.costScale).padEnd(8)} ${String(set.capStep).padEnd(5)} ${String(set.milestoneCap).padEnd(7)}` +
    `${d(r.marks.T).padStart(7)} ${d(r.marks.Q).padStart(8)} ${d(r.marks.Qi).padStart(8)}   ${String(r.plots).padStart(2)}   ${f(r.finalRate).padStart(8)}${mark}`)
}
console.log('\n  Zeiten sind Untergrenzen: der simulierte Spieler kauft immer optimal und pausiert nie.\n')
