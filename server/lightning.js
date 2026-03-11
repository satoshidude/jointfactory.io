import { db } from './db.js';
import 'dotenv/config';

const LNBITS_URL = process.env.LNBITS_URL || 'http://localhost:5000';
const INVOICE_KEY = process.env.LNBITS_INVOICE_KEY || '';
const ADMIN_KEY = process.env.LNBITS_ADMIN_KEY || '';

export const SAT_PACKS = [
  { id: 'grower',   sats: 50,   price_sats: 50,   label: '🌿 Grower',   description: '50 Sats' },
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
      webhook: process.env.LNBITS_WEBHOOK_URL || '',
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

// Atomic webhook handler — mark payment as paid + credit sats in single transaction
const _handleWebhookTx = db.transaction((paymentHash) => {
  const payment = db.prepare('SELECT * FROM lightning_payments WHERE payment_hash = ?').get(paymentHash);
  if (!payment) return { ok: false, reason: 'unknown payment' };
  if (payment.status === 'paid') return { ok: true, already: true };

  // Atomic: only update if still pending (prevents double-credit)
  const updated = db.prepare(`UPDATE lightning_payments SET status = 'paid', paid_at = unixepoch() WHERE payment_hash = ? AND status = 'pending'`).run(paymentHash);
  if (updated.changes === 0) return { ok: true, already: true };

  db.prepare(`UPDATE players SET sats = sats + ?, total_deposited = total_deposited + ? WHERE npub = ?`).run(payment.amount_sats, payment.amount_sats, payment.npub);

  console.log(`[Lightning] Payment confirmed: ${payment.amount_sats} sats → ${payment.npub.slice(0,16)}...`);
  return { ok: true, npub: payment.npub, sats: payment.amount_sats };
});

export function handleWebhook(paymentHash) {
  return _handleWebhookTx(paymentHash);
}
