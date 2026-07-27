#!/usr/bin/env node
/** Draw schedule checks: weekday, hour, DST boundaries, year rollover. */

import { nextDrawTime, DRAW_WEEKDAYS_BERLIN, DRAW_HOUR_BERLIN } from '../shared/schedule.js'

const berlin = ms => new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit',
  year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(ms))

const cases = [
  ['Mo 12:00',                    '2026-07-27T10:00:00Z'],
  ['Di 20:00 (vor Ziehung)',      '2026-07-28T18:00:00Z'],
  ['Di 21:30 (nach Ziehung)',     '2026-07-28T19:30:00Z'],
  ['Fr 14:00',                    '2026-07-31T12:00:00Z'],
  ['Sa 22:00 (nach Ziehung)',     '2026-08-01T20:00:00Z'],
  ['So 12:00',                    '2026-08-02T10:00:00Z'],
  ['Sa vor DST-Ende (CEST)',      '2026-10-24T12:00:00Z'],
  ['Mo nach DST-Ende (CET)',      '2026-10-26T12:00:00Z'],
  ['Sa vor DST-Start (CET)',      '2027-03-27T12:00:00Z'],
  ['Jahreswechsel',               '2026-12-30T23:00:00Z'],
]

let failures = 0
for (const [label, iso] of cases) {
  const nowMs = new Date(iso).getTime()
  const ts = nextDrawTime(nowMs)
  const ms = ts * 1000

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(ms))
  const wd = parts.find(p => p.type === 'weekday').value
  const hour = +parts.find(p => p.type === 'hour').value
  const wdNum = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd]

  const errs = []
  if (!DRAW_WEEKDAYS_BERLIN.includes(wdNum)) errs.push(`Wochentag ${wd}`)
  if (hour !== DRAW_HOUR_BERLIN) errs.push(`Stunde ${hour}`)
  if (ms <= nowMs) errs.push('liegt nicht in der Zukunft')
  if (ms - nowMs > 7 * 86400_000) errs.push('mehr als 7 Tage entfernt')

  const days = ((ms - nowMs) / 86400_000).toFixed(1)
  if (errs.length) { failures++; console.log(`  ✗ ${label.padEnd(26)} → ${berlin(ms)}  (${errs.join(', ')})`) }
  else console.log(`  ✓ ${label.padEnd(26)} → ${berlin(ms)}  (in ${days}d)`)
}

// A full year of consecutive draws must alternate 2/2/3 days and never repeat.
let cursor = new Date('2026-07-27T00:00:00Z').getTime()
const gaps = new Set()
for (let i = 0; i < 156; i++) {
  const next = nextDrawTime(cursor) * 1000
  if (next <= cursor) { console.log(`  ✗ Kette stagniert bei ${berlin(cursor)}`); failures++; break }
  if (i > 0) gaps.add(Math.round((next - cursor) / 86400_000))
  cursor = next
}
const gapSet = [...gaps].sort().join(',')
if (gapSet === '2,3') console.log(`  ✓ 156 Ziehungen in Folge, Abstände: ${gapSet} Tage`)
else { failures++; console.log(`  ✗ unerwartete Abstände: ${gapSet} Tage`) }

console.log(failures ? `\n${failures} Fehler\n` : '\nAlle Checks bestanden\n')
process.exit(failures ? 1 : 0)
