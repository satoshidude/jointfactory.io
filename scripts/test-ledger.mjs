#!/usr/bin/env node
/**
 * Accounting — does every purchase move exactly what it should, and nothing else?
 *
 * Runs a full session against a throwaway database and reconciles the books:
 * joints in and out, sats in and out, the lottery pot, the house ledger.
 * Every path that fails must leave all four untouched.
 *
 *   node scripts/test-ledger.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-ledger-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.JF_NOSTR_OFFLINE = '1'

const { db } = await import('../server/db.js')
const { buyTicket, getTicketPrice, ticketsBoughtToday } = await import('../server/lottery.js')
const { buySpeed, speedStatus } = await import('../server/speed.js')
const { buyBoost } = await import('../server/boosts.js')
const { houseBalance } = await import('../server/house.js')
const {
  initialState, newPlantation, PLANTATION_DEFS, BOOSTS, MAX_TICKETS_PER_DAY, potPayout,
} = await import('../shared/economy.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const fmt = n => n >= 1e12 ? (n / 1e12).toFixed(1) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n))

const NPUB = 'ledger-probe'
const START_JOINTS = 5e12
const START_SATS = 500

function books() {
  const p = db.prepare('SELECT joints, sats, speed_level FROM players WHERE npub=?').get(NPUB)
  const round = db.prepare(`SELECT id, total_sats_collected FROM lottery_rounds WHERE status='open'`).get()
  return {
    joints: p.joints,
    sats: p.sats,
    speedLevel: p.speed_level,
    pot: round?.total_sats_collected ?? 0,
    house: houseBalance(),
    tickets: db.prepare('SELECT COUNT(*) n FROM lottery_tickets WHERE npub=?').get(NPUB).n,
    ticketSpend: db.prepare('SELECT COALESCE(SUM(joints_cost),0) s FROM lottery_tickets WHERE npub=?').get(NPUB).s,
  }
}

// A mid-game player: chain automated, three plantations.
{
  const gs = initialState()
  gs.plantagen[0].managerLevel = 1
  gs.plantagen[0].level = 40
  for (let i = 1; i < 3; i++) {
    const p = newPlantation(PLANTATION_DEFS[i]); p.managerLevel = 1; p.level = 30
    gs.plantagen.push(p)
  }
  gs.courier.mgrLevel = 1; gs.courier.capacity = 5e5
  gs.fabrik.mgrLevel = 1;  gs.fabrik.capacity = 5e5
  db.prepare('INSERT INTO players (npub, display_name, sats, joints, game_state) VALUES (?,?,?,?,?)')
    .run(NPUB, 'Ledger', START_SATS, START_JOINTS, JSON.stringify(gs))
  // db.js opens a round on import; reuse it rather than adding a second.
  db.prepare(`UPDATE lottery_rounds SET draws_at = unixepoch() + 3600 WHERE status='open'`).run()
}

const opening = books()
console.log(`\n  Start: ${fmt(opening.joints)} Joints · ${opening.sats} Sats · Pot ${opening.pot} · Ledger ${opening.house}`)

// ── Joints → tickets ────────────────────────────────────────────────────────
console.log('\n── Joints → Lose ──')
let ticketSpend = 0
const ticketPrices = []
for (let i = 0; i < MAX_TICKETS_PER_DAY; i++) {
  const quoted = getTicketPrice(NPUB)
  const before = books()
  const res = buyTicket(NPUB)
  const after = books()
  ticketPrices.push(quoted)
  ticketSpend += quoted
  if (!res.ok || before.joints - after.joints !== quoted) {
    check(`Los ${i + 1}: ${fmt(quoted)} abgebucht`, false)
  }
  if (after.sats !== before.sats || after.pot !== before.pot) {
    check(`Los ${i + 1}: rührt Sats und Pot nicht an`, false)
  }
}
console.log(`  Preise: ${ticketPrices.map(fmt).join(' · ')}`)
const afterTickets = books()
check(`${MAX_TICKETS_PER_DAY} Lose gebucht`, afterTickets.tickets === MAX_TICKETS_PER_DAY)
check(`Joints exakt um die Summe gesunken (${fmt(ticketSpend)})`,
      opening.joints - afterTickets.joints === ticketSpend)
check('gespeicherte Ticketkosten stimmen mit dem Abzug überein',
      afterTickets.ticketSpend === ticketSpend)
check('Sats unberührt', afterTickets.sats === opening.sats)
check('Pot unberührt — Lose kosten Joints, nicht Sats', afterTickets.pot === opening.pot)
check('Tageszähler steht auf dem Limit', ticketsBoughtToday(NPUB) === MAX_TICKETS_PER_DAY)

// Over the limit: nothing may move.
{
  const before = books()
  const res = buyTicket(NPUB)
  const after = books()
  check(`über dem Limit abgelehnt: "${res.reason}"`, !res.ok)
  check('nach Ablehnung ist nichts gebucht',
        after.joints === before.joints && after.tickets === before.tickets)
}

// ── Joints → speed ──────────────────────────────────────────────────────────
console.log('\n── Joints → Speed-Stufen ──')
let speedSpend = 0
const speedPrices = []
for (let i = 0; i < 5; i++) {
  const quoted = speedStatus(NPUB).next_cost
  const before = books()
  const res = buySpeed(NPUB)
  const after = books()
  speedPrices.push(quoted)
  speedSpend += quoted
  if (!res.ok || before.joints - after.joints !== quoted) {
    check(`Stufe ${i + 1}: ${fmt(quoted)} abgebucht`, false)
  }
  if (after.speedLevel !== before.speedLevel + 1) check(`Stufe ${i + 1}: Zähler erhöht`, false)
  if (after.sats !== before.sats || after.pot !== before.pot) {
    check(`Stufe ${i + 1}: rührt Sats und Pot nicht an`, false)
  }
}
console.log(`  Preise: ${speedPrices.map(fmt).join(' · ')}`)
const afterSpeed = books()
check('5 Stufen gebucht', afterSpeed.speedLevel === 5)
check(`Joints exakt um die Summe gesunken (${fmt(speedSpend)})`,
      afterTickets.joints - afterSpeed.joints === speedSpend)
check('Preis steigt mit jeder Stufe', speedPrices.every((p, i) => i === 0 || p > speedPrices[i - 1]))
check('Sats und Pot unberührt', afterSpeed.sats === opening.sats && afterSpeed.pot === opening.pot)

// ── Sats → boosts ───────────────────────────────────────────────────────────
console.log('\n── Sats → Boosts ──')
let boostSpend = 0
for (const type of ['fertilizer', 'express', 'doubleshift']) {
  const before = books()
  const res = buyBoost(NPUB, type)
  const after = books()
  boostSpend += BOOSTS[type].cost
  if (!res.ok || before.sats - after.sats !== BOOSTS[type].cost) check(`${type}: Sats abgebucht`, false)
  if (after.pot - before.pot !== BOOSTS[type].cost) check(`${type}: brutto in den Pot`, false)
  if (after.joints !== before.joints) check(`${type}: rührt Joints nicht an`, false)
}
const afterBoosts = books()
check(`3 Boosts, ${boostSpend} Sats abgebucht`, opening.sats - afterBoosts.sats === boostSpend)
check('Pot exakt um den Bruttobetrag gestiegen', afterBoosts.pot - opening.pot === boostSpend)
check('Joints unberührt', afterBoosts.joints === afterSpeed.joints)

// Insufficient sats: nothing moves.
{
  db.prepare('UPDATE players SET sats = 5 WHERE npub = ?').run(NPUB)
  const before = books()
  const res = buyBoost(NPUB, 'fullthrottle')
  const after = books()
  check(`ohne Deckung abgelehnt: "${res.reason}"`, !res.ok)
  check('nach Ablehnung ist nichts gebucht',
        after.sats === before.sats && after.pot === before.pot)
}

// ── Closing reconciliation ──────────────────────────────────────────────────
console.log('\n── Schlussabgleich ──')
const closing = books()
console.log(`  Joints: ${fmt(opening.joints)} − ${fmt(ticketSpend)} (Lose) − ${fmt(speedSpend)} (Speed) = ${fmt(closing.joints)}`)
check('Joint-Bilanz geht auf',
      opening.joints - ticketSpend - speedSpend === closing.joints)
console.log(`  Sats:   ${opening.sats} − ${boostSpend} (Boosts) = ${opening.sats - boostSpend}`)
check('Sats-Bilanz geht auf (vor dem Testeingriff)',
      opening.sats - boostSpend === afterBoosts.sats)
check('Pot enthält genau die Boost-Ausgaben', closing.pot === opening.pot + boostSpend)
console.log(`  Pot ${closing.pot} brutto → ${potPayout(closing.pot)} auszahlbar, ${closing.pot - potPayout(closing.pot)} Hausanteil`)
check('Auszahlung + Hausanteil ergibt den Bruttopot',
      potPayout(closing.pot) + (closing.pot - potPayout(closing.pot)) === closing.pot)
check('Ledger noch unberührt — er füllt sich erst bei der Ziehung',
      closing.house === opening.house)

// ── The draw: gross pot splits into payouts and the house cut ───────────────
console.log('\n── Ziehung ──')
{
  const { runDraw } = await import('../server/lottery.js')
  const round = db.prepare(`SELECT id, total_sats_collected FROM lottery_rounds WHERE status='open'`).get()
  // A second entrant, so the winner quota has something to choose from.
  db.prepare('INSERT INTO players (npub, display_name, sats, joints) VALUES (?,?,?,?)')
    .run('rival', 'Rival', 0, 0)
  db.prepare('INSERT INTO lottery_tickets (round_id, npub, joints_cost) VALUES (?,?,0)').run(round.id, 'rival')

  const gross = round.total_sats_collected
  const satsBefore = db.prepare('SELECT COALESCE(SUM(sats),0) s FROM players').get().s
  const houseBefore = houseBalance()

  const res = await runDraw(round.id)

  const satsAfter = db.prepare('SELECT COALESCE(SUM(sats),0) s FROM players').get().s
  const houseAfter = houseBalance()
  const paid = satsAfter - satsBefore
  const cut = houseAfter - houseBefore

  console.log(`  Bruttopot ${gross} → ${paid} an ${res.winners.length} Gewinner · ${cut} in den Ledger`)
  check('Auszahlung entspricht dem 80-%-Anteil', paid === potPayout(gross))
  check('Hausanteil ist der Rest', cut === gross - potPayout(gross))
  check('Auszahlung + Hausanteil = Bruttopot', paid + cut === gross)
  check('Gewinnerquote greift', res.winners.length === 1)

  const next = db.prepare(`SELECT total_sats_collected p FROM lottery_rounds WHERE status='open'`).get()
  check('Folgerunde startet bei 0 (nichts zu übertragen)', next.p === 0)
}

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Buchungs-Checks bestanden\n')
process.exit(fail ? 1 : 0)
