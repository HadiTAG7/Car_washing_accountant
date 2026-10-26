import { postedLines } from './accounting/reports';
import { round2 } from './accounting/journal';
import { PER_WORKER_FEE } from '../data/initialData';

export function partnerPaymentDescription(payment) {
  return String(payment.paymentDate || '').slice(0, 10) === '2026-07-03'
    && /رصيد افتتاحي.*رحّل/.test(payment.notes || '')
    ? 'رصيد افتتاحي (التاريخ الفعلي غير مسجل)' : payment.notes || '—';
}

export function paymentHref(payment) {
  return `?page=partner_payments&partnerId=${encodeURIComponent(payment.partnerId)}&paymentId=${encodeURIComponent(payment.id)}#partner-payment-${encodeURIComponent(payment.id)}`;
}

/** Source identity is evidence; equal amounts or names are never a match. */
export function reconcilePartnerCapital(partners, payments, entries, lines) {
  const movements = postedLines(entries, lines);
  const rows = partners.map(partner => {
    const account = `3000-${partner.id}`;
    const receipts = payments.filter(payment => payment.partnerId === partner.id);
    const recorded = round2(receipts.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    const posted = round2(movements.filter(line => String(line.accountId) === account)
      .reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0));
    const pending = receipts.flatMap(payment => {
      const originals = entries.filter(entry => !entry.reversalOf
        && (entry.sourceKind || entry.sourceType) === 'partner_payment'
        && String(entry.sourceId) === String(payment.id));
      const related = new Set(originals.map(entry => entry.id));
      for (const entry of entries) if (related.has(entry.reversalOf)) related.add(entry.id);
      const amount = round2(movements.filter(line => related.has(line.entryId) && String(line.accountId) === account)
        .reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0));
      const difference = round2(Number(payment.amount || 0) - amount);
      if (Math.abs(difference) < 0.01) return [];
      const reason = originals.length === 0 ? 'لا يوجد قيد مرتبط بسند القبض'
        : originals.some(entry => entry.status === 'reversed') && amount === 0 ? 'قيد السند معكوس'
          : originals.every(entry => entry.status === 'draft') ? 'قيد السند غير مرحّل' : 'مبلغ السند لا يطابق رأس المال المرحّل';
      return [{ ...payment, posted: amount, difference, reason }];
    });
    return { partner, required: round2(Number(partner.workersCount || 0) * PER_WORKER_FEE), recorded, posted,
      difference: round2(recorded - posted), pending };
  });
  const orphanPayments = payments.filter(payment => !partners.some(partner => partner.id === payment.partnerId));
  return { rows, orphanPayments, totals: rows.reduce((total, row) => ({
    required: round2(total.required + row.required), recorded: round2(total.recorded + row.recorded),
    posted: round2(total.posted + row.posted), difference: round2(total.difference + row.difference),
  }), { required: 0, recorded: 0, posted: 0, difference: 0 }) };
}
