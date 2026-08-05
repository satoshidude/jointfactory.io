#!/usr/bin/env node
/**
 * Rounds, resets and prestige.
 *
 * The reset is the one operation in the game that deliberately destroys a
 * player's progress, so what it must *not* touch matters more than what it does:
 * sats are real money and managers were bought with them. It also has to survive
 * the client that is still running — the open tab holds the old balance and will
 * post it seconds later.
 *
 *   node scripts/test-rounds.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-rounds-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.JF_NOSTR_OFFLINE = '1'

const { db } = await import('../server/db.js')
const { saveState } = await import('../server/game.js')
const { resetRound, roundStatus, roundLeaderboards, currentRound } = await import('../server/rounds.js')
const { initialState, newPlantation, PLANTATION_DEFS, prestigePoints, ROUND_TARGET,
        managerSpend, managerCost } = await import('../shared/economy.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const fmt = n => n >= 1e12 ? (n / 1e12).toFixed(1) + ' T' : n >= 1e9 ? (n / 1e9).toFixed(2) + ' B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : Math.round(n).toLocaleString()
const now = () => Math.floor(Date.now() / 1000)
const row = npub => db.prepare('SELECT * FROM players WHERE npub = ?').get(npub)

/** A finished chain: every plot open, every station automated. */
function finishedChain() {
  const gs = initialState()
  gs.plantagen = PLANTATION_DEFS.map((def, i) => {
    const p = newPlantation(def, [37, 35, 37, 40, 42, 45][i])
    p.managerLevel = 1
    return p
  })
  // Wide enough that the plantations are the limit, as they are at the end of a
  // real round — the chain then runs at about 22 B/s.
  gs.courier.mgrLevel = 1; gs.courier.capacity = 2e11
  gs.fabrik.mgrLevel = 1;  gs.fabrik.capacity = 2e11
  return gs
}

