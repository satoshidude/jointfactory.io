#!/usr/bin/env node
/**
 * Season reset — the cut after which the retuned curves apply.
 *
 * Several changes were deliberately held back because they cannot land
 * mid-season without silently repricing live accounts:
 *
 *   upgMult 1.28 -> 1.12   rehydrate() writes the definitions onto every save,
 *                          so changing it reprices every existing plantation.
 *   speed 1000 -> 60 lvl   stored speedLevel values would be read on the new
 *                          scale; the highest live level would jump 1.08x -> 1.37x.
 *   joints -> 0            ticket prices scale with production rate, but the old
 *                          balances came from the old economy: the largest is
 *                          thirteen days of output banked, which no pricing can
 *                          make sensible.
 *
 * What survives: sats, deposits, withdrawal history, invite links, lifetime
 * totals — and therefore prestige seeds, which derive from all-time
 * total_joints_earned and so convert with no special case.
 *
 * DRY RUN BY DEFAULT. Pass --commit to write.
 *
 *   node scripts/season-reset.mjs --db data/jointfactory.db
 *   node scripts/season-reset.mjs --db data/jointfactory.db --commit
 */

const args = process.argv.slice(2)
const dbArg = args.indexOf('--db')
if (dbArg !== -1) process.env.DB_PATH = args[dbArg + 1]
const COMMIT = args.includes('--commit')

const { db } = await import('../server/db.js')
const {
  initialState, migrateSpeedLevel, prestigeSeeds, prestigeMultiplier, throughput,
} = await import('../shared/economy.js')

const fmt = n => n >= 1e15 ? (n / 1e15).toFixed(1) + 'Q' : n >= 1e12 ? (n / 1e12).toFixed(1) + 'T'
  : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n))

const SEASON_KEY = 'season'
const currentSeason = Number(db.prepare('SELECT value FROM kv_store WHERE key=?').get(SEASON_KEY)?.value ?? 0)

console.log(`\n═══ Season reset — ${COMMIT ? 'COMMIT' : 'DRY RUN'} ═══`)
console.log(`Season ${currentSeason} → ${currentSeason + 1}\n`)

const players = db.prepare(`
  SELECT npub, display_name, joints, sats, total_joints_earned, prestige_seeds, game_state,
         COALESCE(is_bot, 0) AS is_bot
  FROM players ORDER BY total_joints_earned DESC
`).all()

const plan = []
for (const p of players) {
  let gs = null
  try { gs = p.game_state ? JSON.parse(p.game_state) : null } catch { /* rebuilt below */ }

  const fresh = initialState()

  // Carry over what sats paid for, converted to the new speed scale.
  if (gs) {
    const c = migrateSpeedLevel(gs.courier?.speedLevel)
    fresh.courier.speedLevel = c.speedLevel
    fresh.courier.speed = c.speed
    fresh.courier.mgrLevel = gs.courier?.mgrLevel || 0
    const f = migrateSpeedLevel(gs.fabrik?.speedLevel)
    fresh.fabrik.speedLevel = f.speedLevel
    fresh.fabrik.speed = f.speed
    fresh.fabrik.mgrLevel = gs.fabrik?.mgrLevel || 0

    const p0 = migrateSpeedLevel(gs.plantagen?.[0]?.speedLevel)
    fresh.plantagen[0].speedLevel = p0.speedLevel
    fresh.plantagen[0].speed = p0.speed
    fresh.plantagen[0].managerLevel = gs.plantagen?.[0]?.managerLevel || 0

    // Higher plantations are locked again; park their sats-bought upgrades so
    // re-unlocking hands them back, exactly as a prestige harvest does.
    fresh._parkedSpeed = (gs.plantagen || []).slice(1).map(pl => {
      const m = migrateSpeedLevel(pl.speedLevel)
      return { id: pl.id, speedLevel: m.speedLevel, speed: m.speed, managerLevel: pl.managerLevel || 0 }
    })
  }

  const seeds = prestigeSeeds(p.total_joints_earned || 0)
  plan.push({
    npub: p.npub,
    name: p.display_name || p.npub.slice(0, 10),
    is_bot: p.is_bot,
    oldJoints: p.joints,
    lifetime: p.total_joints_earned || 0,
    oldSeeds: p.prestige_seeds || 0,
    seeds,
    sats: p.sats,
    gameState: fresh,
    rate: throughput(fresh, { seeds }).jointsPerSec,
  })
}

console.log('Spieler                Lifetime    Joints →   Seeds  Multiplikator   Startrate   Sats')
console.log('─'.repeat(88))
for (const r of plan.filter(r => !r.is_bot).slice(0, 12)) {
  console.log(
    `${r.name.slice(0, 20).padEnd(21)} ${fmt(r.lifetime).padStart(9)} ${fmt(r.oldJoints).padStart(9)} → 0 ` +
    `${String(r.seeds).padStart(6)}  ×${prestigeMultiplier(r.seeds).toFixed(2).padStart(6)}  ` +
    `${fmt(r.rate).padStart(9)}/s ${String(r.sats).padStart(6)}`
  )
}
const bots = plan.filter(r => r.is_bot).length
if (bots) console.log(`… plus ${bots} bot account(s), left untouched.`)

const satsBefore = plan.reduce((s, r) => s + r.sats, 0)
const seedsTotal = plan.reduce((s, r) => s + r.seeds, 0)
console.log('─'.repeat(88))
console.log(`Sats gesamt: ${satsBefore} (unverändert)   ·   Seeds vergeben: ${seedsTotal}`)

if (!COMMIT) {
  console.log('\nDRY RUN — nichts geschrieben. Mit --commit ausführen.\n')
  process.exit(0)
}

const apply = db.transaction(() => {
  for (const r of plan) {
    if (r.is_bot) continue // bots keep their state; they are not players
    db.prepare(`
      UPDATE players SET joints = 0, game_state = ?, prestige_seeds = ?, joints_per_sec = ?
      WHERE npub = ?
    `).run(JSON.stringify(r.gameState), r.seeds, r.rate, r.npub)
  }
  // The growth race would otherwise plot the old season's curve forever.
  db.prepare('DELETE FROM rate_log').run()
  db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(SEASON_KEY, String(currentSeason + 1))
})
apply()

console.log(`\n✓ Season ${currentSeason + 1} gestartet. ${plan.filter(r => !r.is_bot).length} Spieler zurückgesetzt, rate_log geleert.\n`)
