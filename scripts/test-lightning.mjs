#!/usr/bin/env node
/**
 * Deposit and payout safety, against a throwaway database and a stub LNbits.
 *
 * Two holes this pins shut:
 *
 *  1. The webhook credited whatever payment hash it was handed. A client is
 *     given the hash of the invoice it asked for, so posting that hash back was
 *     free sats — withdrawable over Lightning.
 *  2. A payout paid whatever invoice the recipient's LNURL server returned,
 *     without reading the amount. A hostile endpoint could answer a 10-sat
 *     withdrawal with an invoice for the whole hot wallet.
 *
 *   node scripts/test-lightning.mjs
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'jf-ln-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.JF_NOSTR_OFFLINE = '1'
process.env.LNBITS_URL = 'http://lnbits.test'
process.env.LNBITS_INVOICE_KEY = 'invoice-key'
process.env.LNBITS_ADMIN_KEY = 'admin-key'

// ── Stub LNbits + LNURL, so nothing leaves the machine ──────────────────────
const state = {
  paidHashes: new Set(),      // invoices LNbits considers settled
  invoiceMsat: 0,             // what the recipient's LNURL will ask for
  paidOut: [],                // bolt11s LNbits was told to pay
}
const json = (body, ok = true) => Promise.resolve({
  ok, status: ok ? 200 : 400, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)),
})

globalThis.fetch = (url, opts = {}) => {
  const u = String(url)
  // Decode first — it lives under the same path prefix as an invoice lookup.
  if (u.endsWith('/api/v1/payments/decode')) {
    return json({ amount_msat: state.invoiceMsat, payment_hash: 'decoded' })
  }
  // Invoice lookup — the authority on whether a deposit was really paid.
  const lookup = u.match(/lnbits\.test\/api\/v1\/payments\/([^/?]+)$/)
  if (lookup) {
    const hash = lookup[1]
    return json({ paid: state.paidHashes.has(hash), details: { amount: 1000 * 100 } })
  }
  if (u.endsWith('/api/v1/payments')) {
    const body = JSON.parse(opts.body || '{}')
    if (body.out) { state.paidOut.push(body.bolt11); return json({ payment_hash: 'out', checking_id: 'out' }) }
    return json({ payment_hash: 'hash_' + body.amount, payment_request: 'lnbc_' + body.amount })
  }
  if (u.includes('/.well-known/lnurlp/')) {
    return json({ callback: 'https://evil.test/cb', minSendable: 1000, maxSendable: 1e11, commentAllowed: 0 })
  }
  if (u.startsWith('https://evil.test/cb')) return json({ pr: 'lnbc_recipient' })
  return json({}, false)
}

const { db } = await import('../server/db.js')
const { createInvoice, confirmAndCredit, payToLightningAddress } = await import('../server/lightning.js')

let fail = 0
const check = (label, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++ }
const sats = () => db.prepare('SELECT sats FROM players WHERE npub = ?').get('player').sats

db.prepare('INSERT INTO players (npub, display_name, sats, joints) VALUES (?,?,?,?)').run('player', 'Player', 0, 0)

// ── The forged webhook ──────────────────────────────────────────────────────
console.log('\n── Einzahlung ohne Zahlung ──')
const inv = await createInvoice('player', 'pimp')          // 100 sats
console.log(`  Rechnung über 100 Sats, Hash ${inv.payment_hash} — der Client kennt ihn`)
const forged = await confirmAndCredit(inv.payment_hash)     // nothing paid yet
check('nicht gutgeschrieben', forged.ok === false)
check(`Grund gemeldet: "${forged.reason}"`, forged.reason === 'not paid')
check('Guthaben unverändert (0)', sats() === 0)
check('Zahlung bleibt offen',
      db.prepare('SELECT status s FROM lightning_payments WHERE payment_hash=?').get(inv.payment_hash).s === 'pending')

console.log('\n── Einzahlung nach echter Zahlung ──')
state.paidHashes.add(inv.payment_hash)
const real = await confirmAndCredit(inv.payment_hash)
check('gutgeschrieben', real.ok === true && real.sats === 100)
check('Guthaben 100', sats() === 100)
check('total_deposited mitgezählt',
      db.prepare('SELECT total_deposited d FROM players WHERE npub=?').get('player').d === 100)

console.log('\n── Kein doppeltes Gutschreiben ──')
const again = await confirmAndCredit(inv.payment_hash)
check('zweiter Aufruf ist ein No-op', again.already === true)
check('Guthaben immer noch 100', sats() === 100)

console.log('\n── Unbekannter Hash ──')
const unknown = await confirmAndCredit('deadbeef')
check('abgewiesen', unknown.ok === false && unknown.reason === 'unknown payment')

// ── The overreaching payout ─────────────────────────────────────────────────
console.log('\n── Auszahlung: Rechnung über zu viel ──')
state.invoiceMsat = 50_000 * 1000          // recipient asks for 50 000 sats
let err = null
try { await payToLightningAddress('who@evil.test', 10, 'test') } catch (e) { err = e }
check('Zahlung verweigert', err !== null)
console.log(`  Meldung: "${err?.message}"`)
check('nichts an LNbits geschickt', state.paidOut.length === 0)

console.log('\n── Auszahlung über den richtigen Betrag ──')
state.invoiceMsat = 10 * 1000
await payToLightningAddress('who@evil.test', 10, 'test')
check('bezahlt', state.paidOut.length === 1)

console.log('\n── Betragslose Rechnung ──')
state.invoiceMsat = 0
err = null
try { await payToLightningAddress('who@evil.test', 10, 'test') } catch (e) { err = e }
check('abgewiesen', err !== null)
check('kein zweiter Zahlungsversuch', state.paidOut.length === 1)

rmSync(dir, { recursive: true, force: true })
console.log(fail ? `\n${fail} Fehler\n` : '\nAlle Lightning-Checks bestanden\n')
process.exit(fail ? 1 : 0)
