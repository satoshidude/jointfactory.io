#!/usr/bin/env node
/**
 * Backfill the event log from the tables that already carry timestamps.
 *
 * The event log starts empty, so without this every day before it went live
 * reads as zero — and four months of tickets, deposits and draws are sitting
 * right there in the database. Signups, tickets, deposits, withdrawals and draws
 * can be reconstructed exactly. Boosts, speed steps and manager hires cannot:
 * only their current state was ever stored, which is the gap the log exists to
 * close going forward.
 *
 * Idempotent: rows written here carry meta.backfill and are deleted before a
 * re-run, so it can be run again after new history appears.
 *
 *   node scripts/backfill-events.mjs            # against DB_PATH from .env
 *   DB_PATH=data/copy.db node scripts/backfill-events.mjs
 */

import 'dotenv/config'

const { db, logEvent } = await import('../server/db.js')
const { rollupDay } = await import('../server/metrics.js')
const { berlinFields } = await import('../shared/schedule.js')

const insert = db.prepare('INSERT INTO events (ts, npub, type, amount, meta) VALUES (?, ?, ?, ?, ?)')
const add = (ts, npub, type, amount, meta = {}) =>
  insert.run(ts, npub, type, Math.round(amount || 0), JSON.stringify({ ...meta, backfill: true }))

const removed = db.prepare("DELETE FROM events WHERE meta LIKE '%\"backfill\":true%'").run()
if (removed.changes) console.log(`  ${removed.changes} frühere Backfill-Zeilen entfernt`)

const counts = {}
const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n }

db.transaction(() => {
  // Signups — players.created_at, referral link from referred_by.
  for (const p of db.prepare('SELECT npub, created_at, referred_by FROM players').all()) {
    add(p.created_at, p.npub, 'signup', 0, { referred: !!p.referred_by })
    bump('signup')
    if (p.referred_by) { add(p.created_at, p.referred_by, 'invite_signup', 0, { buddy: p.npub }); bump('invite_signup') }
  }

  // Tickets — the joints sink with a full history.
  for (const t of db.prepare('SELECT npub, joints_cost, purchased_at, round_id FROM lottery_tickets').all()) {
    add(t.purchased_at, t.npub, 'ticket', t.joints_cost, { round: t.round_id })
    bump('ticket')
  }

  // Deposits and withdrawals.
  for (const d of db.prepare("SELECT npub, amount_sats, paid_at, pack_id FROM lightning_payments WHERE status = 'paid' AND paid_at IS NOT NULL").all()) {
    add(d.paid_at, d.npub, 'deposit', d.amount_sats, { pack: d.pack_id || null }); bump('deposit')
  }
  for (const w of db.prepare('SELECT npub, amount_sats, created_at FROM withdrawals').all()) {
    add(w.created_at, w.npub, 'withdraw', w.amount_sats, {}); bump('withdraw')
  }

  // Draws. Gross pot before the cut was applied differently in the old code, so
  // the stored figure is taken at face value rather than recomputed.
  for (const r of db.prepare(`SELECT id, total_sats_collected, winner_npub, winner_payout_sats, winner_paid_at, draws_at
                              FROM lottery_rounds WHERE status = 'closed'`).all()) {
    const ts = r.winner_paid_at || r.draws_at
    let payouts = {}
    try { payouts = JSON.parse(r.winner_payout_sats || '{}') } catch { /* pre-JSON rows */ }
    const winners = r.winner_npub ? r.winner_npub.split(',').filter(Boolean) : []
    const paid = Object.values(payouts).reduce((s, n) => s + (Number(n) || 0), 0)
    add(ts, null, 'draw', r.total_sats_collected || 0, {
      round: r.id, winners: winners.length, paid, cut: Math.max(0, (r.total_sats_collected || 0) - paid),
    })
    bump('draw')
    for (const npub of winners) { add(ts, npub, 'win', Number(payouts[npub]) || 0, { round: r.id }); bump('win') }
  }
})()

console.log('  Ereignisse angelegt:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '))

// Roll every day that now has events.
const isoDay = ts => {
  const f = berlinFields(ts * 1000)
  return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`
}
const days = [...new Set(db.prepare('SELECT ts FROM events').all().map(r => isoDay(r.ts)))].sort()
for (const day of days) rollupDay(day)
console.log(`  ${days.length} Tage ausgewertet: ${days[0]} … ${days[days.length - 1]}`)

// A short read-out, so the shape of the data is visible right away.
const { recentStats } = await import('../server/metrics.js')
const recent = recentStats(10).reverse()
const fmt = n => n >= 1e12 ? (n / 1e12).toFixed(1) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : String(n)
console.log('\n  Tag         aktiv  neu  Lose  Joints/Lose  Deposits  Pot  ausgezahlt')
for (const d of recent) {
  console.log(`  ${d.day}  ${String(d.active).padStart(5)}  ${String(d.new).padStart(3)}  ${String(d.tickets).padStart(4)}  ${fmt(d.ticket_spend).padStart(11)}  ${String(d.deposits).padStart(8)}  ${String(d.pot_gross).padStart(3)}  ${String(d.paid_out).padStart(9)}`)
}
console.log()
