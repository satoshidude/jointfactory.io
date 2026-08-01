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
const { initialState, throughput, BOOSTS } = await import('../shared/economy.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const fmt = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' B' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : Math.round(n).toString()
const now = () => Math.floor(Date.now() / 1000)

/** A chain with `managers` stations automated, levelled up so it produces. */
function chain(managers) {
  const gs = initialState()
  gs.plantagen[0].level = 60
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

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Speicher-Checks bestanden\n')
process.exit(fail ? 1 : 0)
