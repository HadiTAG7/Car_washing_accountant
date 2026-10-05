import { ownerBookingIdentity } from './bookingIdentity.js';
const FIELDS = new Set(['source', 'ownerName', 'statement', 'unitAmount', 'totalAmount', 'vatAmount',
  'priceMode', 'grossAmount', 'totalVatAmount', 'totalGrossAmount']);
const cents = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  && Math.abs(Math.round(value * 100) - value * 100) <= 0.000001;
const round = n => Math.round(n * 100) / 100;

// unitAmount/totalAmount retain their historical meaning. With an explicit
// exclusive split they are net; VAT and gross are separately owner asserted.
export function ownerConfirmationTaxSplit(value, clarificationId) {
  if (value?.vatAmount === null) return null;
  return { source: 'owner_statement', ownerName: value.ownerName.trim(), statement: value.statement.trim(),
    clarificationId, currency: 'SAR', priceMode: 'exclusive', quantity: 1,
    net: value.unitAmount, vat: value.vatAmount, gross: value.grossAmount };
}

// An owner's assertion is evidence for this batch, never a price/tax policy
// or a bank receipt. Only staff can persist it through the authenticated API.
export function ownerConfirmationProblems(value, records) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['إقرار المالك يجب أن يكون كائناً.'];
  const errors = [];
  if (Object.keys(value).some(key => !FIELDS.has(key))) errors.push('حقول إقرار المالك غير مسموحة.');
  if (value.source !== 'owner_statement') errors.push('مصدر الإقرار يجب أن يكون owner_statement.');
  for (const key of ['ownerName', 'statement']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 1000) errors.push(`${key} مطلوب كنص محدود.`);
  }
  if (typeof value.unitAmount !== 'number' || !Number.isFinite(value.unitAmount) || value.unitAmount <= 0
    || Math.abs(Math.round(value.unitAmount * 100) - value.unitAmount * 100) > 0.000001) errors.push('قيمة الغسلة بإفادة المالك يجب أن تكون موجبة وبمنزلتين عشريتين.');
  const expected = Math.round(value.unitAmount * records.length * 100) / 100;
  if (typeof value.totalAmount !== 'number' || !Number.isFinite(value.totalAmount) || value.totalAmount !== expected) errors.push('إجمالي الإفادة لا يطابق عدد الغسلات × قيمة الغسلة.');
  if (value.vatAmount === null) {
    if (['priceMode', 'grossAmount', 'totalVatAmount', 'totalGrossAmount'].some(key => Object.hasOwn(value, key))) errors.push('فصل الضريبة يحتاج مبلغ ضريبة مثبتاً في إقرار المالك.');
  } else if (value.priceMode !== 'exclusive' || !cents(value.vatAmount) || !cents(value.grossAmount)
    || !cents(value.totalVatAmount) || !cents(value.totalGrossAmount)
    || value.grossAmount !== round(value.unitAmount + value.vatAmount)
    || value.totalVatAmount !== round(value.vatAmount * records.length)
    || value.totalGrossAmount !== round(value.grossAmount * records.length)) {
    errors.push('فصل إقرار المالك يجب أن يطابق الصافي والضريبة والإجمالي لكل غسلة وللدفعة.');
  }
  if (!records.length || records.length > 50) errors.push('حفظ إقرار المالك يحتاج من ١ إلى ٥٠ غسلة.');
  const ids = records.map(row => ownerBookingIdentity(row?.sspBookingId));
  if (new Set(ids).size !== ids.length) errors.push('معرّفات الحجوزات داخل دفعة الإقرار يجب أن تكون فريدة.');
  return errors;
}
