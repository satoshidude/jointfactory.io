#!/usr/bin/env node
/**
 * Boost purchase checks — runs against a throwaway database, not your copy.
 *
 *   node scripts/test-boosts.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-boost-'))
process.env.DB_PATH = join(dir, 'test.db')

const { db } = await import('../server/db.js')
const { buyBoost, getActiveBoosts } = await import('../server/boosts.js')
const { boostMultipliers, BOOSTS, potPayout } = await import('../shared/economy.js')

const N = 'boost-probe'
db.prepare('DELETE FROM players WHERE npub=?').run(N)
db.prepare('DELETE FROM active_boosts WHERE npub=?').run(N)
// Budget derived from the prices, so a repricing does not break the test.
const F = BOOSTS.fertilizer.cost, FT = BOOSTS.fullthrottle.cost
const START = F * 2 + FT           // exactly two fertilizers and one full throttle
db.prepare('INSERT INTO players (npub, display_name, sats) VALUES (?,?,?)').run(N, 'Probe', START)
const potBefore = db.prepare("SELECT total_sats_collected p FROM lottery_rounds WHERE status='open'").get().p
let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }

console.log(`Start: ${START} Sats, Pot ${potBefore}\n`)

const r1 = buyBoost(N, 'fertilizer')
check(`Kauf Dünger (${F} Sats) → ok, Guthaben ${r1.sats}`, r1.ok && r1.sats === START - F)
const potA = db.prepare("SELECT total_sats_collected p FROM lottery_rounds WHERE status='open'").get().p
check(`Brutto in den Pot: ${potBefore} → ${potA} (+${potA-potBefore})`, potA - potBefore === F)

const m1 = boostMultipliers(getActiveBoosts(N), Math.floor(Date.now()/1000))
check(`Multiplikator plant=${m1.plant} courier=${m1.courier} fabrik=${m1.fabrik}`, m1.plant === 2 && m1.courier === 1)

const exp1 = getActiveBoosts(N)[0].expires_at
const r2 = buyBoost(N, 'fertilizer')
const exp2 = getActiveBoosts(N).find(b => b.type === 'fertilizer').expires_at
check(`Zweitkauf verlängert (+${exp2-exp1}s) statt zu stapeln`, exp2 - exp1 === BOOSTS.fertilizer.durationSec)
const m2 = boostMultipliers(getActiveBoosts(N), Math.floor(Date.now()/1000))
check(`Multiplikator bleibt bei ${m2.plant}x, keine Stapelung`, m2.plant === 2)
check(`nur eine Zeile pro Typ`, db.prepare('SELECT COUNT(*) c FROM active_boosts WHERE npub=? AND type=?').get(N,'fertilizer').c === 1)

const r3 = buyBoost(N, 'fullthrottle')
check(`Vollgas (${FT} Sats) bei ${r2.sats} Sats → ok, Rest ${r3.sats}`, r3.ok && r3.sats === 0)
const m3a = boostMultipliers(getActiveBoosts(N), Math.floor(Date.now()/1000))
check(`Dünger + Vollgas kombinieren: plant=${m3a.plant} courier=${m3a.courier} fabrik=${m3a.fabrik}`,
      m3a.plant === 4 && m3a.courier === 2 && m3a.fabrik === 2)

const r3b = buyBoost(N, 'fertilizer')
check(`Dünger (${F} Sats) bei ${r3.sats} Sats → abgelehnt: "${r3b.reason}"`, !r3b.ok)
check(`Guthaben unverändert nach Ablehnung`, db.prepare('SELECT sats s FROM players WHERE npub=?').get(N).s === 0)
const potAfterReject = db.prepare("SELECT total_sats_collected p FROM lottery_rounds WHERE status='open'").get().p
check(`Pot unverändert nach Ablehnung (${potAfterReject})`, potAfterReject === START)
check(`Auszahlung = 80 % des Brutto-Pots: ${potPayout(potAfterReject)}`, potPayout(potAfterReject) === Math.floor(START * 0.8))

const r4 = buyBoost(N, 'nonexistent')
check(`unbekannter Typ abgelehnt`, !r4.ok)

db.prepare('UPDATE active_boosts SET expires_at = unixepoch() - 10 WHERE npub=?').run(N)
check(`abgelaufene Boosts zählen nicht mehr`, getActiveBoosts(N).length === 0)
const m3 = boostMultipliers([{type:'fertilizer', expires_at: Math.floor(Date.now()/1000)-1}], Math.floor(Date.now()/1000))
check(`abgelaufener Boost → Multiplikator 1x`, m3.plant === 1)

db.prepare('DELETE FROM players WHERE npub=?').run(N)
db.prepare('DELETE FROM active_boosts WHERE npub=?').run(N)
db.prepare("UPDATE lottery_rounds SET total_sats_collected=? WHERE status='open'").run(potBefore)
console.log(fail ? `\n${fail} Fehler` : '\nAlle Boost-Checks bestanden')
rmSync(dir, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
