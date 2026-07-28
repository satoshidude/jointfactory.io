#!/usr/bin/env node
/**
 * Create the dedicated bot accounts the lottery activity runs on.
 *
 * The fake activity used to run on seven *real* players — Boyscout, gorilla,
 * Akki, Blazedale and others, none of whom had logged in for months. It spent
 * their joints and, when they won, credited them withdrawable sats.
 *
 * These accounts are flagged is_bot, so they are excluded from the leaderboard,
 * the growth race and the owner report, and their winnings go back into the pot
 * instead of into a balance.
 *
 * Idempotent — running it again leaves existing bots alone.
 *
 *   node scripts/seed-bots.mjs [--db path]
 */

import { createHash } from 'crypto'

const dbArg = process.argv.indexOf('--db')
if (dbArg !== -1) process.env.DB_PATH = process.argv[dbArg + 1]

const { db } = await import('../server/db.js')
const { initialState, newPlantation, PLANTATION_DEFS, throughput, DAY_SECONDS } = await import('../shared/economy.js')

// Plain names that read like players, not like a cast of characters.
const BOTS = [
  { name: 'greenthumb', plants: 2, level: 28, capacity: 4_000 },
  { name: 'hempire',    plants: 3, level: 34, capacity: 40_000 },
  { name: 'rollie',     plants: 2, level: 22, capacity: 2_500 },
  { name: 'terpene',    plants: 4, level: 30, capacity: 300_000 },
  { name: 'lowrider',   plants: 1, level: 40, capacity: 900 },
  { name: 'nugget',     plants: 3, level: 26, capacity: 25_000 },
]

/** Deterministic 64-hex id, so re-running produces the same accounts. */
const botId = name => createHash('sha256').update(`jointfactory-bot:${name}`).digest('hex')

function buildState({ plants, level, capacity }) {
  const gs = initialState()
  gs.plantagen[0].managerLevel = 1
  gs.plantagen[0].level = level
  for (let i = 1; i < plants; i++) {
    const p = newPlantation(PLANTATION_DEFS[i])
    p.managerLevel = 1
    p.level = Math.max(1, level - i * 6)
    gs.plantagen.push(p)
  }
  gs.courier.mgrLevel = 1
  gs.courier.capacity = capacity
  gs.fabrik.mgrLevel = 1
  gs.fabrik.capacity = capacity
  return gs
}

let created = 0, skipped = 0
for (const spec of BOTS) {
  const npub = botId(spec.name)
  const existing = db.prepare('SELECT npub, is_bot FROM players WHERE npub = ?').get(npub)
  if (existing) {
    // Make sure the flag is set even if the row predates it.
    db.prepare('UPDATE players SET is_bot = 1 WHERE npub = ?').run(npub)
    skipped++
    continue
  }
  const gs = buildState(spec)
  const rate = throughput(gs).jointsPerSec
  db.prepare(`
    INSERT INTO players (npub, display_name, sats, joints, total_joints_earned,
                         joints_per_sec, game_state, is_bot)
    VALUES (?, ?, 0, ?, ?, ?, ?, 1)
  `).run(npub, spec.name, Math.round(rate * DAY_SECONDS), Math.round(rate * DAY_SECONDS * 30), rate, JSON.stringify(gs))
  console.log(`  + ${spec.name.padEnd(12)} ${rate.toFixed(1).padStart(10)} joints/s`)
  created++
}

console.log(`\n${created} bot account(s) created, ${skipped} already present.`)
const total = db.prepare('SELECT COUNT(*) AS n FROM players WHERE is_bot = 1').get().n
console.log(`${total} bot account(s) in total.\n`)
