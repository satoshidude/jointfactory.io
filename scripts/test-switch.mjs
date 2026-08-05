#!/usr/bin/env node
/**
 * The switch from the old economy into rounds.
 *
 * This is the one operation that asks a player to give something up, so the
 * things it must *not* do carry the most weight: it must not touch sats, it must
 * not fire without confirmation, and it must not let a tab that was open
 * yesterday write a chain from the old curve over an account that has not
 * decided yet.
 *
 *   node scripts/test-switch.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-switch-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.JF_NOSTR_OFFLINE = '1'

const { db } = await import('../server/db.js')
const { saveState } = await import('../server/game.js')
const { switchToRounds, switchPreview, switchPending, currentRound, roundStatus,
        SWITCH_ROUNDS_MAX, switchRoundsFor } = await import('../server/rounds.js')
const roundStatusTarget = () => roundStatus('legacy').target
const { getOrCreatePlayer } = await import('../server/auth.js')
const { initialState, newPlantation, PLANTATION_DEFS, managerCost, managerPrice, ROUND_TARGET } =
  await import('../shared/economy.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const fmt = n => n >= 1e15 ? (n / 1e15).toFixed(2) + ' Q' : n >= 1e12 ? (n / 1e12).toFixed(1) + ' T'
  : n >= 1e9 ? (n / 1e9).toFixed(2) + ' B' : Math.round(n).toLocaleString()
const now = () => Math.floor(Date.now() / 1000)
const row = npub => db.prepare('SELECT * FROM players WHERE npub = ?').get(npub)

/** An account as it looked before rounds: huge balance, six developed plots. */
function legacy(npub, { total = 4.7e15, sats = 1446 } = {}) {
  const gs = initialState()
  gs.plantagen = PLANTATION_DEFS.map(def => { const p = newPlantation(def, 40); p.managerLevel = 1; return p })
  gs.courier.mgrLevel = 1; gs.courier.capacity = 20_480
  gs.fabrik.mgrLevel = 1;  gs.fabrik.capacity = 20_480
  db.prepare('DELETE FROM players WHERE npub = ?').run(npub)
  db.prepare('DELETE FROM rounds WHERE npub = ?').run(npub)
  db.prepare(`INSERT INTO players (npub, display_name, sats, joints, game_state, total_joints_earned,
                                   speed_level, switch_pending, created_at, last_seen_at, state_saved_at)
              VALUES (?,?,?,?,?,?,?,1,?,?,?)`)
    .run(npub, npub, sats, 9.9e14, JSON.stringify(gs), total, 37,
         now() - 150 * 86400, now() - 30, now() - 30)
  return gs
}

console.log('\n═══ Umstieg auf Runden ═══')

// ── Frozen until confirmed ──────────────────────────────────────────────────
console.log('\n── Gesperrt, bis bestätigt wird ──')
{
  const gs = legacy('legacy')
  check('als wartend erkannt', switchPending('legacy') === true)

  const before = row('legacy')
  const res = saveState('legacy', {
    gameState: initialState(), joints: 1e15, total_joints_earned: 5e15,
    joints_per_sec: 0, joints_rev: before.joints_rev,
  })
  const after = row('legacy')
  console.log(`  Speicherung abgewiesen: ${res.reason}`)
  check('Speicherung wird abgewiesen', res.ok === false && res.reason === 'switch_required')
  check('Guthaben unberührt', after.joints === before.joints)
  check('Lebenssumme unberührt', after.total_joints_earned === before.total_joints_earned)
  check('Kette unberührt', after.game_state === before.game_state)
  check('Sats unberührt', after.sats === before.sats)
  check('keine Runde angelegt',
        db.prepare("SELECT COUNT(*) c FROM rounds WHERE npub='legacy'").get().c === 0)
  check('Angebot wird geliefert', !!switchPreview('legacy'))

  const offer = switchPreview('legacy')
  console.log(`  Angebot: ${offer.rounds_credited} Runden · ${offer.points_credited} Sterne · ` +
              `Manager ${offer.manager_price_before} → ${offer.manager_price_after} Sats`)
  check('Vorschau nennt die Lebenssumme', offer.lifetime_joints === Math.floor(4.7e15))
  check('Vorschau nennt die Sats', offer.sats === 1446)
  check('Manager werden billiger', offer.manager_price_after < offer.manager_price_before)
  void gs
}

