#!/usr/bin/env node
/**
 * Mark the accounts that predate rounds — the one thing the deploy has to do.
 *
 * The curve changed underneath them: production is a tenth of what it was, the
 * six plots were laid out around a billion, and a round now ends. A balance of
 * twenty quadrillion means nothing against that, and the chain that earned it
 * would produce a tenth of its old rate.
 *
 * Nothing is converted here. Each account is frozen (`switch_pending`) until its
 * owner confirms in the browser — see switchToRounds() in server/rounds.js.
 * There is no deadline: an account that never confirms stays exactly as it is.
 *
 * Bots are the exception. They cannot press a button, so they are reset onto the
 * new curve directly.
 *
 *   node scripts/migrate-rounds.mjs                 # dry run
 *   node scripts/migrate-rounds.mjs --apply         # mark players, reset bots
 *   node scripts/migrate-rounds.mjs --force <npub>  # switch one account by hand
 */

import 'dotenv/config'

const apply = process.argv.includes('--apply')
const forceIdx = process.argv.indexOf('--force')
const forceNpub = forceIdx >= 0 ? process.argv[forceIdx + 1] : null

const { db } = await import('../server/db.js')
const { initialState, ROUND_TARGET } = await import('../shared/economy.js')
const { switchToRounds } = await import('../server/rounds.js')

const fmt = n => n >= 1e15 ? (n / 1e15).toFixed(2) + ' Q' : n >= 1e12 ? (n / 1e12).toFixed(1) + ' T'
  : n >= 1e9 ? (n / 1e9).toFixed(2) + ' B' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' M'
  : Math.round(n).toLocaleString()

// ── One account, by hand ────────────────────────────────────────────────────
if (forceNpub) {
  const res = switchToRounds(forceNpub)
  console.log(res.ok
    ? `\n  ${forceNpub.slice(0, 12)}… umgestellt: ${res.rounds_credited} Runden, ${res.points_credited} Sterne, ${fmt(res.lifetime_joints)} übernommen\n`
    : `\n  nicht umgestellt: ${res.reason}\n`)
  process.exit(res.ok ? 0 : 1)
}

const players = db.prepare(`
  SELECT npub, display_name, total_joints_earned, sats, COALESCE(is_bot, 0) is_bot,
         COALESCE(switch_pending, 0) pending
  FROM players ORDER BY is_bot, total_joints_earned DESC
`).all()

const toMark = players.filter(p => !p.is_bot && !p.pending)
const bots = players.filter(p => p.is_bot)

console.log(`\n  ${players.length} Konten · Rundenziel ${fmt(ROUND_TARGET)}\n`)
console.log('  Spieler                    bisher erspielt     Sats   Weg')
for (const p of players) {
  const name = (p.display_name || p.npub.slice(0, 12)).slice(0, 24)
  const weg = p.is_bot ? 'Bot — direkt zurückgesetzt'
    : p.pending ? 'wartet bereits auf Bestätigung'
    : 'wird gesperrt, bis der Spieler bestätigt'
  console.log(`  ${name.padEnd(26)} ${fmt(p.total_joints_earned || 0).padStart(15)} ${String(p.sats).padStart(8)}   ${weg}`)
}

const mark = db.transaction(() => {
  db.prepare('UPDATE players SET switch_pending = 1 WHERE COALESCE(is_bot, 0) = 0').run()
  // Bots cannot confirm anything. They get the new curve and no credited rounds —
  // they exist to keep the lottery from looking empty, not to climb a board.
  for (const b of bots) {
    db.prepare(`
      UPDATE players SET game_state = ?, joints = 0, total_joints_earned = 0, joints_per_sec = 0,
                         speed_level = 0, switch_pending = 0, joints_rev = joints_rev + 1,
                         state_saved_at = unixepoch()
      WHERE npub = ?
    `).run(JSON.stringify(initialState()), b.npub)
    db.prepare('DELETE FROM rounds WHERE npub = ?').run(b.npub)
    db.prepare('INSERT INTO rounds (npub, round_no, started_at) VALUES (?, 1, unixepoch())').run(b.npub)
  }
})

if (apply) mark()

console.log(`\n  ${toMark.length} Konten ${apply ? 'gesperrt' : 'würden gesperrt'} · ${bots.length} Bots ${apply ? 'zurückgesetzt' : 'würden zurückgesetzt'}`)
console.log(apply
  ? '  Sats, Einzahlungen und Invite-Codes blieben unangetastet.\n'
  : '  Probelauf — mit --apply ausführen\n')
