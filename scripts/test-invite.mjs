#!/usr/bin/env node
/**
 * Invite rewards — runs against a throwaway database.
 *
 * The reward is an hour of double output across the chain, granted when the
 * invited player automates theirs. No sats move at any point: the old scheme
 * paid the referrer 20 sats once the buddy had deposited 50, which put the only
 * reward for inviting behind someone else's bitcoin.
 *
 *   node scripts/test-invite.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-invite-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.JF_NOSTR_OFFLINE = '1'

const { db } = await import('../server/db.js')
const { checkReferralReward, REFERRAL_BOOST } = await import('../server/auth.js')
const { getActiveBoosts } = await import('../server/boosts.js')
const { houseBalance } = await import('../server/house.js')
const {
  initialState, BOOSTS, boostMultipliers, REQUIRED_MANAGERS,
} = await import('../shared/economy.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const now = () => Math.floor(Date.now() / 1000)

const REFERRER = 'referrer', BUDDY = 'buddy'

/** A chain with `managers` of the three stations automated. */
function stateWith(managers) {
  const gs = initialState()
  if (managers >= 1) gs.plantagen[0].managerLevel = 1
  if (managers >= 2) gs.courier.mgrLevel = 1
  if (managers >= 3) gs.fabrik.mgrLevel = 1
  return JSON.stringify(gs)
}

db.prepare('INSERT INTO players (npub, display_name, sats, joints) VALUES (?,?,?,?)').run(REFERRER, 'Referrer', 100, 0)
db.prepare('INSERT INTO players (npub, display_name, sats, joints, referred_by, game_state) VALUES (?,?,?,?,?,?)')
  .run(BUDDY, 'Buddy', 100, 0, REFERRER, stateWith(1))

const snapshot = () => ({
  referrerSats: db.prepare('SELECT sats FROM players WHERE npub=?').get(REFERRER).sats,
  buddySats: db.prepare('SELECT sats FROM players WHERE npub=?').get(BUDDY).sats,
  house: houseBalance(),
  boosts: getActiveBoosts(REFERRER),
  rewarded: db.prepare('SELECT referral_rewarded r FROM players WHERE npub=?').get(BUDDY).r,
})

const opening = snapshot()
console.log(`\n  Prämie: ${BOOSTS[REFERRAL_BOOST].name} — ${BOOSTS[REFERRAL_BOOST].short}, ${BOOSTS[REFERRAL_BOOST].durationSec / 60} min`)

// ── Not yet ─────────────────────────────────────────────────────────────────
console.log(`\n── Vor der Automatisierung (1 von ${REQUIRED_MANAGERS} Managern) ──`)
check('keine Prämie', checkReferralReward(BUDDY) === null)
check('kein Boost beim Werber', snapshot().boosts.length === 0)

db.prepare('UPDATE players SET game_state = ? WHERE npub = ?').run(stateWith(2), BUDDY)
check(`auch bei 2 von ${REQUIRED_MANAGERS} nicht`, checkReferralReward(BUDDY) === null)

// ── The trigger ─────────────────────────────────────────────────────────────
console.log(`\n── Kette automatisiert (${REQUIRED_MANAGERS} Manager) ──`)
db.prepare('UPDATE players SET game_state = ? WHERE npub = ?').run(stateWith(3), BUDDY)
const res = checkReferralReward(BUDDY)
const after = snapshot()
check('Prämie ausgelöst', res !== null && res.referrerNpub === REFERRER)
check(`Werber hat ${REFERRAL_BOOST}`, after.boosts.some(b => b.type === REFERRAL_BOOST))

const m = boostMultipliers(after.boosts, now())
console.log(`  Multiplikatoren beim Werber: plant ×${m.plant} · courier ×${m.courier} · fabrik ×${m.fabrik}`)
check('doppelt auf allen drei Stationen', m.plant === 2 && m.courier === 2 && m.fabrik === 2)

const remaining = after.boosts.find(b => b.type === REFERRAL_BOOST).expires_at - now()
console.log(`  Restlaufzeit: ${Math.round(remaining / 60)} min`)
check('eine Stunde', Math.abs(remaining - 3600) <= 2)

// ── No sats anywhere ────────────────────────────────────────────────────────
console.log('\n── Keine Sats im Spiel ──')
check(`Werber-Sats unverändert (${after.referrerSats})`, after.referrerSats === opening.referrerSats)
check(`Geworbener-Sats unverändert (${after.buddySats})`, after.buddySats === opening.buddySats)
check('House-Ledger unberührt', after.house === opening.house)
check('kein Deposit nötig — total_deposited ist 0',
      db.prepare('SELECT COALESCE(total_deposited,0) d FROM players WHERE npub=?').get(BUDDY).d === 0)

// ── Once only ───────────────────────────────────────────────────────────────
console.log('\n── Nur einmal je Geworbenem ──')
check('als belohnt markiert', after.rewarded === 1)
check('zweiter Aufruf bringt nichts', checkReferralReward(BUDDY) === null)
check('Restlaufzeit unverändert',
      getActiveBoosts(REFERRER).find(b => b.type === REFERRAL_BOOST).expires_at ===
      after.boosts.find(b => b.type === REFERRAL_BOOST).expires_at)

// ── A second buddy stacks the duration ──────────────────────────────────────
console.log('\n── Zweiter Geworbener verlängert ──')
db.prepare('INSERT INTO players (npub, display_name, sats, joints, referred_by, game_state) VALUES (?,?,?,?,?,?)')
  .run('buddy2', 'Buddy2', 0, 0, REFERRER, stateWith(3))
const before2 = getActiveBoosts(REFERRER).find(b => b.type === REFERRAL_BOOST).expires_at
checkReferralReward('buddy2')
const after2 = getActiveBoosts(REFERRER).find(b => b.type === REFERRAL_BOOST).expires_at
console.log(`  Laufzeit ${Math.round((before2 - now()) / 60)} min → ${Math.round((after2 - now()) / 60)} min`)
check('um eine weitere Stunde verlängert', after2 - before2 === BOOSTS[REFERRAL_BOOST].durationSec)

// ── An unreferred player triggers nothing ───────────────────────────────────
db.prepare('INSERT INTO players (npub, display_name, sats, joints, game_state) VALUES (?,?,?,?,?)')
  .run('solo', 'Solo', 0, 0, stateWith(3))
check('Spieler ohne Werber löst nichts aus', checkReferralReward('solo') === null)

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Invite-Checks bestanden\n')
process.exit(fail ? 1 : 0)
