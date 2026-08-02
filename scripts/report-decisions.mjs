#!/usr/bin/env node
/**
 * What players actually do — read out of the event log, for balancing later.
 *
 * The daily rows in `daily_stats` answer "how much"; this answers "of what, by
 * whom, and where do people stop". Five questions, each one a lever:
 *
 *   1. Where do earned joints go?      levels · capacity · unlocks · speed · tickets
 *   2. What holds each chain back?     plantations · courier · factory
 *   3. Does the sats loop turn?        spent on boosts and managers vs. paid out
 *   4. Who comes back, and after how long?
 *   5. Where do new players stop?      signup → automated → first ticket → return
 *
 * Read-only. Runs against the live database or a snapshot:
 *
 *   node scripts/report-decisions.mjs            # last 30 days
 *   node scripts/report-decisions.mjs 90         # last 90 days
 *   DB_PATH=data/snapshot.db node scripts/report-decisions.mjs
 */

import 'dotenv/config'

const days = Math.max(1, Number(process.argv[2]) || 30)
const { db } = await import('../server/db.js')
const { throughput, countLotteryManagers, REQUIRED_MANAGERS } = await import('../shared/economy.js')

const since = Math.floor(Date.now() / 1000) - days * 86400
const ev = db.prepare('SELECT npub, type, amount, meta, ts FROM events WHERE ts >= ? ORDER BY ts').all(since)
  .map(r => { let m = {}; try { m = JSON.parse(r.meta || '{}') } catch { /* keep */ } return { ...r, m } })

const f = n => n >= 1e15 ? (n / 1e15).toFixed(2) + ' Q'
  : n >= 1e12 ? (n / 1e12).toFixed(1) + ' T'
  : n >= 1e9 ? (n / 1e9).toFixed(1) + ' B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + ' M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + ' K' : String(Math.round(n))
const span = s => s >= 86400 ? (s / 86400).toFixed(1) + ' d' : s >= 3600 ? (s / 3600).toFixed(1) + ' h' : Math.round(s / 60) + ' min'
const pct = (a, b) => b > 0 ? (a / b * 100).toFixed(0) + ' %' : '—'
const name = npub => db.prepare('SELECT display_name FROM players WHERE npub = ?').get(npub)?.display_name || npub?.slice(0, 8) || '—'
const sum = (type, field) => ev.filter(e => e.type === type).reduce((s, e) => s + (field ? (e.m[field] || 0) : e.amount), 0)
const count = type => ev.filter(e => e.type === type).length

console.log(`\n═══ Spielentscheidungen der letzten ${days} Tage ═══`)

