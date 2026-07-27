#!/usr/bin/env node
/**
 * Draw checks: winner quota and fairness of the odds.
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
const wins = { spieler_a:0, spieler_b:0, spieler_c:0 }
for (let i=0;i<3000;i++) {
  db.prepare('DELETE FROM lottery_tickets').run(); db.prepare('DELETE FROM lottery_rounds').run()
  const r = db.prepare("INSERT INTO lottery_rounds (draws_at, status, total_sats_collected) VALUES (unixepoch()-1,'open',100)").run()
  for (const [n,t] of [['spieler_a',19],['spieler_b',19],['spieler_c',6]])
    for (let k=0;k<t;k++) db.prepare('INSERT INTO lottery_tickets (round_id, npub, joints_cost) VALUES (?,?,0)').run(r.lastInsertRowid, n)
  const res = await runDraw(r.lastInsertRowid)
  for (const w of res.winners) wins[w.npub]++
}
for (const [n,t] of [['spieler_a',19],['spieler_b',19],['spieler_c',6]])
  console.log(`    ${n}: ${(wins[n]/3000*100).toFixed(1)} % gewonnen  (Losanteil ${(t/44*100).toFixed(1)} %)`)
rmSync(dir, { recursive: true, force: true })

const { winnerCount } = await import('../shared/economy.js')
let fail = 0
const check = (l, c) => { console.log(`  ${c ? '✓' : '✗'} ${l}`); if (!c) fail++ }
console.log('\n  ── Gewinnerquote ──')
check('1 Teilnehmer → 1 Gewinner', winnerCount(1) === 1)
check('3 Teilnehmer → 1 Gewinner (vorher: alle 3)', winnerCount(3) === 1)
check('10 Teilnehmer → 4 Gewinner', winnerCount(10) === 4)
check('30 Teilnehmer → 10 Gewinner', winnerCount(30) === 10)
check('100 Teilnehmer → gedeckelt bei 21', winnerCount(100) === 21)
check('0 Teilnehmer → 0 Gewinner', winnerCount(0) === 0)
check('Gewinnfrequenz entspricht dem Losanteil (±3 %)',
      Math.abs(wins.spieler_a/3000 - 19/44) < 0.03 &&
      Math.abs(wins.spieler_c/3000 - 6/44) < 0.03)
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Ziehungs-Checks bestanden\n')
process.exit(fail ? 1 : 0)
