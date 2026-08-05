#!/usr/bin/env node
/**
 * The save guard: what a client may claim to have earned since its last save.
 *
 * Three things have to hold at once, and the first two pull against each other:
 *
 *  - a client cannot invent joints (they convert to real sats through the
 *    lottery, and a purchase must not refund itself on the next autosave)
 *  - honest production must survive — including tapping by hand and running a
 *    boost, both of which were being confiscated
 *  - whatever the server decides, it has to say so, or the client keeps showing
 *    a balance the account does not have
 *
 *   node scripts/test-save-clamp.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-clamp-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.JF_NOSTR_OFFLINE = '1'

const { db } = await import('../server/db.js')
const { saveState } = await import('../server/game.js')
const { initialState, throughput, BOOSTS, plantLevelCost, progressCost, MAX_LEVEL_STEP,
        MAX_PLANT_LEVEL, inheritedLevel, newPlantation, PLANTATION_DEFS } = await import('../shared/economy.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const fmt = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' B' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : Math.round(n).toString()
const now = () => Math.floor(Date.now() / 1000)

/** A chain with `managers` stations automated, levelled up so it produces. */
function chain(managers) {
  const gs = initialState()
  // Below MAX_PLANT_LEVEL with room to spare: the unpaid-purchase case below
  // buys twenty levels on top, and levels past the ceiling are refused
  // outright rather than billed.
  gs.plantagen[0].level = 25
  gs.courier.capacity = 5_000_000
  gs.fabrik.capacity = 5_000_000
  if (managers >= 1) gs.plantagen[0].managerLevel = 1
  if (managers >= 2) gs.courier.mgrLevel = 1
  if (managers >= 3) gs.fabrik.mgrLevel = 1
  return gs
}

const seed = (npub, gs, joints, secondsAgo) => {
  db.prepare(`INSERT INTO players (npub, display_name, sats, joints, game_state, total_joints_earned, last_seen_at)
              VALUES (?,?,0,?,?,?,?)`)
    .run(npub, npub, joints, JSON.stringify(gs), joints, now() - secondsAgo)
}
const save = (npub, gs, joints, extra = {}) =>
  saveState(npub, { gameState: gs, joints, total_joints_earned: joints, joints_per_sec: 0, ...extra })
const balance = npub => db.prepare('SELECT joints FROM players WHERE npub = ?').get(npub).joints

// ── A newcomer tapping by hand ──────────────────────────────────────────────
console.log('\n── Handbetrieb: nur die Plantage automatisiert ──')
{
  const gs = chain(1)                       // courier and factory run by hand
  seed('tapper', gs, 1_000_000, 30)
  const modelled = throughput(gs).jointsPerSec
  const possible = throughput(gs, { ignoreManagers: true }).jointsPerSec
  console.log(`  Server-Modell automatisiert: ${fmt(modelled)}/s · von Hand möglich: ${fmt(possible)}/s`)
  check('automatisiert gerechnet wäre die Rate 0', modelled === 0)

  // 30 seconds of hand-played production.
  const earned = Math.floor(possible * 30)
  const res = save('tapper', gs, 1_000_000 + earned)
  console.log(`  meldet ${fmt(1_000_000 + earned)} nach 30 s → Server behält ${fmt(res.joints)}`)
  check('von Hand erspieltes bleibt erhalten', res.corrected === false && balance('tapper') === 1_000_000 + earned)
}

// ── A boosted player ────────────────────────────────────────────────────────
console.log('\n── Mit Express Run (3x Kurier) ──')
{
  const gs = chain(3)
  seed('boosted', gs, 1_000_000, 30)
  db.prepare('INSERT INTO active_boosts (npub, type, expires_at) VALUES (?,?,?)')
    .run('boosted', 'express', now() + BOOSTS.express.durationSec)
  const plain = throughput(gs).jointsPerSec
  const boosted = throughput(gs, { boosts: [{ type: 'express', expires_at: now() + 600 }], nowSec: now() }).jointsPerSec
  console.log(`  ohne Boost ${fmt(plain)}/s · mit Boost ${fmt(boosted)}/s`)
  const res = save('boosted', gs, 1_000_000 + Math.floor(boosted * 30))
  check('geboostete Produktion wird nicht gekappt', res.corrected === false)
}

