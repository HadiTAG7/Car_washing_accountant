// Form-state helpers for the shared tax-invoice field group.
//
// Separate from the component so the module exports components only — the
// Fast Refresh boundary React expects — and so a form can read/write the
// block without importing any UI.
//
// ── لماذا الحقول الثلاثة هنا وليست في mapper فقط ──
// Every expense form funnels through this helper on its way to a payload, so a
// field missing HERE is a field that never reaches the mapper at all — however
// carefully the mapper handles it. `vatAmount`, `vatRate` and `priceMode` were
// added to the mapper and to the UI and not to this, so the journey lost them
// at the first hop and the mapper's round-trip test passed anyway, because it
// started after the loss.

import {
  statedVatAmount, statedVatRate, normalizedPriceMode,
  readStatedVatAmount, readStatedVatRate,
} from './vatFields';

/**
 * Reads a stored figure for EDITING — and keeps an unusable one visible.
 *
 * The tolerant reader answers "what figure should I use", so a stored −5 or
 * 1.5 comes back as `null`: indistinguishable from "not stated". That is the
 * right answer for a report and the wrong one for a form, because the field
 * would render empty, the user would see nothing wrong, and saving would
 * write `null` — erasing a bad value instead of correcting it, while the
 * server still refuses to post the record and says so about a field the form
 * showed as blank.
 *
 * So a value that IS stated but cannot be used is handed back as it was
 * stored. `validateTaxInvoiceFields` then has something to complain about,
 * and the save stays blocked until it is fixed.
 */
function readForEditing(value, reader) {
  const r = reader(value);
  return r.stated && r.value === null ? value : r.value;
}

export const EMPTY_TAX_INVOICE_FIELDS = {
  invoiceNumber: '',
  invoiceDate:   '',
  supplier:      '',
  // Null, not 0: "the supplier did not state a VAT amount" and "the supplier
  // stated zero" are different facts, and only the second is a deduction of
  // nothing. An empty form has not been told either.
  vatAmount:     null,
  vatRate:       null,
  priceMode:     'inclusive',
  // Absent means deductible; only an explicit opt-out excludes the tax.
  vatDeductible: true,
};

/** Pulls the block off a record being edited, with safe defaults. */
export function readTaxInvoiceFields(v = {}) {
  return {
    invoiceNumber: v.invoiceNumber || '',
    invoiceDate:   v.invoiceDate || '',
    supplier:      v.supplier || '',
    // `readForEditing` rather than `|| null`: a stored 0 is a real answer and
    // `0 || null` would throw it away, while a stored −5 must stay on screen
    // rather than vanish into "not stated".
    vatAmount:     readForEditing(v.vatAmount, readStatedVatAmount),
    vatRate:       readForEditing(v.vatRate, readStatedVatRate),
    priceMode:     normalizedPriceMode(v.priceMode),
    vatDeductible: v.vatDeductible !== false,
  };
}

/** Trims the block for saving. */
export function submitTaxInvoiceFields(form = {}) {
  return {
    invoiceNumber: String(form.invoiceNumber || '').trim(),
    invoiceDate:   form.invoiceDate || '',
    supplier:      String(form.supplier || '').trim(),
    vatAmount:     statedVatAmount(form.vatAmount),
    vatRate:       statedVatRate(form.vatRate),
    priceMode:     normalizedPriceMode(form.priceMode),
    vatDeductible: form.vatDeductible !== false,
  };
}
