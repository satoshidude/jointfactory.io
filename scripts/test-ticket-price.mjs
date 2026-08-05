#!/usr/bin/env node
/**
 * Ticket pricing and the daily allowance — runs against a throwaway database.
 *
 * Calibration targets: a top player affords four tickets a day, a beginner one
 * every two days.
 *
 *   node scripts/test-ticket-price.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-ticket-'))
process.env.DB_PATH = join(dir, 'test.db')

const { db } = await import('../server/db.js')
const { getTicketPrice, getPriceCurvePreview, buyTicket, ticketsInRound } = await import('../server/lottery.js')
const {
  initialState, PLANTATION_DEFS, newPlantation, throughput, ticketPrice, ticketScale,
  MAX_TICKETS_PER_ROUND, DAY_SECONDS, RATE_BEGINNER, RATE_TOP, START_LEVEL, BASE_CAPACITY,
} = await import('../shared/economy.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const fmt = n => n >= 1e12 ? (n / 1e12).toFixed(1) + 'T'
  : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n))

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
  gs.courier.mgrLevel = 1
  gs.courier.capacity = capacity
  gs.fabrik.mgrLevel = 1
  gs.fabrik.capacity = capacity
  db.prepare('DELETE FROM players WHERE npub=?').run(npub)
  db.prepare('INSERT INTO players (npub, display_name, sats, joints, joints_per_sec, game_state) VALUES (?,?,?,?,?,?)')
    .run(npub, npub, 0, joints, 0, JSON.stringify(gs))
  return throughput(gs).jointsPerSec
}

// ── Calibration ─────────────────────────────────────────────────────────────
console.log('\n── Kalibrierung: Lose pro Tag aus reiner Produktion ──')
console.log('  Spieler       Rate         Los #1      4 Lose        = Produktionstage')
// Spread over the anchors rather than fixed rates, so the table keeps meaning
// something when the round is recalibrated.
const step = Math.pow(RATE_TOP / RATE_BEGINNER, 1 / 5)
const rows = [
  ['Einsteiger', RATE_BEGINNER],
  ['nach 1h', RATE_BEGINNER * step],
  ['früh', RATE_BEGINNER * step ** 2],
  ['Mitte', RATE_BEGINNER * step ** 3],
  ['fortgeschr.', RATE_BEGINNER * step ** 4],
  ['Top', RATE_TOP],
]
for (const [name, rate] of rows) {
  let sum = 0
  for (let n = 0; n < MAX_TICKETS_PER_ROUND; n++) sum += ticketPrice(n, rate)
  const days = sum / (rate * DAY_SECONDS)
  console.log(`  ${name.padEnd(12)} ${fmt(rate).padStart(8)}/s ${fmt(ticketPrice(0, rate)).padStart(10)} ${fmt(sum).padStart(11)}  ${days.toFixed(2).padStart(8)}`)
}

const topFour = [0, 1, 2, 3].reduce((s, n) => s + ticketPrice(n, RATE_TOP), 0)
check('Top-Spieler: 4 Lose = genau 1 Produktionstag',
      Math.abs(topFour / (RATE_TOP * DAY_SECONDS) - 1) < 0.01)
check('Einsteiger: Los #1 = 2 Produktionstage',
      Math.abs(ticketPrice(0, RATE_BEGINNER) / (RATE_BEGINNER * DAY_SECONDS) - 2) < 0.01)
check('Preis steigt innerhalb des Tages',
      ticketPrice(0, 1e6) < ticketPrice(1, 1e6) &&
      ticketPrice(1, 1e6) < ticketPrice(2, 1e6) &&
      ticketPrice(2, 1e6) < ticketPrice(3, 1e6))
check('Skala fällt monoton mit der Rate',
      rows.every(([, rate], i) => i === 0 || ticketScale(rows[i - 1][1]) > ticketScale(rate)))
check('Skala unter/über den Ankern gedeckelt',
      ticketScale(0.1) === ticketScale(RATE_BEGINNER) && ticketScale(1e15) === 1)

// ── Daily cap ───────────────────────────────────────────────────────────────
console.log('\n── Losgrenze je Ziehung ──')
db.prepare(`INSERT INTO lottery_rounds (draws_at, status) VALUES (unixepoch() + 3600, 'open')`).run()

// A hoarder: endgame rate, but thirteen days of production already banked —
// exactly the situation the live top accounts are in.
// Levels are what a finished round looks like under the current curve; the
// capacity is wide enough that the plantations are the limit, which puts the
// chain at the top anchor. The hoard is about thirteen days of that output.
const hoardRate = makePlayer('hoarder', {
  plantLevels: [37, 35, 37, 40, 42, 45], capacity: 2e11, joints: 2.5e16,
})
const results = []
for (let i = 0; i < 8; i++) results.push(buyTicket('hoarder'))
const bought = results.filter(r => r.ok).length
console.log(`  Rate ${fmt(hoardRate)}/s, Bestand ${fmt(2.5e16)} Joints (~${(2.5e16 / (hoardRate * DAY_SECONDS)).toFixed(0)} Produktionstage)`)
console.log(`  8 Kaufversuche → ${bought} gekauft, dann: "${results.find(r => !r.ok)?.reason}"`)
check(`Horter auf ${MAX_TICKETS_PER_ROUND} Lose je Ziehung begrenzt`, bought === MAX_TICKETS_PER_ROUND)
check('Zähler stimmt', ticketsInRound('hoarder') === MAX_TICKETS_PER_ROUND)
check('Vorschau ist leer, wenn ausgeschöpft', getPriceCurvePreview('hoarder').length === 0)

// The allowance belongs to the round, not to the calendar: waiting a day does
// not hand out four more. Only the next draw does.
db.prepare(`UPDATE lottery_tickets SET purchased_at = unixepoch() - 86500 WHERE npub = 'hoarder'`).run()
check('ein Tag später immer noch ausgeschöpft',
      ticketsInRound('hoarder') === MAX_TICKETS_PER_ROUND && buyTicket('hoarder').ok === false)

// Next round: allowance resets, and tickets carried over from an undrawn round
// count against it.
// The round the hoarder actually bought into — db.js opens one on import, so it
// is not necessarily the one this script inserted.
const oldRound = db.prepare("SELECT round_id FROM lottery_tickets WHERE npub='hoarder' LIMIT 1").get().round_id
db.prepare("UPDATE lottery_rounds SET status='closed' WHERE status='open'").run()
const newRound = db.prepare(`INSERT INTO lottery_rounds (draws_at, status) VALUES (unixepoch() + 3600, 'open')`).run().lastInsertRowid
check('neue Ziehung, neues Kontingent', ticketsInRound('hoarder') === 0 && buyTicket('hoarder').ok)
db.prepare('UPDATE lottery_tickets SET round_id = ? WHERE round_id = ?').run(newRound, oldRound)
console.log(`  übertragene Lose zählen mit: ${ticketsInRound('hoarder')} in der neuen Runde`)
check('übertragene Lose zählen gegen das Kontingent',
      ticketsInRound('hoarder') > MAX_TICKETS_PER_ROUND && buyTicket('hoarder').ok === false)

// ── Beginner reality check ──────────────────────────────────────────────────
console.log('\n── Einsteiger ──')
const beginnerRate = makePlayer('beginner', { plantLevels: [START_LEVEL], capacity: BASE_CAPACITY.courier, joints: 0 })
const oneDay = beginnerRate * DAY_SECONDS
const twoDays = beginnerRate * 2 * DAY_SECONDS
console.log(`  Rate ${beginnerRate}/s → nach 1 Tag ${fmt(oneDay)} Joints, nach 2 Tagen ${fmt(twoDays)}`)
console.log(`  Los #1 kostet ${fmt(getTicketPrice('beginner'))}`)
check('nach 1 Tag noch nicht leistbar', oneDay < getTicketPrice('beginner'))
check('nach 2 Tagen leistbar', twoDays >= getTicketPrice('beginner'))

// ── Not gameable through the reported rate ──────────────────────────────────
console.log('\n── Gekaufter Speed zählt in den Preis ──')
{
  const gs = JSON.parse(db.prepare('SELECT game_state g FROM players WHERE npub=?').get('beginner').g)
  const base = getTicketPrice('beginner')
  db.prepare('UPDATE players SET speed_level = 24 WHERE npub = ?').run('beginner')
  const lifted = getTicketPrice('beginner')
  const rate = throughput(gs).jointsPerSec
  const liftedRate = throughput(gs, { speedLevel: 24 }).jointsPerSec
  console.log(`  ${rate.toFixed(2)}/s → ${fmt(base)}   ·   mit Stufe 24 ${liftedRate.toFixed(2)}/s → ${fmt(lifted)}`)
  check('Speed erhöht den Ticketpreis mit', lifted > base * 1.5)
  db.prepare('UPDATE players SET speed_level = 0 WHERE npub = ?').run('beginner')
}

console.log('\n── Nicht manipulierbar ──')
// The price must come from the saved chain, not from a number the client sent.
// Comparing against the chain's own rate keeps this true at any calibration —
// a fixed joint threshold only ever tested the curve it was written for.
const honest = ticketPrice(ticketsInRound('hoarder'), hoardRate)
db.prepare('UPDATE players SET joints_per_sec = 0 WHERE npub = ?').run('hoarder')
check('gemeldete Rate 0 senkt den Preis nicht', getTicketPrice('hoarder') === honest)

// ── Der Ticket-Gate ist serverseitig ────────────────────────────────────────
// Zwei Bedingungen: die Kette automatisiert (ein kettenloses Konto produziert
// nichts, sein Los fiel auf den Ein-Joint-Boden — vier Joints kauften vier
// Lose in einer Runde mit echten Sats), und ein Manager in dieser Runde für
// Sats gekauft. Die drei Gratis-Manager sind genau die drei, die die Lotterie
// verlangt hat; damit stand das Tor offen.
console.log('\n── Ohne automatisierte Kette kein Los ──')
{
  const { ticketEligibility, buyTicket } = await import('../server/lottery.js')
  const { initialState, FREE_MANAGERS, managerPrice } = await import('../shared/economy.js')
  const bare = initialState()
  db.prepare('INSERT INTO players (npub, display_name, joints, sats, game_state) VALUES (?,?,?,?,?)')
    .run('freeloader', 'Freeloader', 1_000_000, 0, JSON.stringify(bare))
  const elig = ticketEligibility('freeloader')
  console.log(`  Manager ${elig.managers}/${elig.required} · Lospreis ${getTicketPrice('freeloader')} Joints`)
  check('Preis fällt tatsächlich auf den Boden', getTicketPrice('freeloader') === 1)
  check('gilt als nicht berechtigt', elig.eligible === false)
  const res = buyTicket('freeloader')
  check('Kauf wird abgewiesen', res.ok === false)
  console.log(`  Server: "${res.reason}"`)
  check('kein Los in der Runde',
        db.prepare("SELECT COUNT(*) n FROM lottery_tickets WHERE npub='freeloader'").get().n === 0)
  check('Joints unberührt',
        db.prepare("SELECT joints j FROM players WHERE npub='freeloader'").get().j === 1_000_000)

  const save = () => db.prepare('UPDATE players SET game_state = ? WHERE npub = ?')
    .run(JSON.stringify(bare), 'freeloader')

  bare.plantagen[0].managerLevel = 1; bare.courier.mgrLevel = 1; bare.fabrik.mgrLevel = 1
  save()

  console.log('\n── Drei Gratis-Manager reichen nicht ──')
  {
    const elig = ticketEligibility('freeloader')
    check(`die Kette gilt als automatisiert`, elig.missing === 0)
    check(`kein Manager bezahlt (${FREE_MANAGERS} sind frei)`, elig.paid === 0)
    check('trotzdem nicht berechtigt', elig.eligible === false)
    const res = buyTicket('freeloader')
    check('Kauf wird abgewiesen', res.ok === false)
    console.log(`  Server: "${res.reason}"`)
    check('die Begründung nennt die Sats', /sats/i.test(res.reason))
    check('Preis stimmt mit der Runde überein', res.reason.includes(String(managerPrice(0))))
  }

  console.log('\n── Ein bezahlter Manager öffnet das Tor ──')
  {
    // Der vierte Manager fällt aus der Gratis-Quote und kostet Sats.
    bare.plantagen.push({ ...bare.plantagen[0], id: 1, managerLevel: 1 })
    save()
    const elig = ticketEligibility('freeloader')
    check('ein bezahlter Manager gezählt', elig.paid === 1)
    check('berechtigt', elig.eligible === true)
    check('Kauf geht durch', buyTicket('freeloader').ok === true)
  }

  console.log('\n── Runden-Gratis-Manager zählen nicht als bezahlt ──')
  {
    // Ab Runde 2 kostet Outdoor nichts mehr — dann darf er auch nicht als
    // Beitrag zum Pot durchgehen, sonst öffnet ein Gratis-Klick das Tor.
    db.prepare('UPDATE players SET rounds_completed = 1 WHERE npub = ?').run('freeloader')
    const elig = ticketEligibility('freeloader')
    check('Outdoor ist rundenfrei, also unbezahlt', elig.paid === 0)
    check('damit nicht mehr berechtigt', elig.eligible === false)
    db.prepare('UPDATE players SET rounds_completed = 0 WHERE npub = ?').run('freeloader')
  }
}

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Ticketpreis-Checks bestanden\n')
process.exit(fail ? 1 : 0)
