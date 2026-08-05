#!/usr/bin/env node
/**
 * How long does a round take?
 *
 * A round runs from a fresh chain to ROUND_TARGET. It has to hold three things
 * at once, and they pull against each other:
 *
 *   - a week for someone who plays with managers and looks in a few times a day
 *   - all six plots used, MegaFarm included — the last plot must be needed to
 *     finish, not a trophy for having finished
 *   - an opening that moves: the first upgrade inside a minute of tapping
 *
 * The simulated player is the greedy optimum from sim-economy: always buys
 * whatever widens the current bottleneck for the fewest joints, never hesitates,
 * never misses a moment. Every time below is therefore a *lower bound* — a real
 * player is slower.
 *
 * `moderat` is the same player made ordinary: every purchase lands twice as late
 * because nobody watches a chain continuously, and a third of what is earned goes
 * somewhere that does not widen the bottleneck — a lottery ticket, a speed step.
 * It exists for one question the optimum cannot answer: does the third plot still
 * arrive inside the first eight-hour session, or does it slip to tomorrow?
 *
 * `Fenster` is how many hours a day they are at the screen. Production continues
 * while they are away (that is what managers are for), but nothing is bought.
 *
 *   node scripts/tune-pacing.mjs                 # the profiles, as built
 *   node scripts/tune-pacing.mjs --sweep         # vary the constants
 *   node scripts/tune-pacing.mjs --boosts        # what boosting buys
 */

const HORIZON = 60 * 86400
const WINDOWS = [24, 8, 4]

/** One round. `slack` and `leak` turn the optimum into an ordinary player. */
async function round({ window = 24, boost = 1, env = {}, slack = 1, leak = 0 } = {}) {
  for (const [k, v] of Object.entries(env)) process.env[k] = String(v)
  const key = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('&')
  const eco = await import(`../shared/economy.js?v=${key}-${boost}`)
  const {
    PLANTATION_DEFS, plantLevelCost, newPlantation, initialState, throughput,
    capacitySteps, capacityCostScale, CAPACITY_STEP, BASE_CAPACITY,
    inheritedLevel, MAX_PLANT_LEVEL, ROUND_TARGET, START_LEVEL,
    speedCost, SPEED_STEP,
  } = eco

  const gs = initialState()
  gs.plantagen[0].managerLevel = 1
  gs.courier.mgrLevel = 1
  gs.fabrik.mgrLevel = 1
  // A boost multiplies the whole chain, so it can be modelled as more capacity
  // and more plant output rather than by running the boost bookkeeping.
  if (boost !== 1) {
    for (const p of gs.plantagen) p.baseProd *= boost
    gs.courier.capacity *= boost
    gs.fabrik.capacity *= boost
  }

  let t = 0, earned = 0, buys = 0, speedLevel = 0
  const unlockAt = []
  const spend = { level: 0, capacity: 0, unlock: 0, speed: 0 }
  const open = s => (s % 86400) < window * 3600
  const nextMorning = s => Math.ceil(s / 86400) * 86400

  while (t < HORIZON && earned < ROUND_TARGET) {
    const th = throughput(gs, { speedLevel })
    const rate = th.jointsPerSec
    if (rate <= 0) break
    const eps = 1 + 1e-9
    const options = []

    if (th.plant <= rate * eps) {
      for (let i = 0; i < gs.plantagen.length; i++) {
        const p = gs.plantagen[i]
        if (p.level >= MAX_PLANT_LEVEL) continue
        const cost = plantLevelCost(p)
        p.level++
        const gain = throughput(gs, { speedLevel }).plant - th.plant
        p.level--
        if (gain > 0) options.push({ kind: 'level', i, cost, gain })
      }
      if (gs.plantagen.length < PLANTATION_DEFS.length) {
        const def = PLANTATION_DEFS[gs.plantagen.length]
        const p = newPlantation(def, inheritedLevel(gs.plantagen))
        p.managerLevel = 1
        if (boost !== 1) p.baseProd *= boost
        gs.plantagen.push(p)
        const gain = throughput(gs, { speedLevel }).plant - th.plant
        gs.plantagen.pop()
        if (gain > 0) options.push({ kind: 'unlock', cost: def.unlockCost, gain })
      }
    }
    if (th.courier <= rate * eps) options.push({ kind: 'courier', cost: gs.courier.capCost, gain: th.courier })
    if (th.fabrik <= rate * eps) options.push({ kind: 'fabrik', cost: gs.fabrik.capCost, gain: th.fabrik })
    // Bought speed lifts the whole chain at once, so it competes with every
    // bottleneck fix rather than with one of them. Leaving it out of the model
    // made every time here a little pessimistic — a real player buys it.
    options.push({ kind: 'speed', cost: speedCost(speedLevel, rate), gain: rate * SPEED_STEP })
    if (!options.length) break

    options.sort((a, b) => b.gain / b.cost - a.gain / a.cost)
    const pick = options[0]
    let at = t + (pick.cost / rate) * slack / (1 - leak)
    // Bought only while the player is at the screen; production carries on.
    if (window < 24 && !open(at)) {
      const morning = nextMorning(at)
      earned += (morning - t) * rate
      at = morning
      if (earned >= ROUND_TARGET) { t = at; break }
    }
    if (at > HORIZON) { t = HORIZON; break }

    t = at
    earned += pick.cost
    buys++

    if (pick.kind === 'speed') { spend.speed += pick.cost; speedLevel++ }
    else if (pick.kind === 'level') { spend.level += pick.cost; gs.plantagen[pick.i].level++ }
    else if (pick.kind === 'courier') {
      spend.capacity += pick.cost
      const steps = capacitySteps(gs.courier.capacity / boost, BASE_CAPACITY.courier)
      gs.courier.capacity *= CAPACITY_STEP
      gs.courier.capCost = Math.floor(gs.courier.capCost * capacityCostScale(steps))
    } else if (pick.kind === 'fabrik') {
      spend.capacity += pick.cost
      const steps = capacitySteps(gs.fabrik.capacity / boost, BASE_CAPACITY.fabrik)
      gs.fabrik.capacity *= CAPACITY_STEP
      gs.fabrik.capCost = Math.floor(gs.fabrik.capCost * capacityCostScale(steps))
    } else {
      spend.unlock += pick.cost
      const p = newPlantation(PLANTATION_DEFS[gs.plantagen.length], inheritedLevel(gs.plantagen))
      p.managerLevel = 1
      if (boost !== 1) p.baseProd *= boost
      gs.plantagen.push(p)
      unlockAt.push(t)
    }
  }

  // The opening, measured the way a new player meets it: tapping a fresh chain
  // until the first level is affordable.
  const opening = (() => {
    const fresh = initialState()
    fresh.plantagen[0].managerLevel = 1
    fresh.courier.mgrLevel = 1
    fresh.fabrik.mgrLevel = 1
    const r = throughput(fresh).jointsPerSec
    return r > 0 ? plantLevelCost(fresh.plantagen[0]) / r : Infinity
  })()

  return {
    reached: earned >= ROUND_TARGET ? t : null,
    plots: gs.plantagen.length,
    unlockAt,
    megafarm: unlockAt[PLANTATION_DEFS.length - 2] ?? null,
    rate: throughput(gs, { speedLevel }).jointsPerSec,
    levels: gs.plantagen.map(p => p.level),
    speedLevel,
    speedMult: eco.speedMultiplier(speedLevel),
    speedStep: SPEED_STEP,
    buys, spend, opening, target: ROUND_TARGET, startLevel: START_LEVEL,
  }
}

