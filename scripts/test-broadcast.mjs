#!/usr/bin/env node
/**
 * Owner broadcast — against a throwaway database and a fake relay.
 *
 * A DM that reached a relay cannot be recalled, so the properties worth pinning
 * are the ones that stop it going out twice: the campaign log skips whoever
 * already has it, a dry run touches no relay, and a run interrupted halfway
 * resumes rather than repeats.
 *
 *   node scripts/test-broadcast.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-dm-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.JF_NOSTR_OFFLINE = '1'

const { db } = await import('../server/db.js')
const { sendBroadcast, recipients, campaigns } = await import('../server/broadcast.js')
const { generateSecretKey, getPublicKey, nip04 } = await import('nostr-tools')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }

const botKey = generateSecretKey()
const botPub = getPublicKey(botKey)

// Three players, one bot account, one with a short (invalid) pubkey.
const keys = {}
for (const name of ['alice', 'bob', 'carol']) {
  const sk = generateSecretKey()
  keys[name] = sk
  db.prepare('INSERT INTO players (npub, display_name, sats, joints, last_seen_at) VALUES (?,?,0,0,unixepoch())')
    .run(getPublicKey(sk), name)
}
db.prepare('INSERT INTO players (npub, display_name, sats, joints, is_bot) VALUES (?,?,0,0,1)')
  .run(getPublicKey(generateSecretKey()), 'botplayer')
db.prepare('INSERT INTO players (npub, display_name, sats, joints) VALUES (?,?,0,0)').run('short', 'broken')
// The bot's own account is in the players table too — it must not DM itself.
db.prepare('INSERT INTO players (npub, display_name, sats, joints) VALUES (?,?,0,0)').run(botPub, 'jointfactory.io')

const relay = []
let failNext = false
const publish = async (event) => {
  if (failNext) { failNext = false; throw new Error('relay refused') }
  relay.push(event)
}

const MSG = 'Hey {name}, there is an update — come and look: https://jointfactory.io'

console.log('\n── Empfängerkreis ──')
const list = recipients('update-1', botPub)
console.log(`  ${list.length} Empfänger: ${list.map(r => r.display_name).join(', ')}`)
check('Bot-Konten ausgeschlossen', !list.some(r => r.display_name === 'botplayer'))
check('kaputter Pubkey ausgeschlossen', !list.some(r => r.display_name === 'broken'))
check('Bot selbst nicht in der Liste', !list.some(r => r.npub === botPub))

console.log('\n── Trockenlauf ──')
const dry = await sendBroadcast({ message: MSG, campaign: 'update-1', dryRun: true }, publish, botKey)
check('drei Nachrichten vorbereitet', dry.sent === 3)
check('nichts an einen Relay gegeben', relay.length === 0)
check('nichts protokolliert', db.prepare('SELECT COUNT(*) n FROM dm_log').get().n === 0)
check('Bot schreibt sich nicht selbst an', !dry.results.some(r => r.name === 'jointfactory.io'))

console.log('\n── Erster echter Versand, auf einen begrenzt ──')
const one = await sendBroadcast({ message: MSG, campaign: 'update-1', dryRun: false, limit: 1 }, publish, botKey)
check('genau einer verschickt', one.sent === 1 && relay.length === 1)
check('im Protokoll vermerkt', db.prepare('SELECT COUNT(*) n FROM dm_log').get().n === 1)
check('Empfänger als erledigt markiert', recipients('update-1', botPub).filter(r => r.sent_at).length === 1)

console.log('\n── Verschlüsselt und lesbar für den Empfänger ──')
{
  const evt = relay[0]
  const to = evt.tags.find(t => t[0] === 'p')[1]
  const name = Object.entries(keys).find(([, sk]) => getPublicKey(sk) === to)?.[0]
  const plain = await nip04.decrypt(keys[name], botPub, evt.content)
  console.log(`  an ${name}: "${plain.slice(0, 46)}…"`)
  check('Kind 4', evt.kind === 4)
  check('Inhalt ist nicht der Klartext', evt.content !== plain)
  check('Empfänger kann entschlüsseln', plain.includes('there is an update'))
  check('{name} ersetzt', plain.startsWith(`Hey ${name},`))
  check('vom Bot signiert', evt.pubkey === botPub)
}

console.log('\n── Zweiter Lauf überspringt den ersten ──')
const rest = await sendBroadcast({ message: MSG, campaign: 'update-1', dryRun: false }, publish, botKey)
check('nur die zwei Verbleibenden', rest.queued === 2 && rest.sent === 2)
check('insgesamt drei DMs', relay.length === 3)
const perPlayer = db.prepare("SELECT npub, COUNT(*) n FROM dm_log WHERE campaign='update-1' GROUP BY npub").all()
check('niemand doppelt', perPlayer.every(r => r.n === 1))

console.log('\n── Dritter Lauf schickt nichts mehr ──')
const again = await sendBroadcast({ message: MSG, campaign: 'update-1', dryRun: false }, publish, botKey)
check('Warteschlange leer', again.queued === 0 && again.sent === 0)
check('weiterhin drei DMs', relay.length === 3)

console.log('\n── Relay-Fehler wird nicht als erledigt verbucht ──')
failNext = true
const other = await sendBroadcast({ message: MSG, campaign: 'update-2', dryRun: false, limit: 1 }, publish, botKey)
check('als Fehlschlag gemeldet', other.failed === 1 && other.sent === 0)
check('nicht protokolliert', db.prepare("SELECT COUNT(*) n FROM dm_log WHERE campaign='update-2'").get().n === 0)
const retry = await sendBroadcast({ message: MSG, campaign: 'update-2', dryRun: false, limit: 1 }, publish, botKey)
check('Wiederholung geht durch', retry.sent === 1)

console.log('\n── Pflichtangaben ──')
check('ohne Nachricht kein Versand', (await sendBroadcast({ message: '  ', campaign: 'x' }, publish, botKey)).ok === false)
check('ohne Kampagnenname kein Versand', (await sendBroadcast({ message: 'hi', campaign: '' }, publish, botKey)).ok === false)
check('ohne Bot-Schlüssel kein Versand', (await sendBroadcast({ message: 'hi', campaign: 'x' }, publish, null)).ok === false)

console.log(`\n  Kampagnen: ${campaigns().map(c => `${c.campaign} (${c.sent})`).join(', ')}`)

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Broadcast-Checks bestanden\n')
process.exit(fail ? 1 : 0)
