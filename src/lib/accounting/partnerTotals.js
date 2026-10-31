// ═══════════════════════════════════════════════════════════════════════════
// المدفوع من كل شريك — derived, never a stored aggregate
// ═══════════════════════════════════════════════════════════════════════════
// `partners.paid_amount` is a CACHE, not the truth. It is maintained by a
// client-side read-then-sum, so two devices recording receipts at the same
// moment can both read the same list and write totals that disagree with the
// receipts themselves — and a number that can drift from its own evidence is
// not something to show a partner.
//
// The receipts in `partner_payments` are the evidence, so the figure is
// summed from them. Where the ledger has been posted, the capital account
// gives a second, independent reading; a difference between the two means
// receipts exist that have not been carried into the books, which is worth
// saying out loud rather than averaging away.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from './journal.js';
import { partnerCapitalCode } from './chartOfAccounts.js';
import { capitalReceivables } from '../../../functions/src/capitalReceivable.js';

/** partnerId → total received, summed from the receipts themselves. */
export function paidByPartner(payments) {
  const totals = new Map();
  for (const p of payments || []) {
    const id = String(p.partnerId ?? p.partner_id ?? '');
    if (!id) continue;
    const amount = Number(p.amount) || 0;
    totals.set(id, round2((totals.get(id) || 0) + amount));
  }
  return totals;
}

/** The credit balance of one partner's capital sub-account, from posted lines. */
export function capitalBalanceOf(partnerId, entries, lines) {
  const code = partnerCapitalCode(partnerId);
  const posted = new Set(
    (entries || []).filter((e) => e.status === 'posted').map((e) => e.id),
  );
  let balance = 0;
  let seen = false;
  for (const l of lines || []) {
    if (String(l.accountId) !== code) continue;
    if (!posted.has(l.entryId)) continue;
    seen = true;
    balance += (Number(l.credit) || 0) - (Number(l.debit) || 0);
  }
  return { balance: round2(balance), available: seen };
}

/**
 * The figure to display, plus whether the books agree with it.
 *
 * The receipts win: they are what the partner actually handed over. The
 * ledger reading is reported alongside so an unposted backlog is visible.
 */
export function partnerPaidSummary(partnerId, { payments, entries, lines, partners = [] }) {
  const paid = paidByPartner(payments).get(String(partnerId)) || 0;
  const ledger = capitalBalanceOf(partnerId, entries, lines);
  // «ذمة رأس مال غير مسددة»: capital subscribed and not yet paid sits in the capital
  // account against 1100 — it is owed, not a posting difference.
  const live = new Set((entries || []).filter((e) => e.status === 'posted' || e.status === 'reversed').map((e) => e.id));
  const named = (partners || []).map((p) => ({ id: p.id, name: p.name ?? p.partnerName ?? p.partner_name ?? '' }));
  const receivable = round2(capitalReceivables((lines || []).filter((l) => live.has(l.entryId)), named).byPartner.get(String(partnerId)) || 0);
  return {
    paid,
    ledgerBalance: ledger.balance,
    ledgerAvailable: ledger.available,
    receivable,
    unposted: ledger.available ? round2(paid - (ledger.balance - receivable)) : 0,
  };
}

/**
 * One partner's capital block, computed where the receipts and the journal
 * already are — the trusted server — so the partner's browser never has to
 * read every receipt and the whole ledger to show its own total.
 */
export function partnerCapitalSummary(partnerId, { receipts, entries, lines, partners = [] }) {
  const own = (receipts || []).filter((p) => String(p.partnerId ?? p.partner_id ?? '') === String(partnerId));
  return { ...partnerPaidSummary(partnerId, { payments: own, entries, lines, partners }), receiptsCount: own.length };
}
