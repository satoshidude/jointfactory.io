#!/usr/bin/env node
/**
 * Speed ladder — runs against a throwaway database.
 *
 * The calibration target: spending a full month of production buys at most
 * +20 % speed.
 *
 *   node scripts/test-speed.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-speed-'))
process.env.DB_PATH = join(dir, 'test.db')

// Balances stay under 2^53: joints are read into JS as doubles, so arithmetic
// above ~9.0e15 silently loses the smallest digits. Real balances are below
// that today; the largest is 1.77e15.
const { db } = await import('../server/db.js')
const { buySpeed, speedStatus, playerRate } = await import('../server/speed.js')
const {
  initialState, newPlantation, PLANTATION_DEFS, throughput,
  speedCost, speedCostSeconds, speedMultiplier,
  SPEED_STEP, SPEED_MONTHLY_CAP, SPEED_MAX_SECONDS,
} = await import('../shared/economy.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const fmt = n => n >= 1e15 ? (n / 1e15).toFixed(1) + 'Q' : n >= 1e12 ? (n / 1e12).toFixed(1) + 'T'
  : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n))
const DAY = 86400

function makePlayer(npub, { plantLevels, capacity, joints }) {
  const gs = initialState()
  gs.plantagen[0].managerLevel = 1
  gs.plantagen[0].level = plantLevels[0]
  for (let i = 1; i < plantLevels.length; i++) {
    const p = newPlantation(PLANTATION_DEFS[i])
    p.managerLevel = 1
    p.level = plantLevels[i]
    gs.plantagen.push(p)
  }
  gs.courier.mgrLevel = 1; gs.courier.capacity = capacity
  gs.fabrik.mgrLevel = 1;  gs.fabrik.capacity = capacity
  db.prepare('DELETE FROM players WHERE npub=?').run(npub)
  db.prepare('INSERT INTO players (npub, display_name, sats, joints, game_state) VALUES (?,?,0,?,?)')
    .run(npub, npub, joints, JSON.stringify(gs))
  return throughput(gs).jointsPerSec
}

// ── The ceiling ─────────────────────────────────────────────────────────────
console.log('\n── Obergrenze: ein Monat Produktion kauft höchstens +20 % ──')
const stepsPerMonth = Math.log(SPEED_MONTHLY_CAP) / Math.log(1 + SPEED_STEP)
console.log(`  ${stepsPerMonth.toFixed(1)} Stufen/Monat · Deckel ${(SPEED_MAX_SECONDS / DAY).toFixed(2)} Produktionstage je Stufe`)
check('Deckel entspricht der Monatsgrenze',
      Math.abs(SPEED_MAX_SECONDS * stepsPerMonth - 30 * DAY) < 1)
check('erste Stufe kostet 5 min Produktion', speedCostSeconds(0) === 300)
check('Kosten steigen bis zum Deckel und bleiben dort',
      speedCostSeconds(10) > speedCostSeconds(5) && speedCostSeconds(200) === SPEED_MAX_SECONDS)
check('Multiplikator ist multiplikativ', Math.abs(speedMultiplier(2) - 1.02 * 1.02) < 1e-9)

// The cap binds once the price has reached its ceiling. The first ~24 steps are
// deliberately cheaper — a ramp so the ladder is reachable early — so a run from
// zero gains more in its first month than the steady-state cap allows.
function stepsFor(budgetSeconds, fromLevel = 0) {
  let budget = budgetSeconds, n = fromLevel
  while (budget >= speedCostSeconds(n)) { budget -= speedCostSeconds(n); n++ }
  return n - fromLevel
}
{
  const fresh = stepsFor(30 * DAY)
  console.log(`  aus dem Stand: 30 Tage Produktion → ${fresh} Stufen → ×${speedMultiplier(fresh).toFixed(3)} (Anlaufphase)`)
  const steady = stepsFor(30 * DAY, 40)
  const factor = speedMultiplier(40 + steady) / speedMultiplier(40)
  console.log(`  am Deckel:     30 Tage Produktion → ${steady} Stufen → ×${factor.toFixed(3)}`)
  check('am Deckel höchstens +20 % im Monat', factor <= SPEED_MONTHLY_CAP + 0.001)
  check('Anlaufphase bleibt moderat', speedMultiplier(fresh) < 2)
}

// ── Price is relative to the buyer's own output ─────────────────────────────
console.log('\n── Preis hängt an der eigenen Produktion ──')
const smallRate = makePlayer('small', { plantLevels: [1], capacity: 20, joints: 1e12 })
const bigRate = makePlayer('big', { plantLevels: [107, 70, 55, 59, 81, 80], capacity: 1e11, joints: 1e15 })
console.log(`  klein ${fmt(smallRate)}/s → ${fmt(speedCost(0, smallRate))}   ·   groß ${fmt(bigRate)}/s → ${fmt(speedCost(0, bigRate))}`)
check('gleicher Preis in Produktionszeit',
      Math.abs(speedCost(0, smallRate) / smallRate - speedCost(0, bigRate) / bigRate) < 1)

// ── Purchase ────────────────────────────────────────────────────────────────
console.log('\n── Kauf ──')
const beforeJoints = db.prepare('SELECT joints FROM players WHERE npub=?').get('small').joints
const quoted = speedStatus('small').next_cost
const res = buySpeed('small')
const afterJoints = db.prepare('SELECT joints FROM players WHERE npub=?').get('small').joints
check(`Kauf ok, Stufe ${res.level}`, res.ok && res.level === 1)
check(`genau der genannte Preis abgezogen (${fmt(quoted)})`, beforeJoints - afterJoints === quoted)
check('Multiplikator ×1.02', Math.abs(res.multiplier - 1.02) < 1e-9)
check('Rate steigt entsprechend', Math.abs(playerRate('small') / smallRate - 1.02) < 1e-6)
check('nächste Stufe kostet mehr', speedStatus('small').next_cost > quoted)

// ── Guards ──────────────────────────────────────────────────────────────────
console.log('\n── Absicherungen ──')
db.prepare('UPDATE players SET joints = 1 WHERE npub = ?').run('small')
const poor = buySpeed('small')
check(`ohne Deckung abgelehnt: "${poor.reason}"`, !poor.ok)
check('Guthaben unverändert', db.prepare('SELECT joints FROM players WHERE npub=?').get('small').joints === 1)
check('Stufe unverändert', db.prepare('SELECT speed_level s FROM players WHERE npub=?').get('small').s === 1)

// A player whose chain produces nothing cannot buy — the price would be zero.
const idle = initialState()
db.prepare('INSERT INTO players (npub, display_name, sats, joints, game_state) VALUES (?,?,0,?,?)')
  .run('idle', 'idle', 1e12, JSON.stringify(idle))
const idleRes = buySpeed('idle')
check(`ohne laufende Kette abgelehnt: "${idleRes.reason}"`, !idleRes.ok)

// Reported rate must not be able to lower the price.
db.prepare('UPDATE players SET joints_per_sec = 0 WHERE npub = ?').run('big')
check('gemeldete Rate 0 senkt den Preis nicht', speedStatus('big').next_cost > 1e9)

// ── Chain-wide effect ───────────────────────────────────────────────────────
console.log('\n── Wirkung auf die Kette ──')
{
  const gs = JSON.parse(db.prepare('SELECT game_state g FROM players WHERE npub=?').get('big').g)
  const base = throughput(gs)
  const lifted = throughput(gs, { speedLevel: 24 })
  console.log(`  ohne ${fmt(base.jointsPerSec)}/s → Stufe 24 ${fmt(lifted.jointsPerSec)}/s  (×${(lifted.jointsPerSec / base.jointsPerSec).toFixed(2)})`)
  check('alle drei Stufen skalieren',
        Math.abs(lifted.plant / base.plant - speedMultiplier(24)) < 1e-9 &&
        Math.abs(lifted.courier / base.courier - speedMultiplier(24)) < 1e-9 &&
        Math.abs(lifted.fabrik / base.fabrik - speedMultiplier(24)) < 1e-9)
}

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Speed-Checks bestanden\n')
process.exit(fail ? 1 : 0)
