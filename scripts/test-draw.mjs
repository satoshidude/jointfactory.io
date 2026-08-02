#!/usr/bin/env node
/**
 * Draw checks: winner quota, fairness of the odds, how the pot splits by rank,
 * and what happens to a round nobody could lose.
 *
 *   node scripts/test-draw.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const dir = mkdtempSync(join(tmpdir(), 'jf-draw-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.JF_NOSTR_OFFLINE = '1'

const { db } = await import('../server/db.js')
const { runDraw } = await import('../server/lottery.js')
const { houseBalance } = await import('../server/house.js')
const { prizeShares, prizeAmounts, potPayout } = await import('../shared/economy.js')

async function scenario(label, players, pot) {
  db.prepare('DELETE FROM lottery_tickets').run()
  db.prepare('DELETE FROM lottery_rounds').run()
  db.prepare('DELETE FROM players').run()
  const r = db.prepare("INSERT INTO lottery_rounds (draws_at, status, total_sats_collected) VALUES (unixepoch()-1,'open',?)").run(pot)
  const rid = r.lastInsertRowid
  for (const [npub, tickets] of players) {
    db.prepare('INSERT INTO players (npub, display_name, sats) VALUES (?,?,0)').run(npub, npub)
    for (let i = 0; i < tickets; i++)
      db.prepare('INSERT INTO lottery_tickets (round_id, npub, joints_cost) VALUES (?,?,0)').run(rid, npub)
  }
  const res = await runDraw(rid)
  const total = players.reduce((s,[,t]) => s+t, 0)
  console.log(`\n  ${label}  (Pot brutto ${pot} → auszahlbar ${res.pot_sats})`)
  console.log(`    Teilnehmer: ${players.length}, Lose gesamt: ${total}`)
  for (const [npub, t] of players) {
    const w = res.winners.find(w => w.npub === npub)
    const share = (t/total*100).toFixed(1)
    console.log(`      ${npub.padEnd(10)} ${String(t).padStart(3)} Lose (${share.padStart(5)} %)  →  ${w ? String(w.payout_sats).padStart(5)+' sats  GEWINNER' : '    –  leer ausgegangen'}`)
  }
  console.log(`    Gewinner: ${res.winners.length} von ${players.length}`)
}

await scenario('Heutige Lage: 3 aktive Spieler', [['spieler_a',19],['spieler_b',19],['spieler_c',6]], 500)
await scenario('Wachstum: 10 Spieler', Array.from({length:10},(_,i)=>[`spieler_${i}`, 5+i]), 1000)

// Chancenverteilung über viele Ziehungen
console.log('\n  ── 3 Spieler (19/19/6 Lose), 3000 Ziehungen ──')
// With a floor of two winners the win *frequency* no longer equals the ticket
// share — two of three players are paid every round. What still has to track the
// tickets is who is drawn first, and what a player takes home on average.
const wins = { spieler_a:0, spieler_b:0, spieler_c:0 }
const firsts = { spieler_a:0, spieler_b:0, spieler_c:0 }
const paid = { spieler_a:0, spieler_b:0, spieler_c:0 }
let winnersPerDraw = new Set()
for (let i=0;i<3000;i++) {
  db.prepare('DELETE FROM lottery_tickets').run(); db.prepare('DELETE FROM lottery_rounds').run()
  const r = db.prepare("INSERT INTO lottery_rounds (draws_at, status, total_sats_collected) VALUES (unixepoch()-1,'open',1000)").run()
  for (const [n,t] of [['spieler_a',19],['spieler_b',19],['spieler_c',6]])
    for (let k=0;k<t;k++) db.prepare('INSERT INTO lottery_tickets (round_id, npub, joints_cost) VALUES (?,?,0)').run(r.lastInsertRowid, n)
  const res = await runDraw(r.lastInsertRowid)
  winnersPerDraw.add(res.winners.length)
  res.winners.forEach((w, rank) => {
    wins[w.npub]++
    paid[w.npub] += w.payout_sats
    if (rank === 0) firsts[w.npub]++
  })
}
const totalPaid = Object.values(paid).reduce((a,b)=>a+b,0)
console.log('    Spieler    Losanteil   Platz 1   im Geld   Anteil am Ausgezahlten')
for (const [n,t] of [['spieler_a',19],['spieler_b',19],['spieler_c',6]])
  console.log(`    ${n}   ${(t/44*100).toFixed(1).padStart(6)} %   ${(firsts[n]/3000*100).toFixed(1).padStart(5)} %   ${(wins[n]/3000*100).toFixed(1).padStart(5)} %   ${(paid[n]/totalPaid*100).toFixed(1).padStart(6)} %`)
rmSync(dir, { recursive: true, force: true })

const { winnerCount } = await import('../shared/economy.js')
let fail = 0
const check = (l, c) => { console.log(`  ${c ? '✓' : '✗'} ${l}`); if (!c) fail++ }
console.log('\n  ── Gewinnerquote ──')
check('1 Teilnehmer → 1 Gewinner', winnerCount(1) === 1)
check('2 Teilnehmer → 2 Gewinner (Untergrenze)', winnerCount(2) === 2)
check('3 Teilnehmer → 2 Gewinner, einer geht leer aus', winnerCount(3) === 2)
check('10 Teilnehmer → 4 Gewinner', winnerCount(10) === 4)
check('nie mehr Gewinner als Teilnehmer', [1,2,3,4,5].every(n => winnerCount(n) <= n))
check('30 Teilnehmer → 10 Gewinner', winnerCount(30) === 10)
check('100 Teilnehmer → gedeckelt bei 21', winnerCount(100) === 21)
check('0 Teilnehmer → 0 Gewinner', winnerCount(0) === 0)
check('immer genau so viele Gewinner wie vorgesehen',
      winnersPerDraw.size === 1 && winnersPerDraw.has(winnerCount(3)))
check('Platz 1 folgt dem Losanteil (±3 %)',
      [['spieler_a',19],['spieler_b',19],['spieler_c',6]]
        .every(([n,t]) => Math.abs(firsts[n]/3000 - t/44) < 0.03))
check('Auszahlung folgt dem Losanteil (±6 %)',
      [['spieler_a',19],['spieler_b',19],['spieler_c',6]]
        .every(([n,t]) => Math.abs(paid[n]/totalPaid - t/44) < 0.06))
// ── The pot splits by rank, not by ticket count ─────────────────────────────
// Two entrants used to make one winner who took everything; the other paid a
// full ticket for nothing.
console.log('\n  ── Staffelung nach Rang ──')
{
  db.prepare('DELETE FROM lottery_tickets').run()
  db.prepare('DELETE FROM lottery_rounds').run()
  db.prepare('DELETE FROM players').run()
  const r = db.prepare("INSERT INTO lottery_rounds (draws_at, status, total_sats_collected) VALUES (unixepoch()-1,'open',?)").run(902)
  for (const [npub, n] of [['a', 1], ['b', 2]]) {
    db.prepare('INSERT INTO players (npub, display_name, sats) VALUES (?,?,0)').run(npub, npub)
    for (let i = 0; i < n; i++)
      db.prepare('INSERT INTO lottery_tickets (round_id, npub, joints_cost) VALUES (?,?,0)').run(r.lastInsertRowid, npub)
  }
  const res = await runDraw(r.lastInsertRowid)
  const payouts = res.winners.map(w => w.payout_sats)
  const pool = potPayout(902)
  console.log(`    Pot 902 brutto → ${pool} auszahlbar → ${payouts.join(' / ')}`)
  check('zwei Gewinner bei zwei Teilnehmern', res.winners.length === 2)
  check('70/30 nach Rang', payouts[0] === prizeAmounts(pool, 2)[0] && payouts[1] === prizeAmounts(pool, 2)[1])
  check('Summe ist der Auszahlbetrag', payouts.reduce((a, b) => a + b, 0) === pool)
  check('niemand geht leer aus', payouts.every(p => p > 0))
  check('Reihenfolge ist die Ziehung, nicht die Losanzahl',
        prizeShares(2)[0] > prizeShares(2)[1])
  const credited = ['a', 'b'].map(n => db.prepare('SELECT sats FROM players WHERE npub=?').get(n).sats)
  check('gutgeschrieben wie ausgewiesen', credited.reduce((x, y) => x + y, 0) === pool)
}

// ── One entrant is not a draw ───────────────────────────────────────────────
console.log('\n  ── Nur ein Teilnehmer ──')
{
  db.prepare('DELETE FROM lottery_tickets').run()
  db.prepare('DELETE FROM lottery_rounds').run()
  db.prepare('DELETE FROM players').run()
  const houseBefore = houseBalance()
  const r = db.prepare("INSERT INTO lottery_rounds (draws_at, status, total_sats_collected) VALUES (unixepoch()-1,'open',?)").run(500)
  const rid = r.lastInsertRowid
  db.prepare('INSERT INTO players (npub, display_name, sats) VALUES (?,?,0)').run('solo', 'Solo')
  for (let i = 0; i < 2; i++)
    db.prepare('INSERT INTO lottery_tickets (round_id, npub, joints_cost) VALUES (?,?,0)').run(rid, 'solo')

  const res = await runDraw(rid)
  const next = db.prepare("SELECT id, total_sats_collected FROM lottery_rounds WHERE status='open' ORDER BY id DESC LIMIT 1").get()
  console.log(`    Pot 500 · 2 Lose eines Spielers → übertragen in Runde ${next.id}`)
  check('nicht gezogen', res.winners.length === 0 && res.carried === 500)
  check('Pot wandert mit', next.total_sats_collected === 500)
  check('Lose wandern mit',
        db.prepare('SELECT COUNT(*) n FROM lottery_tickets WHERE round_id=?').get(next.id).n === 2)
  check('nichts ans Haus', houseBalance() === houseBefore)
  check('kein Sat gutgeschrieben', db.prepare("SELECT sats FROM players WHERE npub='solo'").get().sats === 0)
  check('Runde geschlossen',
        db.prepare('SELECT status FROM lottery_rounds WHERE id=?').get(rid).status === 'closed')
}

// ── A round nobody entered ──────────────────────────────────────────────────
// The pot used to roll into the next round, which paid the operator's own sats
// forward forever; it is revenue now.
console.log('\n  ── Runde ohne Teilnehmer ──')
db.prepare('DELETE FROM lottery_tickets').run()
db.prepare('DELETE FROM lottery_rounds').run()
const houseBefore = houseBalance()
const empty = db.prepare("INSERT INTO lottery_rounds (draws_at, status, total_sats_collected) VALUES (unixepoch()-1,'open',?)").run(700)
const emptyRes = await runDraw(empty.lastInsertRowid)
const nextRound = db.prepare("SELECT total_sats_collected FROM lottery_rounds WHERE status='open' ORDER BY id DESC LIMIT 1").get()
console.log(`    Pot 700 → House ${houseBefore} → ${houseBalance()}, nächste Runde startet bei ${nextRound?.total_sats_collected ?? 0}`)
check('kein Gewinner', emptyRes.winners.length === 0)
check('Pot geht ans Haus', houseBalance() - houseBefore === 700)
check('kein Übertrag in die nächste Runde', (nextRound?.total_sats_collected ?? 0) === 0)
check('Runde ist geschlossen',
      db.prepare('SELECT status FROM lottery_rounds WHERE id=?').get(empty.lastInsertRowid).status === 'closed')

console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Ziehungs-Checks bestanden\n')
process.exit(fail ? 1 : 0)
