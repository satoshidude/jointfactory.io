#!/usr/bin/env node
/**
 * One client at a time.
 *
 * Two clients on the same account both simulate and both save. The guard clamps
 * each against what the other stored, and an upgrade bought in one is invisible
 * to the other, which buys it again — a live account paid for the same capacity
 * step nine times in an hour. Only the newest client may write.
 *
 *   node scripts/test-session.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-session-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.JF_NOSTR_OFFLINE = '1'

const { db } = await import('../server/db.js')
const { claimSession, isMasterSession } = await import('../server/session.js')
const { initialState } = await import('../shared/economy.js')

let fail = 0
const check = (label, ok) => { console.log(`  ${ok ? '✓' : '✗'} ${label}`); if (!ok) fail++ }

db.prepare('INSERT INTO players (npub, display_name, joints, sats, game_state) VALUES (?,?,?,?,?)')
  .run('dual', 'Dual', 0, 0, JSON.stringify(initialState()))

console.log('\n── Ohne Anspruch spielt jeder ──')
// A deploy must not lock anyone out of their own account: a client that predates
// the header, and an account nobody has claimed, both pass.
check('unbeanspruchtes Konto: erster Client darf', isMasterSession('dual', 'A') === true)
check('der Anspruch wurde dabei gesetzt',
      db.prepare('SELECT active_session s FROM players WHERE npub=?').get('dual').s === 'A')
check('ein Client ohne Kennung wird nicht ausgesperrt', isMasterSession('dual', null) === true)

console.log('\n── Der neueste Client gewinnt ──')
claimSession('dual', 'B')
check('B darf schreiben', isMasterSession('dual', 'B') === true)
check('A darf nicht mehr', isMasterSession('dual', 'A') === false)

console.log('\n── Zurückholen ──')
claimSession('dual', 'A')
check('A hat das Konto zurück', isMasterSession('dual', 'A') === true)
check('B ist jetzt draußen', isMasterSession('dual', 'B') === false)
check('Zeitstempel wird mitgeschrieben',
      db.prepare('SELECT active_session_at t FROM players WHERE npub=?').get('dual').t > 0)

console.log('\n── Der abgewiesene Client verändert nichts ──')
{
  const { saveState } = await import('../server/game.js')
  const before = db.prepare('SELECT joints, game_state FROM players WHERE npub=?').get('dual')
  // Genau das, was die Route tut, bevor sie speichert.
  const allowed = isMasterSession('dual', 'B')
  if (allowed) saveState('dual', { gameState: initialState(), joints: 999999 })
  const after = db.prepare('SELECT joints, game_state FROM players WHERE npub=?').get('dual')
  check('B kommt gar nicht erst zum Speichern', allowed === false)
  check('Joints unverändert', before.joints === after.joints)
  check('Spielstand unverändert', before.game_state === after.game_state)
}

console.log('\n── Unbekanntes Konto blockiert nicht ──')
check('kein Spieler, keine Sperre', isMasterSession('gibtsnicht', 'X') === true)

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Session-Checks bestanden\n')
process.exit(fail ? 1 : 0)
