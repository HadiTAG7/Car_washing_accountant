// ═══════════════════════════════════════════════════════════════════════════
// حقول الضريبة على فاتورة المشتريات — «غير مذكور» ليست صفراً
// ═══════════════════════════════════════════════════════════════════════════
// One definition, in one place, because three places were each deciding it
// separately and they disagreed — which is how a purchase saved without a
// stated VAT amount came to read as an explicit zero-VAT purchase in the
// return.
//
// The trap is `Number(null) === 0`. It is finite, it is non-negative, and it
// passes every plausible-looking guard — so `{ vatAmount: null }`, which is
// exactly what the mapper writes for "the supplier did not state one", was
// being deducted as a VAT of zero and labelled `source: 'invoice'` as though
// the supplier had written it. The fallback to the invoice's own rate, and
// then to the policy in force on its date, never ran.
//
// So the three states are named rather than inferred:
//
//   null / undefined / '' / whitespace   →  NOT STATED  (fall through)
//   0 / '0'                              →  an explicit zero (a zero-rated
//                                           or exempt supply, and a real
//                                           answer the report must honour)
//   any other finite non-negative number →  the stated figure
//
// `undefined` behaved correctly by accident (`Number(undefined)` is NaN);
// `null` did not. Accidentally-correct is not a property to rely on.
// ═══════════════════════════════════════════════════════════════════════════

/** True when a field carries no answer at all — as opposed to the answer 0. */
export function isUnstated(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * The VAT amount a supplier wrote on the document, or `null` for "not stated".
 *
 * Rounded to the halala, because it is money and it will be summed.
 */
export function statedVatAmount(value) {
  if (isUnstated(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * The rate a document was raised at, as a fraction, or `null` for "not
 * stated". Zero is a real rate — a zero-rated supply — and survives.
 */
export function statedVatRate(value) {
  if (isUnstated(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n >= 1) return null;
  return n;
}

/** Whether the recorded amount already contains the tax. */
export function normalizedPriceMode(value) {
  return value === 'exclusive' ? 'exclusive' : 'inclusive';
}

/**
 * Which of the three sources will price this invoice, decided once so the
 * form, the report and the export all say the same thing.
 *
 * Returns 'invoice' | 'invoice-rate' | 'policy'.
 */
export function taxSourceFor(row = {}) {
  if (statedVatAmount(row.vatAmount) !== null) return 'invoice';
  if (statedVatRate(row.vatRate) !== null) return 'invoice-rate';
  return 'policy';
}
