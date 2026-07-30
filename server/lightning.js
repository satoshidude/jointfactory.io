import { db, logEvent } from './db.js';
import 'dotenv/config';

const LNBITS_URL = process.env.LNBITS_URL || 'http://localhost:5000';
const INVOICE_KEY = process.env.LNBITS_INVOICE_KEY || '';
const ADMIN_KEY = process.env.LNBITS_ADMIN_KEY || '';
// Shared token appended to the webhook URL. LNbits does not sign its callbacks,
// so this is the only thing that distinguishes one from any other POST — and it
// was configured but never used.
export const WEBHOOK_SECRET = process.env.LNBITS_WEBHOOK_SECRET || '';

function webhookUrl() {
  const base = process.env.LNBITS_WEBHOOK_URL || '';
  if (!base || !WEBHOOK_SECRET) return base;
  return base + (base.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(WEBHOOK_SECRET);
}

export const SAT_PACKS = [
  { id: 'grower',   sats: 50,   price_sats: 50,   label: '🌱 Grower',   description: '50 Sats' },
  { id: 'pimp',     sats: 100,  price_sats: 100,  label: '💎 Pimp',     description: '100 Sats' },
  { id: 'hustler',  sats: 200,  price_sats: 200,  label: '🔥 Hustler',  description: '200 Sats' },
  { id: 'whale',    sats: 1000, price_sats: 1000,  label: '🐋 Whale',    description: '1000 Sats' },
  { id: 'titan',    sats: 5000, price_sats: 5000,  label: '🏆 Titan',    description: '5000 Sats' },
];

export async function createInvoice(npub, packId) {
  const pack = SAT_PACKS.find(p => p.id === packId);
  if (!pack) throw new Error('Unknown pack: ' + packId);

  const res = await fetch(`${LNBITS_URL}/api/v1/payments`, {
    method: 'POST',
    headers: { 'X-Api-Key': INVOICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      out: false,
      amount: pack.price_sats,
      memo: `Joint Factory – ${pack.label}`,
      webhook: webhookUrl(),
      extra: { npub, packId }
    })
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error('LNbits error: ' + rawText);
  }

  const data = JSON.parse(rawText);

  db.prepare(`
    INSERT INTO lightning_payments (payment_hash, npub, amount_sats, pack_id)
    VALUES (?, ?, ?, ?)
  `).run(data.payment_hash, npub, pack.price_sats, packId);

  return { payment_hash: data.payment_hash, bolt11: data.payment_request, amount_sats: pack.price_sats, pack };
}

export async function payToLightningAddress(lightningAddress, amountSats, memo) {
  // Resolve LNURL-Pay from Lightning Address
  const [user, domain] = lightningAddress.split('@');
  if (!user || !domain) throw new Error('Invalid lightning address');

  const lnurlRes = await fetch(`https://${domain}/.well-known/lnurlp/${user}`);
  if (!lnurlRes.ok) throw new Error('Cannot resolve lightning address');
  const lnurlData = await lnurlRes.json();

  const amountMsat = amountSats * 1000;
  if (amountMsat < lnurlData.minSendable || amountMsat > lnurlData.maxSendable) {
    throw new Error(`Amount ${amountSats} sats out of range [${lnurlData.minSendable/1000}, ${lnurlData.maxSendable/1000}]`);
  }

  // Get invoice from recipient
  let cbUrl = `${lnurlData.callback}${lnurlData.callback.includes('?') ? '&' : '?'}amount=${amountMsat}`;
  if (lnurlData.commentAllowed && lnurlData.commentAllowed > 0 && memo) {
    cbUrl += `&comment=${encodeURIComponent(memo.slice(0, lnurlData.commentAllowed))}`;
  }
  const invoiceRes = await fetch(cbUrl);
  const invoiceData = await invoiceRes.json();
  if (!invoiceData.pr) throw new Error('No invoice from recipient');

  // Never pay an invoice without reading it first.
  //
  // The bolt11 comes from a server named by the withdrawing player, and LNbits
  // pays whatever the invoice asks for — not the amount we requested. A hostile
  // or broken LNURL endpoint could answer a 10-sat withdrawal with an invoice
  // for the whole hot wallet. The amount has to match to the millisatoshi.
  const decoded = await decodeInvoice(invoiceData.pr);
  if (decoded.amount_msat !== amountMsat) {
    throw new Error(`Recipient asked for ${Math.round((decoded.amount_msat || 0) / 1000)} sats instead of ${amountSats} — payment refused`);
  }

  // Pay via LNbits admin key
  const payRes = await fetch(`${LNBITS_URL}/api/v1/payments`, {
    method: 'POST',
    headers: { 'X-Api-Key': ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ out: true, bolt11: invoiceData.pr, memo: memo || '' })
  });

  if (!payRes.ok) {
    const err = await payRes.text();
    throw new Error('Payment failed: ' + err);
  }

  return await payRes.json();
}