const d = s => s == null ? '—' : s >= 86400 ? (s / 86400).toFixed(1) + ' d' : (s / 3600).toFixed(1) + ' h'
const f = n => n >= 1e15 ? (n / 1e15).toFixed(2) + ' Q' : n >= 1e12 ? (n / 1e12).toFixed(1) + ' T'
  : n >= 1e9 ? (n / 1e9).toFixed(2) + ' B' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + ' K' : n.toFixed(1)

const args = process.argv.slice(2)

if (args.includes('--sweep')) {
  // The two constants that move the clock without changing what is worth buying.
  console.log('\n  Erbe   Grenze    24 h        8 h         4 h        Plots   MegaFarm')
  for (const inherit of [0.3, 0.5, 0.7]) {
    for (const cap of [30, 50, 100]) {
      const env = { JF_UNLOCK_INHERIT: inherit, JF_MAX_LEVEL: cap }
      const runs = []
      for (const w of WINDOWS) runs.push(await round({ window: w, env }))
      const mf = runs[0].megafarm
      console.log(
        `  ${String(inherit).padEnd(6)} ${String(cap).padEnd(8)}` +
        runs.map(r => d(r.reached).padStart(10)).join('  ') +
        `   ${String(runs[0].plots).padStart(3)}    ` +
        (mf != null && runs[0].reached ? `${d(mf)} (${(mf / runs[0].reached * 100).toFixed(0)} %)` : '—'))
    }
  }
  console.log('\n  Zeiten sind Untergrenzen: der simulierte Spieler kauft immer optimal.\n')
  process.exit(0)
}

