import { postedLines } from './accounting/reports';
import { round2 } from './accounting/journal';
import { PER_WORKER_FEE } from '../data/initialData';
import { capitalReceivables, capitalReceivablePartner } from '../../functions/src/capitalReceivable.js';

export function partnerPaymentDescription(payment) {
  return String(payment.paymentDate || '').slice(0, 10) === '2026-07-03'
    && /رصيد افتتاحي.*رحّل/.test(payment.notes || '')
    ? 'رصيد افتتاحي (التاريخ الفعلي غير مسجل)' : payment.notes || '—';
}

export function paymentHref(payment) {
  return `?page=partner_payments&partnerId=${encodeURIComponent(payment.partnerId)}&paymentId=${encodeURIComponent(payment.id)}#partner-payment-${encodeURIComponent(payment.id)}`;
}

/**
 * Source identity is evidence; equal amounts or names are never a match.
 * «ذمة رأس مال غير مسددة» (1100 «ذمة رأس مال — الشريك») is capital subscribed and
 * not yet paid: it sits in the capital account, so it is its own column, and the
 * difference is receipts − (capital − receivable).
 */
export function reconcilePartnerCapital(partners, payments, entries, lines) {
  const movements = postedLines(entries, lines);
  const named = partners.map(p => ({ id: p.id, name: p.partnerName ?? p.partner_name ?? p.name ?? '' }));
  const receivables = capitalReceivables(movements, named);
  const rows = partners.map(partner => {
    const account = `3000-${partner.id}`;
    const receivable = round2(receivables.byPartner.get(String(partner.id)) || 0);
    // What a receipt's entry credited for this partner: their capital, or their receivable.
    const own = line => String(line.accountId) === account || capitalReceivablePartner(line, named) === String(partner.id);
    const receipts = payments.filter(payment => payment.partnerId === partner.id);
    const recorded = round2(receipts.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    const posted = round2(movements.filter(line => String(line.accountId) === account)
      .reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0));
    const pending = receipts.flatMap(payment => {
      // A receipt's own entry: posted by «ترحيل» (partner_payment) or by the founding
      // «سند قبض وصل لحساب هادي» (founding_receipt, sourceType partner_payment).
      const originals = entries.filter(entry => !entry.reversalOf
        && (entry.sourceKind === 'partner_payment' || entry.sourceType === 'partner_payment')
        && String(entry.sourceId) === String(payment.id));
      const related = new Set(originals.map(entry => entry.id));
      for (const entry of entries) if (related.has(entry.reversalOf)) related.add(entry.id);
      const amount = round2(movements.filter(line => related.has(line.entryId) && own(line))
        .reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0));
      const difference = round2(Number(payment.amount || 0) - amount);
      if (Math.abs(difference) < 0.01) return [];
      const reason = originals.length === 0 ? 'لا يوجد قيد مرتبط بسند القبض'
        : originals.some(entry => entry.status === 'reversed') && amount === 0 ? 'قيد السند معكوس'
          : originals.every(entry => entry.status === 'draft') ? 'قيد السند غير مرحّل' : 'مبلغ السند لا يطابق رأس المال المرحّل';
      return [{ ...payment, posted: amount, difference, reason }];
    });
    return { partner, required: round2(Number(partner.workersCount || 0) * PER_WORKER_FEE), recorded, posted, receivable,
      difference: round2(recorded - (posted - receivable)), pending };
  });
  const orphanPayments = payments.filter(payment => !partners.some(partner => partner.id === payment.partnerId));
  const unmatchedReceivables = { count: receivables.unmatched.length,
    amount: round2(receivables.unmatched.reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0)) };
  return { rows, orphanPayments, unmatchedReceivables, totals: rows.reduce((total, row) => ({
    required: round2(total.required + row.required), recorded: round2(total.recorded + row.recorded),
    posted: round2(total.posted + row.posted), receivable: round2(total.receivable + row.receivable),
    difference: round2(total.difference + row.difference),
  }), { required: 0, recorded: 0, posted: 0, receivable: 0, difference: 0 }) };
}
