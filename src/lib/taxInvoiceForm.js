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

import { statedVatAmount, statedVatRate, normalizedPriceMode } from './vatFields';

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
    // `statedVatAmount` rather than `|| null`: a stored 0 is a real answer and
    // `0 || null` would throw it away.
    vatAmount:     statedVatAmount(v.vatAmount),
    vatRate:       statedVatRate(v.vatRate),
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