// ── The switch itself ───────────────────────────────────────────────────────
console.log('\n── Der Umstieg ──')
{
  const before = row('legacy')
  const res = switchToRounds('legacy')
  const after = row('legacy')
  const gs = JSON.parse(after.game_state)
  console.log(`  ${fmt(before.total_joints_earned)} → ${res.rounds_credited} Runden, ` +
              `${res.points_credited} Sterne, Manager ab jetzt ${res.manager_price} Sats`)

  check('angenommen', res.ok === true)
  check('Sperre aufgehoben', after.switch_pending === 0 && switchPending('legacy') === false)
  check('drei Runden angerechnet', after.rounds_completed === SWITCH_ROUNDS_MAX)
  check('drei Sterne', after.prestige_points === SWITCH_ROUNDS_MAX)
  check('Sats unangetastet', after.sats === before.sats)
  check('Guthaben auf null', after.joints === 0 && after.total_joints_earned === 0)
  check('Speed zurückgesetzt', after.speed_level === 0)
  check('Lebenssumme übernommen', after.lifetime_joints === before.total_joints_earned)
  check('Kette am Anfang', gs.plantagen.length === 1 && gs.courier.capacity === initialState().courier.capacity)
  check('Revision erhöht', after.joints_rev === before.joints_rev + 1)

  const closed = db.prepare("SELECT * FROM rounds WHERE npub='legacy' AND ended_at IS NOT NULL").all()
  check('genau drei geschlossene Runden', closed.length === SWITCH_ROUNDS_MAX)
  check('keine davon mit Zeit', closed.every(r => r.seconds_to_target === null))
  check('je ein Stern', closed.every(r => r.prestige_points === 1))
  check('Runde 4 offen',
        currentRound('legacy').round_no === SWITCH_ROUNDS_MAX + 1 && currentRound('legacy').ended_at === null)
  check('Ereignis geschrieben',
        db.prepare("SELECT COUNT(*) c FROM events WHERE npub='legacy' AND type='switch'").get().c === 1)
}

// ── Idempotent ──────────────────────────────────────────────────────────────
console.log('\n── Zweiter Aufruf ──')
{
  const before = row('legacy')
  const res = switchToRounds('legacy')
  const after = row('legacy')
  check('wird abgewiesen', res.ok === false && res.reason === 'already_switched')
  check('nichts verändert',
        after.prestige_points === before.prestige_points &&
        after.rounds_completed === before.rounds_completed &&
        after.joints_rev === before.joints_rev)
  check('immer noch vier Rundenzeilen',
        db.prepare("SELECT COUNT(*) c FROM rounds WHERE npub='legacy'").get().c === SWITCH_ROUNDS_MAX + 1)
}

// ── What the three rounds are worth ─────────────────────────────────────────
console.log('\n── Was die drei Runden wert sind ──')
{
  const gs = JSON.parse(row('legacy').game_state)
  // The three free managers first, so the quota is used up and the plot prices show.
  gs.plantagen[0].managerLevel = 1; gs.courier.mgrLevel = 1; gs.fabrik.mgrLevel = 1
  const done = row('legacy').rounds_completed
  console.log(`  nach ${done} Runden: Manager ${managerPrice(done)} Sats ` +
              `(vorher ${managerPrice(0)}), Outdoor/Indoor/Hydro gratis`)
  check('Manager zum Bodenpreis', managerPrice(done) === 21)
  for (const plot of ['1', '2', '3']) check(`Plantage ${plot} gratis`, managerCost(plot, gs, done) === 0)
  check('Greenhouse kostet', managerCost('4', gs, done) === 21)
  check('MegaFarm kostet', managerCost('5', gs, done) === 21)
}