// ── An invented balance ─────────────────────────────────────────────────────
console.log('\n── Erfundener Kontostand ──')
{
  const gs = chain(3)
  seed('cheat', gs, 1_000_000, 30)
  const res = save('cheat', gs, 1e15)
  console.log(`  meldet 1 Q → Server behält ${fmt(res.joints)}`)
  check('gekappt', res.corrected === true && res.joints < 1e12)
  check('gültiger Stand kommt zurück', res.joints === balance('cheat'))
  check('als Ereignis vermerkt',
        db.prepare("SELECT COUNT(*) n FROM events WHERE type='clamp' AND npub='cheat'").get().n === 1)
}

// ── A purchase must not refund itself ───────────────────────────────────────
console.log('\n── Kauf zwischen zwei Speicherungen ──')
{
  const gs = chain(3)
  seed('buyer', gs, 10_000_000, 5)
  const before = db.prepare('SELECT joints_rev FROM players WHERE npub=?').get('buyer').joints_rev
  // A ticket purchase deducts and bumps the revision.
  db.prepare('UPDATE players SET joints = joints - 6000000, joints_rev = joints_rev + 1 WHERE npub = ?').run('buyer')
  // The client still posts the balance it had before the purchase.
  const res = save('buyer', gs, 10_000_000, { joints_rev: before })
  console.log(`  Client meldet 10 M mit veralteter Revision → Server behält ${fmt(res.joints)}`)
  check('Abbuchung bleibt bestehen', balance('buyer') === 4_000_000)
  check('Korrektur wird gemeldet', res.corrected === true && res.joints === 4_000_000)
  check('neue Revision kommt mit', res.joints_rev === before + 1)
}

// ── An upgrade has to be paid for ───────────────────────────────────────────
// Levels are bought in the client; the server only sees the result. A state that
// claims a higher level while reporting an untouched balance used to be
// indistinguishable from an honest one — the upgrade was free.
console.log('\n── Stufenkauf ──')
{
  const gs = chain(3)
  seed('leveler', gs, 1_000_000_000, 30)
  // Twenty levels at once — the shape of an actual cheat, and far above the
  // slack the guard leaves for clock drift.
  const next = JSON.parse(JSON.stringify(gs))
  let cost = 0
  for (let i = 0; i < 20; i++) cost += plantLevelCost({ ...gs.plantagen[0], level: gs.plantagen[0].level + i })
  next.plantagen[0].level += 20
  console.log(`  20 Stufen ab ${gs.plantagen[0].level} kosten ${fmt(cost)} Joints`)
  check('Kosten werden erkannt', progressCost(gs, next) === cost)

  // Honest: level up and pay for it.
  const honest = save('leveler', next, 1_000_000_000 - cost)
  check('bezahlter Kauf bleibt unangetastet', honest.corrected === false && balance('leveler') === 1_000_000_000 - cost)

  // Dishonest: same level, balance untouched.
  const base = chain(3)
  seed('cheat2', base, 1_000_000_000, 30)
  const free = save('cheat2', next, 1_000_000_000)
  // The cheat is charged, but the production the account really made in those
  // thirty seconds still counts — the guard bills the upgrade, it does not fine
  // the player.
  const allowance = throughput(base, { ignoreManagers: true }).jointsPerSec * 30 * 1.5 + 1000
  const expected = Math.floor(1_000_000_000 + allowance - cost)
  console.log(`  ohne Abbuchung gemeldet → Server behält ${fmt(free.joints)} (erwartet ${fmt(expected)})`)
  check('unbezahlter Kauf wird abgerechnet', free.corrected === true && free.joints === expected)
  check('die ehrliche Produktion bleibt', free.joints > 1_000_000_000 - cost)
}

// ── A backlog is legitimate production ──────────────────────────────────────
// The chain rate is the steady state; a player with cannabis already in the
// field converts it at whatever the courier and factory manage. Akki was clamped
// 34 times in an hour for exactly that.
console.log('\n── Halde in der Kette ──')
{
  const gs = chain(3)
  // Plantations slow, courier and factory fast, with a full field.
  gs.plantagen[0].level = 5
  gs.courier.capacity = 50_000_000
  gs.fabrik.capacity = 50_000_000
  gs.cannabis = 500_000_000
  seed('backlog', gs, 1_000_000, 30)
  const t = throughput(gs, { ignoreManagers: true })
  const downstream = Math.min(t.courier, t.fabrik)
  console.log(`  Kette ${fmt(t.jointsPerSec)}/s · Kurier+Fabrik ${fmt(downstream)}/s · Halde ${fmt(gs.cannabis)}`)
  // 30 seconds of draining the backlog, which the chain rate alone would forbid.
  const earned = Math.floor(downstream * 30)
  const res = save('backlog', gs, 1_000_000 + earned)
  check('Abbau der Halde wird nicht gekappt', res.corrected === false)
  check('Guthaben steht wie gemeldet', balance('backlog') === 1_000_000 + earned)
}

