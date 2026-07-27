#!/usr/bin/env node
/**
 * Ticket pricing checks — runs against a throwaway database.
 *
 *   node scripts/test-ticket-price.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-ticket-'))
process.env.DB_PATH = join(dir, 'test.db')

const { db } = await import('../server/db.js')
const { getTicketPrice, getPriceCurvePreview, buyTicket } = await import('../server/lottery.js')
const {
  initialState, PLANTATION_DEFS, newPlantation, throughput,
  ticketPrice, TICKET_PRICE_CURVE, TICKET_SECONDS,
} = await import('../shared/economy.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const fmt = n => n >= 1e12 ? (n / 1e12).toFixed(1) + 'T'
  : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n)

/** A player whose whole chain is automated and sized to `capacity`. */
function makePlayer(npub, { plantLevels, capacity }) {
  const gs = initialState()
  gs.plantagen[0].managerLevel = 1
  gs.plantagen[0].level = plantLevels[0]
  for (let i = 1; i < plantLevels.length; i++) {
    const p = newPlantation(PLANTATION_DEFS[i])
    p.managerLevel = 1
    p.level = plantLevels[i]
    gs.plantagen.push(p)
  }
  gs.courier.mgrLevel = 1
  gs.courier.capacity = capacity
  gs.fabrik.mgrLevel = 1
  gs.fabrik.capacity = capacity
  db.prepare('DELETE FROM players WHERE npub=?').run(npub)
  db.prepare('INSERT INTO players (npub, display_name, sats, joints, joints_per_sec, game_state) VALUES (?,?,?,?,?,?)')
    .run(npub, npub, 0, 1e18, 0, JSON.stringify(gs))
  return throughput(gs).jointsPerSec
}

console.log('\n── Preis skaliert mit der eigenen Produktion ──')
const beginner = makePlayer('beginner', { plantLevels: [1], capacity: 20 })
const midgame = makePlayer('midgame', { plantLevels: [40, 30, 20], capacity: 5e5 })
const endgame = makePlayer('endgame', { plantLevels: [107, 70, 55, 59, 81, 80], capacity: 1e11 })

for (const [name, rate] of [['beginner', beginner], ['midgame', midgame], ['endgame', endgame]]) {
  const first = getTicketPrice(name, 0)
  const tenth = getTicketPrice(name, 9)
  console.log(`  ${name.padEnd(9)} ${fmt(rate).padStart(8)}/s → #1 ${fmt(first).padStart(8)}  #10 ${fmt(tenth).padStart(8)}`)
}

check('Anfänger zahlt den Bodenpreis', getTicketPrice('beginner', 0) === TICKET_PRICE_CURVE[0])
check('Endgame zahlt deutlich mehr als der Anfänger',
      getTicketPrice('endgame', 0) > getTicketPrice('beginner', 0) * 1000)
check('Preis entspricht 5 min Produktion beim Endgame-Spieler',
      Math.abs(getTicketPrice('endgame', 0) - endgame * TICKET_SECONDS[0]) <= 1)

console.log('\n── Kurvenform bleibt erhalten (Peak #5, Dip #6/#7) ──')
const curve = [...Array(8)].map((_, n) => ticketPrice(n, 1e6))
console.log('  ' + curve.map((c, i) => `#${i + 1}:${fmt(c)}`).join('  '))
check('Peak bei #5', curve[4] > curve[3] && curve[4] > curve[5])
check('Dip bei #7 unter #5', curve[6] < curve[4])

console.log('\n── Nicht manipulierbar über joints_per_sec ──')
db.prepare('UPDATE players SET joints_per_sec = 0 WHERE npub = ?').run('endgame')
check('gemeldete Rate 0 ändert den Preis nicht',
      getTicketPrice('endgame', 0) > TICKET_PRICE_CURVE[0] * 1000)

console.log('\n── Unbekannter/anonymer Spieler ──')
check('null-npub → Bodenkurve', getPriceCurvePreview(null, 0)[0].cost === TICKET_PRICE_CURVE[0])

console.log('\n── Kauf zieht den skalierten Preis ab ──')
db.prepare(`INSERT INTO lottery_rounds (draws_at, status) VALUES (unixepoch() + 3600, 'open')`).run()
const before = db.prepare('SELECT joints FROM players WHERE npub=?').get('endgame').joints
const expected = getTicketPrice('endgame', 0)
const res = buyTicket('endgame')
const after = db.prepare('SELECT joints FROM players WHERE npub=?').get('endgame').joints
check(`Kauf ok, ${fmt(expected)} abgezogen`, res.ok && before - after === expected)
check('nächster Preis liegt höher', res.next_ticket_cost > expected)

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Ticketpreis-Checks bestanden\n')
process.exit(fail ? 1 : 0)
