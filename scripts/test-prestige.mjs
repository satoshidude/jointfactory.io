#!/usr/bin/env node
/**
 * Prestige checks — runs against a throwaway database.
 *
 * The rule under test: a harvest resets everything joints bought and nothing
 * sats bought.
 *
 *   node scripts/test-prestige.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-prestige-'))
process.env.DB_PATH = join(dir, 'test.db')

const { db } = await import('../server/db.js')
const { doPrestige, prestigeStatus } = await import('../server/prestige.js')
const {
  initialState, newPlantation, PLANTATION_DEFS, takeParkedUpgrades,
  prestigeSeeds, prestigeMultiplier, throughput, PRESTIGE,
} = await import('../shared/economy.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const fmt = n => n >= 1e15 ? (n / 1e15).toFixed(1) + 'Q' : n >= 1e12 ? (n / 1e12).toFixed(1) + 'T'
  : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n))

console.log('\n── Seed-Kurve ──')
for (const lt of [1e8, 1e9, 1e10, 1e12, 1e15, 1e16, 1e18]) {
  const s = prestigeSeeds(lt)
  console.log(`  Lifetime ${fmt(lt).padStart(7)}  →  ${String(s).padStart(4)} Seeds  =  ×${prestigeMultiplier(s).toFixed(2)}`)
}
check('unter der Schwelle keine Seeds', prestigeSeeds(PRESTIGE.minLifetime - 1) === 0)
check('Seeds wachsen monoton', prestigeSeeds(1e12) > prestigeSeeds(1e10))
check('je 10× Lifetime rund +50 Seeds',
      Math.abs((prestigeSeeds(1e15) - prestigeSeeds(1e14)) - 50) <= 1)

// ── A fully built player, with sats-bought upgrades everywhere ──────────────
const NPUB = 'harvester'
const gs = initialState()
gs.plantagen[0].level = 107
gs.plantagen[0].managerLevel = 1
gs.plantagen[0].speedLevel = 11
gs.plantagen[0].speed = 1.37
for (let i = 1; i < 6; i++) {
  const p = newPlantation(PLANTATION_DEFS[i])
  p.level = 50 + i
  p.managerLevel = 1
  p.speedLevel = 4 + i        // sats bought these
  p.speed = 1 + (4 + i) / 60 * 2
  gs.plantagen.push(p)
}
gs.courier.mgrLevel = 1; gs.courier.capacity = 8.6e10; gs.courier.speedLevel = 5; gs.courier.speed = 1.17
gs.fabrik.mgrLevel = 1;  gs.fabrik.capacity = 1.07e11; gs.fabrik.speedLevel = 4;  gs.fabrik.speed = 1.13
gs.cannabis = 3.2e12

db.prepare('INSERT INTO players (npub, display_name, sats, joints, total_joints_earned, game_state) VALUES (?,?,?,?,?,?)')
  .run(NPUB, 'Harvester', 1882, 2.6e13, 7.5e15, JSON.stringify(gs))

const before = { rate: throughput(gs).jointsPerSec, ...db.prepare('SELECT joints, sats FROM players WHERE npub=?').get(NPUB) }
const status = prestigeStatus(NPUB)
console.log(`\n── Ernte bei ${fmt(7.5e15)} Lifetime ──`)
console.log(`  vorher: ${fmt(before.rate)}/s, ${fmt(before.joints)} Joints, ${before.sats} Sats`)
console.log(`  Ernte bringt: +${status.gain} Seeds → ×${prestigeMultiplier(status.gain).toFixed(2)}`)

const res = doPrestige(NPUB)
check('Ernte erfolgreich', res.ok)

const after = db.prepare('SELECT joints, sats, prestige_seeds, game_state FROM players WHERE npub=?').get(NPUB)
const ngs = JSON.parse(after.game_state)

console.log('\n── Was zurückgesetzt wurde (joint-gekauft) ──')
check('Joints auf 0', after.joints === 0)
check('Plantagen-Level zurück auf 1', ngs.plantagen[0].level === 1)
check('nur noch die erste Plantage', ngs.plantagen.length === 1)
check('Kurier-Kapazität zurück auf 20', ngs.courier.capacity === 20)
check('Fabrik-Kapazität zurück auf 100', ngs.fabrik.capacity === 100)
check('Cannabis-Lager geleert', ngs.cannabis === 0)

console.log('\n── Was erhalten blieb (sats-gekauft) ──')
check(`Sats unangetastet (${after.sats})`, after.sats === before.sats)
check('Speed-Level Plantage #1 erhalten (11)', ngs.plantagen[0].speedLevel === 11)
check('Manager Plantage #1 erhalten', ngs.plantagen[0].managerLevel === 1)
check('Kurier: Speed 5 + Manager erhalten', ngs.courier.speedLevel === 5 && ngs.courier.mgrLevel === 1)
check('Fabrik: Speed 4 + Manager erhalten', ngs.fabrik.speedLevel === 4 && ngs.fabrik.mgrLevel === 1)
check('Lifetime bleibt stehen', db.prepare('SELECT total_joints_earned t FROM players WHERE npub=?').get(NPUB).t === 7.5e15)

console.log('\n── Geparkte Upgrades der gesperrten Plantagen ──')
check('5 Plantagen geparkt', (ngs._parkedSpeed || []).length === 5)
const parked2 = takeParkedUpgrades(ngs, 1)
check('Plantage #2: Speed 5 + Manager geparkt', parked2?.speedLevel === 5 && parked2?.managerLevel === 1)
check('Eintrag danach entfernt (nur einmal einlösbar)', takeParkedUpgrades(ngs, 1) === null)

console.log('\n── Wirkung des Multiplikators ──')
const seeds = after.prestige_seeds
const freshRate = throughput(ngs).jointsPerSec
const boostedRate = throughput(ngs, { seeds }).jointsPerSec
console.log(`  ${seeds} Seeds → ×${prestigeMultiplier(seeds).toFixed(2)}`)
console.log(`  Startrate ohne Seeds ${freshRate.toFixed(2)}/s → mit Seeds ${boostedRate.toFixed(2)}/s`)
check('Multiplikator wirkt kettenweit',
      Math.abs(boostedRate / freshRate - prestigeMultiplier(seeds)) < 0.01)

console.log('\n── Zweite Ernte ohne Fortschritt ──')
const again = doPrestige(NPUB)
check(`abgelehnt: "${again.reason}"`, !again.ok)
check('Seeds unverändert', db.prepare('SELECT prestige_seeds s FROM players WHERE npub=?').get(NPUB).s === seeds)

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Prestige-Checks bestanden\n')
process.exit(fail ? 1 : 0)