function seed(npub, { joints, total, sats = 500, gs = finishedChain(), createdAgo = 6 * 86400 }) {
  db.prepare('DELETE FROM players WHERE npub = ?').run(npub)
  db.prepare('DELETE FROM rounds WHERE npub = ?').run(npub)
  db.prepare(`INSERT INTO players (npub, display_name, sats, joints, game_state, total_joints_earned,
                                   speed_level, created_at, last_seen_at, state_saved_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(npub, npub, sats, joints, JSON.stringify(gs), total, 12,
         now() - createdAgo, now() - 30, now() - 30)
}

console.log('\n═══ Runden, Reset und Prestige ═══')

// ── Points ──────────────────────────────────────────────────────────────────
console.log('\n── Prestige-Punkte ──')
console.log(`  Ziel ${fmt(ROUND_TARGET)}`)
// One star per finished round, and only one: counting stops at the target, so
// there is nothing past it to pay for.
for (const [earned, want] of [[ROUND_TARGET - 1, 0], [ROUND_TARGET, 1],
                              [2 * ROUND_TARGET, 1], [8 * ROUND_TARGET, 1]]) {
  const got = prestigePoints(earned)
  console.log(`  ${fmt(earned).padStart(12)} → ${got} Punkte`)
  if (got !== want) { fail++; console.log(`    ✗ erwartet ${want}`) }
}
check('unter dem Ziel keine Punkte', prestigePoints(ROUND_TARGET - 1) === 0)
check('genau ein Stern je Runde', prestigePoints(ROUND_TARGET) === 1 &&
      prestigePoints(1000 * ROUND_TARGET) === 1)

// ── The target is reached on the save path, not on request ──────────────────
console.log('\n── Ziel wird beim Speichern erkannt ──')
{
  seed('runner', { joints: 5_000, total: 5_000 })
  const gs = finishedChain()
  const rev = () => row('runner').joints_rev

  saveState('runner', { gameState: gs, joints: 5_000, total_joints_earned: 5_000, joints_per_sec: 0, joints_rev: rev() })
  check('vor dem Ziel keine Zeit', currentRound('runner').reached_target_at === null)
  check('Reset abgelehnt', resetRound('runner').reason === 'target_not_reached')

  // Five days of production: enough time for the guard to believe a billion, and
  // the round's own clock, which is what ends up in the Billionaires Club.
  db.prepare('UPDATE rounds SET started_at = ? WHERE npub = ? AND ended_at IS NULL').run(now() - 5 * 86400, 'runner')
  db.prepare('UPDATE players SET state_saved_at = ? WHERE npub = ?').run(now() - 5 * 86400, 'runner')
  saveState('runner', { gameState: gs, joints: 5_000, total_joints_earned: ROUND_TARGET + 5,
                        joints_per_sec: 0, joints_rev: rev() })
  const r = currentRound('runner')
  console.log(`  Ziel gefallen nach ${(r.seconds_to_target / 86400).toFixed(1)} Tagen · MegaFarm nach ${(r.megafarm_at / 86400).toFixed(1)} d`)
  check('Zeit festgehalten', r.reached_target_at > 0 && r.seconds_to_target >= 5 * 86400 - 5)
  check('MegaFarm-Zeitpunkt festgehalten', r.megafarm_at > 0)
  check('Ereignis geschrieben',
        db.prepare("SELECT COUNT(*) c FROM events WHERE npub='runner' AND type='round_target'").get().c === 1)

  // A second save must not move a record that is already set.
  const before = r.seconds_to_target
  db.prepare('UPDATE players SET state_saved_at = ? WHERE npub = ?').run(now() - 30, 'runner')
  saveState('runner', { gameState: gs, joints: 5_000, total_joints_earned: ROUND_TARGET * 3,
                        joints_per_sec: 0, joints_rev: rev() })
  check('Zeit bleibt stehen', currentRound('runner').seconds_to_target === before)
}

// ── The reset ───────────────────────────────────────────────────────────────
console.log('\n── Reset ──')
{
  const earned = ROUND_TARGET
  seed('resetter', { joints: 900_000_000, total: 100, sats: 1234 })
  db.prepare('UPDATE rounds SET started_at = ? WHERE npub = ?').run(now() - 7 * 86400, 'resetter')
  db.prepare("INSERT INTO events (npub, type, amount, ts) VALUES ('resetter','boost',50,unixepoch()-3600)").run()
  // Earned through the save path, so the round carries a real time — the ceiling
  // on the lifetime counter means it cannot simply be asserted.
  db.prepare('UPDATE players SET state_saved_at = ? WHERE npub = ?').run(now() - 7 * 86400, 'resetter')
  saveState('resetter', { gameState: finishedChain(), joints: 900_000_000, total_joints_earned: earned,
                          joints_per_sec: 0, joints_rev: row('resetter').joints_rev })
  check('Lebenssumme angekommen', row('resetter').total_joints_earned === earned)
  const revBefore = row('resetter').joints_rev

  const res = resetRound('resetter')
  const after = row('resetter')
  const gs = JSON.parse(after.game_state)
  console.log(`  Runde ${res.round} geschlossen · ${fmt(earned)} → ${res.points_awarded} Punkte`)

  check('Reset angenommen', res.ok === true)
  check('Punkte nach Formel', res.points_awarded === prestigePoints(earned))
  check('Guthaben auf null', after.joints === 0 && after.total_joints_earned === 0)
  check('Speed zurückgesetzt', after.speed_level === 0)
  check('Sats unangetastet', after.sats === 1234)
  check('Lebenszeit-Summe fortgeschrieben', after.lifetime_joints === earned)
  check('Rundenzähler erhöht', after.rounds_completed === 1)
  check('Kette wieder am Anfang', gs.plantagen.length === 1 && gs.plantagen[0].level === initialState().plantagen[0].level)
  // Managers are hired again next round, at next round's price — they are the
  // recurring sats sink, and keeping them would make round two free.
  check('Manager sind weg', gs.plantagen[0].managerLevel === 0 && gs.courier.mgrLevel === 0 && gs.fabrik.mgrLevel === 0)
  // Without the bump the still-open client posts the old balance with a matching
  // revision seconds later and the reset is silently undone.
  check('Revision erhöht', after.joints_rev === revBefore + 1)

  const closed = db.prepare("SELECT * FROM rounds WHERE npub='resetter' AND round_no=1").get()
  check('Runde ist geschlossen', closed.ended_at > 0 && closed.joints_earned === earned)
  check('Boost-Sats der Runde vermerkt', closed.boost_sats === 50)
  check('nächste Runde offen',
        currentRound('resetter').round_no === 2 && currentRound('resetter').ended_at === null)
  check('nur eine offene Runde',
        db.prepare("SELECT COUNT(*) c FROM rounds WHERE npub='resetter' AND ended_at IS NULL").get().c === 1)
}

// ── The open client cannot undo it ──────────────────────────────────────────
console.log('\n── Der offene Client hebt den Reset nicht auf ──')
{
  const stale = row('resetter').joints_rev - 1
  saveState('resetter', { gameState: finishedChain(), joints: 900_000_000,
                          total_joints_earned: ROUND_TARGET, joints_per_sec: 0, joints_rev: stale })
  const after = row('resetter')
  const chain = JSON.parse(after.game_state)
  console.log(`  alter Stand mit veralteter Revision gemeldet → Guthaben ${fmt(after.joints)}, ${chain.plantagen.length} Plantage(n)`)
  check('Guthaben bleibt bei null', after.joints === 0)
  // The balance was protected from the start; the chain was not, and the open
  // tab wrote its finished six-plot factory straight over the fresh one.
  check('die frische Kette bleibt stehen', chain.plantagen.length === 1)
  check('Lebenssumme bleibt bei null', after.total_joints_earned === 0)
}

// ── A second round, and the boards ──────────────────────────────────────────
console.log('\n── Zweite Runde und Ranglisten ──')
{
  // Play the round rather than assert it: the stored chain is what the guard
  // measures against, so it has to be built up before a billion is plausible.
  db.prepare('UPDATE rounds SET started_at = ? WHERE npub = ? AND ended_at IS NULL')
    .run(now() - 3 * 86400, 'resetter')
  db.prepare('UPDATE players SET game_state = ?, state_saved_at = ? WHERE npub = ?')
    .run(JSON.stringify(finishedChain()), now() - 3 * 86400, 'resetter')
  saveState('resetter', { gameState: finishedChain(), joints: 0, total_joints_earned: ROUND_TARGET,
                          joints_per_sec: 0, joints_rev: row('resetter').joints_rev })
  const second = resetRound('resetter')
  check('zweiter Reset angenommen', second.ok === true && second.round === 2)
  check('zwei Runden gezählt', row('resetter').rounds_completed === 2)
  check('drei Zeilen für den Spieler',
        db.prepare("SELECT COUNT(*) c FROM rounds WHERE npub='resetter'").get().c === 3)
  check('Punkte summiert', row('resetter').prestige_points === 2)

  const boards = roundLeaderboards()
  const mine = boards.club.filter(e => e.npub === 'resetter')
  console.log(`  Billionaires Club: ${boards.club.length} Einträge · Prestige: ${boards.prestige.length} Spieler`)
  for (const e of boards.club) {
    console.log(`    ${e.npub.padEnd(10)} Runde ${e.round_no} · ${(e.seconds_to_target / 86400).toFixed(1)} d · ${e.boost_sats} Sats`)
  }
  check('nur Runden mit Zeit im Club', boards.club.every(e => e.seconds_to_target > 0))
  check('nach Rohzeit sortiert',
        boards.club.every((e, i) => i === 0 || boards.club[i - 1].seconds_to_target <= e.seconds_to_target))
  check('mehrere Runden desselben Spielers erlaubt', mine.length === 2)
  check('Boost-Sats stehen daneben', mine.some(e => e.boost_sats === 50))
  check('Prestige-Tabelle führt den Spieler', boards.prestige[0].npub === 'resetter')
}

// ── Status for the client ───────────────────────────────────────────────────
console.log('\n── Statusfelder ──')
{
  seed('fresh', { joints: 100, total: 100 })
  const s = roundStatus('fresh')
  check('kein Reset ohne Ziel', s.can_reset === false && s.points_if_reset === 0)
  check('Ziel wird mitgeliefert', s.target === ROUND_TARGET)
  const done = roundStatus('resetter')
  check('abgeschlossene Runden gemeldet', done.rounds_completed === 2)
}

// ── The price of coming back ────────────────────────────────────────────────
// A reset that costs a thousand sats is a button nobody presses. The manager
// price is what makes it affordable, and it has to fall with every round.
console.log('\n── Managerpreis je Runde ──')
{
  const leer = initialState()
  const voll = initialState()
  voll.plantagen = PLANTATION_DEFS.map(def => { const p = newPlantation(def, 1); p.managerLevel = 1; return p })
  voll.courier.mgrLevel = 1; voll.fabrik.mgrLevel = 1
  const kosten = [0, 1, 2, 3, 4].map(done => managerSpend(leer, voll, done).cost)
  console.log(`  Kette komplett besetzen: ${kosten.map((k, i) => `R${i + 1} ${k}`).join(' · ')} Sats`)
  check('Preis fällt mit jeder Runde', kosten[0] > kosten[1] && kosten[1] > kosten[2] && kosten[2] > kosten[3])
  check('ab Runde 4 stabil', kosten[3] === kosten[4])
  check('erste drei Manager gratis', managerSpend(leer, (() => {
    const g = initialState(); g.plantagen[0].managerLevel = 1; g.courier.mgrLevel = 1; g.fabrik.mgrLevel = 1; return g
  })(), 0).cost === 0)
  // Outdoor after the first round, Indoor after the second, Hydroponic after the
  // third — everything else is bought every round.
  for (const [plot, ab] of [['1', 1], ['2', 2], ['3', 3]]) {
    check(`Plantage ${plot} ab Runde ${ab + 1} gratis`,
          managerCost(plot, voll, ab) === 0 && managerCost(plot, voll, ab - 1) > 0)
  }
  check('Greenhouse bleibt kostenpflichtig', managerCost('4', voll, 9) > 0)
  check('MegaFarm bleibt kostenpflichtig', managerCost('5', voll, 9) > 0)
}

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Runden-Checks bestanden\n')
process.exit(fail ? 1 : 0)