// ── 1. Where the joints go ──────────────────────────────────────────────────
console.log('\n── Wofür Joints ausgegeben werden ──')
const sinks = [
  ['Plantagen-Level', sum('upgrade', 'level_cost'), sum('upgrade', 'levels') + ' Stufen'],
  ['Kurier/Fabrik-Kapazität', sum('upgrade', 'capacity_cost'), sum('upgrade', 'capacity') + ' Ausbauten'],
  ['neue Plantagen', sum('upgrade', 'unlock_cost'), sum('upgrade', 'unlocks') + ' freigeschaltet'],
  ['Speed (dauerhaft)', sum('speed'), count('speed') + ' Stufen'],
  ['Lose', sum('ticket'), count('ticket') + ' Lose'],
]
const joints = sinks.reduce((s, [, v]) => s + v, 0)
for (const [label, value, extra] of sinks.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${label.padEnd(26)} ${f(value).padStart(9)}  ${pct(value, joints).padStart(5)}   ${extra}`)
}
console.log(`  ${'zusammen'.padEnd(26)} ${f(joints).padStart(9)}`)
if (count('upgrade') === 0) {
  const first = db.prepare("SELECT MIN(ts) t FROM events WHERE type = 'upgrade'").get()?.t
  console.log(first
    ? `  (Level- und Kapazitätskäufe werden seit ${new Date(first * 1000).toISOString().slice(0, 10)} erfasst)`
    : '  (Level- und Kapazitätskäufe werden erst seit dem letzten Deploy erfasst — davor sah der Server nur das Ergebnis)')
}
if (joints > 0 && sum('ticket') / joints < 0.05) {
  console.log('  → Lose sind kaum eine Senke: der Wettbewerb um den Pot findet praktisch nicht statt.')
}

// ── 2. What limits each chain ───────────────────────────────────────────────
console.log('\n── Was die Ketten bremst ──')
const players = db.prepare('SELECT npub, display_name, game_state, speed_level, joints, last_seen_at FROM players WHERE COALESCE(is_bot,0) = 0').all()
const limits = { Plantagen: 0, Kurier: 0, Fabrik: 0, 'nicht automatisiert': 0 }
for (const p of players) {
  let t = null
  try { t = throughput(JSON.parse(p.game_state || '{}'), { speedLevel: p.speed_level || 0 }) } catch { /* keep */ }
  if (!t || t.jointsPerSec <= 0) { limits['nicht automatisiert']++; continue }
  if (t.jointsPerSec === t.plant) limits.Plantagen++
  else if (t.jointsPerSec === t.courier) limits.Kurier++
  else limits.Fabrik++
}
for (const [k, v] of Object.entries(limits)) console.log(`  ${k.padEnd(26)} ${String(v).padStart(3)}  ${pct(v, players.length)}`)
console.log('  → Wo alle hängen, ist eine Design-Antwort, keine Spielerentscheidung.')

// ── 3. Does the sats loop turn ──────────────────────────────────────────────
console.log('\n── Sats-Kreislauf ──')
const inSats = sum('deposit')
const spent = sum('boost') + sum('manager')
const paid = ev.filter(e => e.type === 'draw').reduce((s, e) => s + (e.m.paid || 0), 0)
const cut = ev.filter(e => e.type === 'draw').reduce((s, e) => s + (e.m.cut || 0), 0)
console.log(`  eingezahlt        ${String(inSats).padStart(7)}`)
console.log(`  ausgegeben        ${String(spent).padStart(7)}   Boosts ${sum('boost')} · Manager ${sum('manager')}`)
console.log(`  ausgezahlt        ${String(paid).padStart(7)}   an ${count('win')} Gewinner`)
console.log(`  Hausanteil        ${String(cut).padStart(7)}`)
console.log(`  abgehoben         ${String(sum('withdraw')).padStart(7)}`)
if (spent > 0) console.log(`  → jeder ausgegebene Sat kam ${(paid / spent).toFixed(2)}x als Gewinn zurück`)

// ── 4. Who comes back ───────────────────────────────────────────────────────
console.log('\n── Rückkehr ──')
const sessions = ev.filter(e => e.type === 'active')
const gaps = sessions.map(e => e.m.away_hours || 0).filter(h => h > 0).sort((a, b) => a - b)
const active = new Set(ev.filter(e => e.npub).map(e => e.npub))
console.log(`  Konten mit Aktivität      ${active.size} von ${players.length}`)
console.log(`  Sitzungen (Pause > 30 min) ${sessions.length}`)
if (gaps.length) {
  const med = gaps[Math.floor(gaps.length / 2)]
  console.log(`  Pause im Median            ${span(med * 3600)}  (kürzeste ${span(gaps[0] * 3600)}, längste ${span(gaps[gaps.length - 1] * 3600)})`)
}
const dormant = players.filter(p => p.last_seen_at < Math.floor(Date.now() / 1000) - 7 * 86400).length
console.log(`  seit über 7 Tagen still    ${dormant} von ${players.length}`)

// ── 5. Where new players stop ───────────────────────────────────────────────
console.log('\n── Trichter der Neuzugänge ──')
const signups = ev.filter(e => e.type === 'signup')
if (signups.length === 0) {
  console.log('  keine Neuanmeldungen im Zeitraum')
} else {
  const reached = { automatisiert: 0, 'erstes Los': 0, wiedergekommen: 0 }
  for (const s of signups) {
    const mine = ev.filter(e => e.npub === s.npub)
    const p = players.find(x => x.npub === s.npub)
    if (p && countLotteryManagers(p.game_state) >= REQUIRED_MANAGERS) reached.automatisiert++
    if (mine.some(e => e.type === 'ticket')) reached['erstes Los']++
    if (mine.some(e => e.type === 'active')) reached.wiedergekommen++
  }
  console.log(`  angemeldet                 ${signups.length}`)
  for (const [k, v] of Object.entries(reached)) console.log(`  ${k.padEnd(26)} ${String(v).padStart(3)}  ${pct(v, signups.length)}`)
}

// ── The guard, and who is on the edge ───────────────────────────────────────
console.log('\n── Speicher-Schranke ──')
console.log(`  Kappungen                  ${count('clamp')}  über ${f(sum('clamp'))} Joints`)
console.log(`  Erstattungen               ${count('restore')}  über ${f(sum('restore'))} Joints`)
if (count('clamp') > 0) {
  const perPlayer = {}
  for (const e of ev.filter(x => x.type === 'clamp' && x.npub)) perPlayer[e.npub] = (perPlayer[e.npub] || 0) + 1
  const worst = Object.entries(perPlayer).sort((a, b) => b[1] - a[1]).slice(0, 3)
  console.log('  am häufigsten betroffen:   ' + worst.map(([n, c]) => `${name(n)} (${c}x)`).join(', '))
  console.log('  → Wiederholte Kappungen bei denselben Konten heißen: die Schranke misst falsch, nicht der Spieler betrügt.')
}

// ── Per player, the shape of their spending ─────────────────────────────────
console.log('\n── Je Spieler ──')
console.log('  Spieler                 Level   Kapazität     Speed       Lose   Boosts   letzte Aktivität')
const byPlayer = {}
for (const e of ev.filter(x => x.npub)) {
  const b = byPlayer[e.npub] ??= { level: 0, cap: 0, speed: 0, ticket: 0, boost: 0, last: 0 }
  if (e.type === 'upgrade') { b.level += e.m.level_cost || 0; b.cap += e.m.capacity_cost || 0 }
  if (e.type === 'speed') b.speed += e.amount
  if (e.type === 'ticket') b.ticket += e.amount
  if (e.type === 'boost') b.boost += e.amount
  b.last = Math.max(b.last, e.ts)
}
for (const [npub, b] of Object.entries(byPlayer).sort((a, b2) => b2[1].last - a[1].last)) {
  const ago = span(Math.floor(Date.now() / 1000) - b.last)
  console.log('  ' + name(npub).slice(0, 22).padEnd(24) + f(b.level).padStart(7) + f(b.cap).padStart(12) +
    f(b.speed).padStart(10) + f(b.ticket).padStart(11) + String(b.boost).padStart(9) + '   vor ' + ago)
}
console.log()