if (args.includes('--boosts')) {
  console.log('\n  Was Boosten einbringt (Fenster 8 h/Tag)\n')
  console.log('  Profil                       Faktor        1 B     Sats/Tag')
  const profiles = [
    ['ohne Boosts', 1, 0],
    ['2-3 Boosts/Woche', 1.03, 21],
    ['2-3 Boosts/Tag', 1.12, 150],
    ['Full Throttle dauerhaft', 2, 1200],
    ['alle vier dauerhaft', 5.2, 4224],
  ]
  for (const [name, boost, sats] of profiles) {
    const r = await round({ window: 8, boost })
    console.log(`  ${name.padEnd(28)} ${('x' + boost).padStart(6)} ${d(r.reached).padStart(10)} ${String(sats).padStart(12)}`)
  }
  console.log()
  process.exit(0)
}

// ── As built ────────────────────────────────────────────────────────────────
const base = await round({ window: 24 })
console.log(`\n  Runde bis ${f(base.target)} Joints · Startlevel ${base.startLevel} · Grenze je Plantage`)
console.log('\n  Fenster     Ziel      Plots   MegaFarm bei        Rate am Ziel   Käufe')
const runs = []
for (const w of WINDOWS) {
  const r = await round({ window: w })
  runs.push(r)
  const mf = r.megafarm
  console.log(
    `  ${(w + ' h/Tag').padEnd(10)} ${d(r.reached).padStart(7)} ${String(r.plots).padStart(8)}   ` +
    (mf != null && r.reached ? `${d(mf)} (${(mf / r.reached * 100).toFixed(0)} %)` : '—').padEnd(18) +
    `${(f(r.rate) + '/s').padStart(10)}   ${String(r.buys).padStart(5)}`)
}
console.log(`\n  Level je Plantage am Ziel: ${runs[0].levels.join('/')}`)
console.log(`  Ausgaben: Level ${f(runs[0].spend.level)} · Kapazität ${f(runs[0].spend.capacity)} · Freischaltung ${f(runs[0].spend.unlock)} · Speed ${f(runs[0].spend.speed)}`)
console.log(`  Gekaufter Speed am Ziel: Stufe ${runs[0].speedLevel} (×${runs[0].speedMult.toFixed(2)}, +${(base.speedStep * 100).toFixed(0)} % je Stufe)`)
console.log(`  Einstieg: erste Stufe nach ${runs[0].opening.toFixed(0)} s Tippen`)

// ── The first session ───────────────────────────────────────────────────────
// The third plot is what a new player is playing towards on day one. Whether it
// lands before the day is over is not a question the optimum can answer.
const moderat = await round({ window: 8, slack: 2, leak: 0.3 })
const gemuetlich = await round({ window: 8, slack: 3, leak: 0.4 })
console.log('\n  Dritte Plantage (Indoor Room)')
console.log(`    optimal, 8 h/Tag        ${d(runs[1].unlockAt[1])}`)
console.log(`    moderat (2x, 30 % ab)   ${d(moderat.unlockAt[1])}`)
console.log(`    gemütlich (3x, 40 % ab) ${d(gemuetlich.unlockAt[1])}`)

// ── The criteria the round was designed against ─────────────────────────────
const checks = [
  ['rund um die Uhr mindestens 3 Tage', runs[0].reached >= 3 * 86400],
  ['bei 8 h/Tag mindestens 4 Tage', runs[1].reached >= 4 * 86400],
  ['bei 4 h/Tag mindestens 6 Tage', runs[2].reached >= 6 * 86400],
  ['alle sechs Plantagen in jedem Profil', runs.every(r => r.plots === 6)],
  ['MegaFarm wird gebraucht', runs.every(r => r.megafarm != null && r.megafarm < r.reached)],
  // Inherited levels arrive with an unlock rather than being bought one by one,
  // so the count is lower than the levels on the plots suggest — 50 purchases is
  // roughly one every hour and a half over a four-day round.
  ['mindestens 50 Käufe', runs[0].buys >= 50],
  // Measured against the *chain*, which a fresh courier holds at 0.125/s. The
  // plantation alone would suggest four times that and has misled this
  // calibration once already.
  ['erste Stufe unter einer Minute', runs[0].opening < 60],
  // Inside the first eight-hour session, for a player who is not optimal. Past
  // that the plot slips a whole day, because the window has closed.
  ['dritte Plantage in unter 8 h, auch moderat gespielt',
   moderat.unlockAt[1] != null && moderat.unlockAt[1] < 8 * 3600],
]
console.log()
let fail = 0
for (const [label, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${label}`); if (!ok) fail++ }
console.log(fail ? `\n  ${fail} Kriterium/Kriterien verfehlt\n` : '\n  Die Runde hält alle Kriterien.\n')
process.exit(fail ? 1 : 0)
