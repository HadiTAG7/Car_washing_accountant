// Facts arrive only through the existing stored operations observation. A UI
// payload cannot supply an amount. No count/rate/commission conversion.
const marker = 'SSP_INVOICE_DEDUCTION_V1=';
const keys = ['bookingId', 'driverExternalId', 'serviceDate', 'cancellationReason', 'sourceReadAt', 'sourceUrl', 'currency',
  'optimalAmountSAR', 'deductionLabel', 'signedDeductionSAR', 'netAmountSAR', 'observedText'];
const money = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9 && Number(n.toFixed(2)) === n;
export function bookingInvoiceDeduction(record, reason, observedAt, now = Date.now()) {
  const parts = (record.notes || '').split(marker);
  if (parts.length === 1) return null;
  if (parts.length !== 2) throw Error('دليل فاتورة الحجز مكرر؛ يلزم مراجعة المصدر.');
  let evidence;
  try { evidence = JSON.parse(parts[1].trim()); } catch { throw Error('دليل فاتورة الحجز المحفوظ غير مكتمل.'); }
  if (!evidence || Array.isArray(evidence) || Object.keys(evidence).length !== keys.length || !keys.every(k => Object.hasOwn(evidence, k))
    || evidence.bookingId !== record.sspBookingId || evidence.driverExternalId !== record.driverExternalId
    || evidence.serviceDate !== record.serviceDate || evidence.cancellationReason !== reason || evidence.sourceUrl !== record.sourceUrl
    || evidence.currency !== 'SAR' || !/^Booking Cancelled \(Reason \d+\)$/.test(evidence.deductionLabel || '')
    || ![evidence.optimalAmountSAR, evidence.signedDeductionSAR, evidence.netAmountSAR].every(money)
    || evidence.optimalAmountSAR < 0 || evidence.signedDeductionSAR >= 0
    || Math.round(evidence.optimalAmountSAR * 100) + Math.round(evidence.signedDeductionSAR * 100) !== Math.round(evidence.netAmountSAR * 100)
    || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(evidence.sourceReadAt || '') || !Number.isFinite(Date.parse(evidence.sourceReadAt))
    || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > now + 300000
    || Date.parse(evidence.sourceReadAt) < Date.parse(`${record.serviceDate}T00:00:00+03:00`)
    || Date.parse(evidence.sourceReadAt) > now + 300000 || Date.parse(evidence.sourceReadAt) > Date.parse(observedAt)
    || typeof evidence.observedText !== 'string' || evidence.observedText.length > 5000) throw Error('دليل مبلغ خصم الفاتورة لا يطابق الحجز أو العامل أو الوقت أو الإجماليات.');
  const source = evidence.observedText.replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/−/g, '-').replace(/\s+/g, ' ').trim();
  const amountAfter = label => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`${escaped}\\s*(?:SAR\\s*)?(-?[0-9][0-9,]*\\.[0-9]{2})(?:\\s*SAR)?`, 'i'));
    return match ? Number(match[1].replace(/,/g, '')) : null;
  };
  if (!/\bDeductions\b/i.test(source) || !/\bSAR\b/.test(source)
    || (source.match(/Booking Cancelled \(Reason \d+\)/g) || []).length !== 1
    || amountAfter('Optimal Amount') !== evidence.optimalAmountSAR || amountAfter(evidence.deductionLabel) !== evidence.signedDeductionSAR
    || amountAfter('Net Amount') !== evidence.netAmountSAR) throw Error('نص فاتورة سويتر لا يثبت مبلغ الخصم المحدد؛ لا يُستخدم صافي الفاتورة بدلًا منه.');
  return evidence;
}