// ── Coming back after a long absence ────────────────────────────────────────
// Offline production is credited by the client on load. The guard measured the
// window from last_seen_at — which signing in had just set to now — so a player
// returning after weeks had every joint they earned while away clamped off. It
// cost the Joint Factory account 110.5 trillion in one save.
console.log('\n── Rückkehr nach langer Abwesenheit ──')
{
  const gs = chain(3)
  const away = 78 * 86400
  db.prepare(`INSERT INTO players (npub, display_name, sats, joints, game_state, total_joints_earned, last_seen_at, state_saved_at)
              VALUES (?,?,0,?,?,?,?,?)`)
    .run('returner', 'Returner', 1_000_000, JSON.stringify(gs), 1_000_000, now(), now() - away)
  const rate = throughput(gs, { ignoreManagers: true }).jointsPerSec
  const offline = Math.floor(rate * away * 0.5)      // client credits half the theoretical maximum
  console.log(`  ${(away / 86400).toFixed(0)} Tage weg · ${fmt(rate)}/s → Client meldet ${fmt(offline)} nachgeholt`)
  const res = save('returner', gs, 1_000_000 + offline)
  check('die Offline-Produktion bleibt', res.corrected === false && balance('returner') === 1_000_000 + offline)
  check('Anmeldezeit spielt keine Rolle',
        db.prepare("SELECT last_seen_at > state_saved_at - 10 AS x FROM players WHERE npub='returner'").get().x === 1)
}

// ── Two saves in the same second ────────────────────────────────────────────
// While a player clicks, saves land about a second apart; stamped in whole
// seconds, two can share one. The window rounded to zero and took that second's
// production with it.
console.log('\n── Zwei Speicherungen in derselben Sekunde ──')
{
  const gs = chain(3)
  seed('rapid', gs, 1_000_000_000, 0)          // gerade eben gespeichert
  const rate = throughput(gs, { ignoreManagers: true }).jointsPerSec
  const res = save('rapid', gs, 1_000_000_000 + Math.floor(rate))   // eine Sekunde Produktion
  console.log(`  ${fmt(rate)}/s · meldet eine Sekunde später ${fmt(rate)} mehr`)
  check('die Sekunde wird nicht einkassiert', res.corrected === false)
}

// ── A brand-new account ─────────────────────────────────────────────────────
// The first save has nothing stored to measure against. An empty baseline meant
// a rate of zero and a ceiling of "balance + 1000", so everything a newcomer
// tapped for in their first minutes was taken off them.
console.log('\n── Erste Speicherung eines neuen Kontos ──')
{
  db.prepare('INSERT INTO players (npub, display_name, sats, joints, last_seen_at) VALUES (?,?,0,0,?)')
    .run('fresh', 'Fresh', now() - 120)
  const gs = initialState()
  const possible = throughput(gs, { ignoreManagers: true }).jointsPerSec
  const earned = Math.floor(possible * 120)
  console.log(`  frische Kette ${possible}/s · 2 min getippt → ${fmt(earned)} Joints`)
  const res = save('fresh', gs, earned)
  check('nichts wird einkassiert', res.corrected === false && balance('fresh') === earned)
}

// ── A claim no clicking explains ────────────────────────────────────────────
// Walking the cost formula over an arbitrary level jump would run it as many
// times as the client cares to claim — a free way to burn server CPU.
console.log('\n── Unmöglicher Sprung ──')
{
  const gs = chain(3)
  seed('jumper', gs, 1_000_000, 30)
  const absurd = JSON.parse(JSON.stringify(gs))
  absurd.plantagen[0].level += MAX_LEVEL_STEP * 100
  const t0 = Date.now()
  const res = save('jumper', absurd, 1e15)
  const ms = Date.now() - t0
  console.log(`  +${MAX_LEVEL_STEP * 100} Stufen gemeldet · in ${ms} ms beantwortet`)
  check('Guthaben bleibt der Serverstand', balance('jumper') === 1_000_000)
  check('als Korrektur gemeldet', res.corrected === true)
  check('kein Rechenlauf über die Grenze hinaus (< 250 ms)', ms < 250)
}

