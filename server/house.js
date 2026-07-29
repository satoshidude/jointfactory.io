/**
 * House ledger — the 20 % cut, tracked instead of vanishing.
 *
 * Two things used to mint sats out of nothing: the bot seeded empty pots with
 * 8/12/21 sats a round, and a referral paid 20 sats to the referrer. Both
 * credited player balances that can be withdrawn over Lightning, so the game
 * has credited 18,394 sats from pots against 10,150 sats ever deposited.
 *
 * The cut is real income — it comes from sats players actually spent — so
 * funding those payouts from it makes every credited sat backed. Anything the
 * ledger cannot cover simply does not happen.
 */

import { db } from './db.js';

const KEY = 'house_sats';

export function houseBalance() {
  const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY);
  const n = Number(row?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function houseCredit(amount, reason = '') {
  const amt = Math.floor(amount || 0);
  if (amt <= 0) return houseBalance();
  db.prepare(`
    INSERT INTO kv_store (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(kv_store.value AS INTEGER) + ? AS TEXT)
  `).run(KEY, String(amt), amt);
  const balance = houseBalance();
  console.log(`[House] +${amt} sats${reason ? ` (${reason})` : ''} → ${balance}`);
  return balance;
}

/**
 * Spend from the ledger. Returns false when the balance does not cover it —
 * the caller must then skip whatever it was about to pay for.
 */
export function houseDebit(amount, reason = '') {
  const amt = Math.floor(amount || 0);
  if (amt <= 0) return true;
  const res = db.prepare(`
    UPDATE kv_store SET value = CAST(CAST(value AS INTEGER) - ? AS TEXT)
    WHERE key = ? AND CAST(value AS INTEGER) >= ?
  `).run(amt, KEY, amt);
  if (res.changes === 0) {
    console.warn(`[House] insufficient balance for ${amt} sats${reason ? ` (${reason})` : ''} — have ${houseBalance()}`);
    return false;
  }
  console.log(`[House] -${amt} sats${reason ? ` (${reason})` : ''} → ${houseBalance()}`);
  return true;
}

/**
 * Are the sats players hold actually backed?
 *
 * Everything owed to players plus the ledger must not exceed what came in over
 * Lightning. A shortfall means sats were minted somewhere and a withdrawal run
 * could not be honoured.
 */
export function solvency() {
  const held = db.prepare('SELECT COALESCE(SUM(sats), 0) AS s FROM players').get().s;
  const deposited = db.prepare(`SELECT COALESCE(SUM(amount_sats), 0) AS s FROM lightning_payments WHERE status = 'paid'`).get().s;
  const withdrawn = db.prepare('SELECT COALESCE(SUM(amount_sats), 0) AS s FROM withdrawals').get().s;
  const house = houseBalance();
  // Sats sitting in the open pot belong to nobody yet — at the draw they split
  // into player balances and the ledger. Leaving them out made the books jump
  // at every draw and flattered the gap while a pot was filling.
  const pot = db.prepare(`SELECT COALESCE(total_sats_collected, 0) AS s FROM lottery_rounds
                          WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get()?.s ?? 0;
  const backing = deposited - withdrawn;
  const liability = held + house + pot;
  return { held, house, pot, liability, deposited, withdrawn, backing, gap: backing - liability };
}