// ── Credited in proportion, capped at three ────────────────────────────────
console.log('\n── Anrechnung nach Lebenssumme ──')
{
  const Q = 1e15
  for (const [lifetime, want] of [[0, 0], [0.9 * Q, 0], [1 * Q, 1], [2.6 * Q, 2],
                                  [3 * Q, 3], [14.3 * Q, 3], [1000 * Q, 3]]) {
    const got = switchRoundsFor(lifetime)
    console.log(`  ${fmt(lifetime).padStart(10)} → ${got} Runden`)
    if (got !== want) { fail++; console.log(`    ✗ erwartet ${want}`) }
  }
  check('nie mehr als drei', switchRoundsFor(1e30) === SWITCH_ROUNDS_MAX)
  check('unter einer Runde gibt es nichts', switchRoundsFor(ROUND_TARGET - 1) === 0)

  // Ein Konto mit knapp zwei Runden bekommt genau zwei — Vorschau und Umstieg
  // müssen dieselbe Zahl nennen.
  legacy('zweirunden', { total: 2.6e15, sats: 300 })
  const offer = switchPreview('zweirunden')
  const res = switchToRounds('zweirunden')
  console.log(`  2,6 Q → Vorschau ${offer.rounds_credited}, umgestellt ${res.rounds_credited}`)
  check('Vorschau und Umstieg stimmen überein', offer.rounds_credited === res.rounds_credited)
  check('zwei Runden angerechnet', res.rounds_credited === 2 && row('zweirunden').rounds_completed === 2)
  check('zwei geschlossene Zeilen',
        db.prepare("SELECT COUNT(*) c FROM rounds WHERE npub='zweirunden' AND ended_at IS NOT NULL").get().c === 2)
  check('Runde 3 offen', currentRound('zweirunden').round_no === 3)
  check('Sats unangetastet', row('zweirunden').sats === 300)

  // Und ein Konto ohne eine volle Runde bekommt nichts angerechnet, spielt aber.
  legacy('kleinvieh', { total: 4.29e10, sats: 50 })
  const kl = switchToRounds('kleinvieh')
  console.log(`  42,9 B → ${kl.rounds_credited} Runden, Manager ${kl.manager_price} Sats`)
  check('keine Runde angerechnet', kl.rounds_credited === 0 && row('kleinvieh').rounds_completed === 0)
  check('keine Sterne', row('kleinvieh').prestige_points === 0)
  check('startet in Runde 1', currentRound('kleinvieh').round_no === 1)
  check('Lebenssumme trotzdem gespeichert', row('kleinvieh').lifetime_joints === Math.floor(4.29e10))
  check('zahlt den vollen Managerpreis', kl.manager_price === managerPrice(0))
}

// ── A new account is born playing rounds ────────────────────────────────────
console.log('\n── Neues Konto ──')
{
  const npub = 'f'.repeat(64)
  getOrCreatePlayer(npub, null)
  check('nicht gesperrt', switchPending(npub) === false)
  check('kein Angebot', switchPreview(npub) === null)
  const res = saveState(npub, {
    gameState: initialState(), joints: 5, total_joints_earned: 5, joints_per_sec: 0,
    joints_rev: row(npub).joints_rev,
  })
  check('kann sofort spielen', res.ok === true)
  check('startet in Runde 1', currentRound(npub).round_no === 1)
  check('ohne Sterne', (row(npub).prestige_points || 0) === 0)
}

// ── A switched account plays normally ───────────────────────────────────────
console.log('\n── Nach dem Umstieg wird gespielt ──')
{
  const gs = initialState()
  gs.plantagen[0].managerLevel = 1; gs.courier.mgrLevel = 1; gs.fabrik.mgrLevel = 1
  const res = saveState('legacy', {
    gameState: gs, joints: 40, total_joints_earned: 40, joints_per_sec: 0,
    joints_rev: row('legacy').joints_rev,
  })
  check('Speicherung geht durch', res.ok === true)
  check('kein Angebot mehr', switchPreview('legacy') === null)
  check('Rundenziel wird mitgeliefert', roundStatusTarget() === ROUND_TARGET)
}

// ── Ein nackter POST reicht nicht ───────────────────────────────────────────
// Der Umstieg ist einmalig und nicht rückgängig zu machen. In der Entwicklung
// sind Konten umgestiegen, ohne dass jemand den Knopf gedrückt hat; die Ursache
// blieb offen. Deshalb muss die Bestätigung im Request stehen — was hier
// ankommt, ohne es zu wollen, wird abgewiesen statt ausgeführt.
console.log('\n── Ohne Bestätigung im Body kein Umstieg ──')
{
  const { readFileSync } = await import('fs')
  const route = readFileSync('server/index.js', 'utf8')
  check('die Route verlangt confirm === true',
        /req\.body\?\.confirm !== true/.test(route))
  check('und antwortet mit confirm_required',
        /confirm_required/.test(route))
  const hook = readFileSync('src/hooks/useRoundSwitch.ts', 'utf8')
  check('der Client schickt die Bestätigung mit',
        /JSON\.stringify\(\{ confirm: true \}\)/.test(hook))
}

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Umstiegs-Checks bestanden\n')
process.exit(fail ? 1 : 0)
