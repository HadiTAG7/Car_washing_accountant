import { bookingInvoiceDeduction } from '../../functions/src/sweater/bookingInvoiceDeduction.js';

// Hadi's 1 Nov decision: actual SSP charge first, otherwise an internal SAR20
// estimate. This is presentation only, not a fee schedule or settlement policy.
export const QUALITY_OWNER_ESTIMATE_RATE = 20;
export const QUALITY_VALUED_TYPES = Object.freeze(['freeWashCompensation', 'cancelledByBiker', 'cancelledMaintenance']);
const money = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9 && Number(value.toFixed(2)) === value;
const freeRef = ref => /^(?:Compensations?(?: type)?|نوع التعويض)\s*:\s*(?:Free[ _-]*Wash(?: Compensation)?|غسلة مجانية)(?:\s*[;،؛.]|$)/i.test(ref || '');
const unresolved = { basis: 'unresolved', amountSAR: null, sourceSignedSAR: null };

export function qualityEventValuation(row, metricKey) {
  if (!QUALITY_VALUED_TYPES.includes(metricKey) || !row || row.conflict || row.orderUnknown) return unresolved;
  if (row.kind === 'booking') {
    try {
      const invoice = bookingInvoiceDeduction(row.record, row.detail?.reason, row.savedAt || row.sourceReadAt);
      if (invoice) return { basis: 'source', amountSAR: Math.abs(invoice.signedDeductionSAR), sourceSignedSAR: invoice.signedDeductionSAR, source: 'booking_invoice' };
    } catch { return unresolved; } // Invalid/ambiguous evidence is not a missing amount.
  }
  if (row.kind === 'ticket') {
    // Never borrow a wallet/promo amount for a free-wash compensation.
    const amounts = row.source?.amounts || [];
    const counts = amounts.filter(a => a.kind === 'compensation' && a.unit === 'count' && Number.isSafeInteger(a.value) && a.value > 0 && freeRef(a.sourceRef));
    if (metricKey !== 'freeWashCompensation' || !counts.length || counts.reduce((sum, a) => sum + a.value, 0) !== row.quantity) return unresolved;
    const source = amounts.filter(a => a.kind === 'compensation' && a.unit === 'SAR' && freeRef(a.sourceRef));
    if (source.length > 1 || (source.length === 1 && !money(source[0].value))) return unresolved;
    if (source.length === 1) return { basis: 'source', amountSAR: Math.abs(source[0].value), sourceSignedSAR: source[0].value, source: 'compensation_record' };
  } else if (row.amount != null) {
    return money(row.amount) ? { basis: 'source', amountSAR: Math.abs(row.amount), sourceSignedSAR: row.amount, source: 'snapshot_row' } : unresolved;
  }
  if (!Number.isSafeInteger(row.quantity) || row.quantity < 1) return unresolved;
  return { basis: 'owner_estimate', amountSAR: Math.round(row.quantity * QUALITY_OWNER_ESTIMATE_RATE * 100) / 100, sourceSignedSAR: null };
}

export function qualityValuationSummary(rows, metricKey) {
  const result = { sourceRows: 0, estimatedRows: 0, unresolvedRows: 0, sourceSAR: 0, estimatedSAR: 0 };
  for (const row of rows) {
    const value = qualityEventValuation(row, metricKey);
    if (value.basis === 'source') { result.sourceRows++; result.sourceSAR += value.amountSAR; }
    else if (value.basis === 'owner_estimate') { result.estimatedRows++; result.estimatedSAR += value.amountSAR; }
    else result.unresolvedRows++;
  }
  result.sourceSAR = Math.round(result.sourceSAR * 100) / 100;
  result.estimatedSAR = Math.round(result.estimatedSAR * 100) / 100;
  return result; // Deliberately no combined settlement total.
}