/** Read a bolt11 through LNbits. Throws if it cannot be decoded. */
async function decodeInvoice(bolt11) {
  const res = await fetch(`${LNBITS_URL}/api/v1/payments/decode`, {
    method: 'POST',
    headers: { 'X-Api-Key': INVOICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: bolt11 }),
  });
  if (!res.ok) throw new Error('Cannot decode the invoice the recipient returned');
  const d = await res.json();
  if (typeof d.amount_msat !== 'number') throw new Error('Recipient returned an invoice without an amount');
  return d;
}

// Atomic webhook handler — mark payment as paid + credit sats in single transaction
const _handleWebhookTx = db.transaction((paymentHash, receivedMsat = null) => {
  const payment = db.prepare('SELECT * FROM lightning_payments WHERE payment_hash = ?').get(paymentHash);
  if (!payment) return { ok: false, reason: 'unknown payment' };
  if (payment.status === 'paid') return { ok: true, already: true };

  // Credit what arrived, never more than the invoice was written for. LNbits
  // reports incoming amounts as a positive msat figure on the payment details.
  if (receivedMsat !== null && Math.abs(receivedMsat) / 1000 < payment.amount_sats) {
    console.warn(`[Lightning] ${paymentHash.slice(0, 12)}… paid ${Math.abs(receivedMsat) / 1000} sats for a ${payment.amount_sats} sat invoice — not credited`);
    return { ok: false, reason: 'amount mismatch' };
  }

  // Atomic: only update if still pending (prevents double-credit)
  const updated = db.prepare(`UPDATE lightning_payments SET status = 'paid', paid_at = unixepoch() WHERE payment_hash = ? AND status = 'pending'`).run(paymentHash);
  if (updated.changes === 0) return { ok: true, already: true };

  db.prepare(`UPDATE players SET sats = sats + ?, total_deposited = total_deposited + ? WHERE npub = ?`).run(payment.amount_sats, payment.amount_sats, payment.npub);
  logEvent(payment.npub, 'deposit', payment.amount_sats, { pack: payment.pack_id || null });

  console.log(`[Lightning] Payment confirmed: ${payment.amount_sats} sats → ${payment.npub.slice(0,16)}...`);
  return { ok: true, npub: payment.npub, sats: payment.amount_sats };
});

/**
 * Credit a deposit — but only after LNbits confirms it was actually paid.
 *
 * This used to trust the caller. `POST /api/lightning/webhook` took a payment
 * hash from the request body and credited the matching pending row, and the hash
 * of an invoice is handed to the client that requested it: create an invoice,
 * post its own hash back, get the sats without paying, withdraw them over
 * Lightning. Both callers now go through this function, which asks LNbits.
 *
 * The credit itself stays in a transaction guarded on status = 'pending', so a
 * webhook and a status poll arriving together cannot both credit.
 */
export async function confirmAndCredit(paymentHash) {
  const row = db.prepare('SELECT status FROM lightning_payments WHERE payment_hash = ?').get(paymentHash);
  if (!row) return { ok: false, reason: 'unknown payment' };
  if (row.status === 'paid') return { ok: true, already: true };

  let paid = false, receivedMsat = null;
  try {
    const res = await fetch(`${LNBITS_URL}/api/v1/payments/${encodeURIComponent(paymentHash)}`, {
      headers: { 'X-Api-Key': INVOICE_KEY },
    });
    if (!res.ok) return { ok: false, reason: 'lookup failed' };
    const d = await res.json();
    paid = d.paid === true;
    receivedMsat = d.details?.amount ?? null;
  } catch (err) {
    console.warn('[Lightning] LNbits lookup failed:', err.message);
    return { ok: false, reason: 'lookup failed' };
  }
  if (!paid) return { ok: false, reason: 'not paid' };

  return _handleWebhookTx(paymentHash, receivedMsat);
}