// ── An unlocked plot arrives with levels on it ──────────────────────────────
// A new plantation opens on half the highest level already owned, which reads
// exactly like a level jump the player never paid for. Of everything the guard
// sees, this is the case most likely to be mistaken for cheating — and it is the
// single most expensive purchase in the game.
console.log('\n── Freischaltung mit geerbtem Level ──')
{
  const gs = chain(3)
  seed('unlocker', gs, 10_000_000, 30)
  const next = JSON.parse(JSON.stringify(gs))
  const level = inheritedLevel(next.plantagen)
  const plot = newPlantation(PLANTATION_DEFS[1], level)
  plot.managerLevel = 1
  next.plantagen.push(plot)
  const price = PLANTATION_DEFS[1].unlockCost
  console.log(`  Plantage 2 öffnet auf Level ${level} für ${fmt(price)} Joints`)
  check('nur die Freischaltung wird berechnet, nicht die geerbten Level',
        progressCost(gs, next) === price)
  const res = save('unlocker', next, 10_000_000 - price)
  check('ehrliche Freischaltung wird nicht gekappt',
        res.corrected === false && balance('unlocker') === 10_000_000 - price)
}

// ── The ceiling on a single plot ────────────────────────────────────────────
console.log('\n── Levelgrenze ──')
{
  const gs = chain(3)
  seed('capper', gs, 1e12, 30)
  const over = JSON.parse(JSON.stringify(gs))
  over.plantagen[0].level = MAX_PLANT_LEVEL + 1
  save('capper', over, 1e12)
  const kept = JSON.parse(db.prepare("SELECT game_state g FROM players WHERE npub='capper'").get().g)
  console.log(`  Level ${MAX_PLANT_LEVEL + 1} gemeldet (Grenze ${MAX_PLANT_LEVEL}) → gespeichert ${kept.plantagen[0].level}`)
  check('über der Grenze abgewiesen', balance('capper') === 1e12)
  // The state must not survive either: every later ceiling is built from what is
  // stored, so a rejected chain left in the database raises the next allowance.
  check('der abgewiesene Zustand wird nicht gespeichert', kept.plantagen[0].level === 25)

  const atCap = JSON.parse(JSON.stringify(gs))
  atCap.plantagen[0].level = MAX_PLANT_LEVEL
  const paid = progressCost(gs, atCap)
  const ok = save('capper', atCap, 1e12 - paid)
  check('genau auf der Grenze erlaubt', ok.corrected === false)
}

// ── The lifetime counter is a claim too ─────────────────────────────────────
// It used to be written straight through. That was survivable while it only fed
// a leaderboard; it now decides when a round is finished, what it pays in
// prestige and which time enters the Billionaires Club.
console.log('\n── Lebenssumme ──')
{
  const gs = chain(3)
  seed('liar', gs, 1_000_000, 30)
  const rate = throughput(gs, { ignoreManagers: true }).jointsPerSec
  const ceiling = Math.floor(1_000_000 + rate * 30 * 1.5 + 1000)
  save('liar', gs, 1_000_000, { total_joints_earned: 1e15 })
  const stored = db.prepare("SELECT total_joints_earned t FROM players WHERE npub='liar'").get().t
  console.log(`  1 Q behauptet · ${fmt(rate)}/s über 30 s → Server hält ${fmt(stored)} (Decke ${fmt(ceiling)})`)
  check('behauptete Lebenssumme wird gekappt', stored <= ceiling)

  // And the honest case still passes through untouched.
  db.prepare("UPDATE players SET state_saved_at = ? WHERE npub = 'liar'").run(now() - 30)
  const honest = stored + Math.floor(rate * 30)
  save('liar', gs, 1_000_000, { total_joints_earned: honest })
  check('ehrliche Produktion zählt weiter',
        db.prepare("SELECT total_joints_earned t FROM players WHERE npub='liar'").get().t === honest)
}

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Speicher-Checks bestanden\n')
process.exit(fail ? 1 : 0)
