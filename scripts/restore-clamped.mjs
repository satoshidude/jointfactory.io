#!/usr/bin/env node
/**
 * Give back joints the save guard took by mistake.
 *
 * The ceiling measured its window from `last_seen_at`, and signing in sets that
 * column to now — so the first save after a login reported the whole offline
 * catch-up against a window of seconds and had it clamped away. Six accounts
 * lost 21.6 quadrillion joints between them, all of it production they had
 * really earned while away. The bug is fixed (state_saved_at); this returns what
 * it took.
 *
 * Only clamps above the threshold are considered — the small repeated ones come
 * from a client running slightly ahead of the server, which is what the guard is
 * for. Each restoration writes a `restore` event carrying the clamp it answers,
 * so running this twice pays nobody twice.
 *
 *   node scripts/restore-clamped.mjs            # dry run
 *   node scripts/restore-clamped.mjs --apply
 */

import 'dotenv/config'

const apply = process.argv.includes('--apply')
const THRESHOLD = 1e12

const { db, logEvent } = await import('../server/db.js')

const fmt = n => n >= 1e15 ? (n / 1e15).toFixed(2) + ' Q'
  : n >= 1e12 ? (n / 1e12).toFixed(1) + ' T'
  : n >= 1e9 ? (n / 1e9).toFixed(1) + ' B' : String(Math.round(n))

const clamps = db.prepare(`
  SELECT id, npub, amount, ts FROM events
  WHERE type = 'clamp' AND amount > ? AND npub IS NOT NULL
  ORDER BY ts
`).all(THRESHOLD)

const alreadyDone = new Set(
  db.prepare("SELECT meta FROM events WHERE type = 'restore'").all()
    .map(r => { try { return JSON.parse(r.meta || '{}').clamp_id } catch { return null } })
    .filter(Boolean)
)

console.log(`\n  ${clamps.length} Kappung(en) über ${fmt(THRESHOLD)}, davon ${alreadyDone.size} bereits erstattet\n`)

let total = 0
const restore = db.transaction((npub, amount, clampId) => {
  // The revision has to move with the balance. A client that is still open holds
  // the clamped figure, and without a bump its next save posts that lower number
  // with a matching revision — which the server accepts, wiping the restoration
  // seconds after it was made. Bumping it makes the next save stale, so the
  // server keeps the restored figure and the client adopts it.
  db.prepare('UPDATE players SET joints = joints + ?, joints_rev = joints_rev + 1 WHERE npub = ?')
    .run(amount, npub)
  logEvent(npub, 'restore', amount, { clamp_id: clampId, reason: 'clamped offline catch-up' })
})

for (const c of clamps) {
  const name = db.prepare('SELECT display_name FROM players WHERE npub = ?').get(c.npub)?.display_name || '?'
  if (alreadyDone.has(c.id)) {
    console.log(`  ${name.padEnd(26)} ${fmt(c.amount).padStart(10)}  bereits erstattet`)
    continue
  }
  const before = db.prepare('SELECT joints FROM players WHERE npub = ?').get(c.npub)?.joints ?? 0
  if (apply) restore(c.npub, c.amount, c.id)
  const after = db.prepare('SELECT joints FROM players WHERE npub = ?').get(c.npub)?.joints ?? 0
  total += c.amount
  console.log(`  ${name.padEnd(26)} ${fmt(c.amount).padStart(10)}  ${fmt(before)} → ${fmt(after)}${apply ? '' : '  (Probelauf)'}`)
}

console.log(`\n  Summe: ${fmt(total)}${apply ? ' erstattet' : ' — mit --apply ausführen'}\n`)
