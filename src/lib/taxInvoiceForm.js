// Form-state helpers for the shared tax-invoice field group.
//
// Separate from the component so the module exports components only — the
// Fast Refresh boundary React expects — and so a form can read/write the
// block without importing any UI.

export const EMPTY_TAX_INVOICE_FIELDS = {
  invoiceNumber: '',
  invoiceDate:   '',
  supplier:      '',
  // Absent means deductible; only an explicit opt-out excludes the tax.
  vatDeductible: true,
};

/** Pulls the block off a record being edited, with safe defaults. */
export function readTaxInvoiceFields(v = {}) {
  return {
    invoiceNumber: v.invoiceNumber || '',
    invoiceDate:   v.invoiceDate || '',
    supplier:      v.supplier || '',
    vatDeductible: v.vatDeductible !== false,
  };
}

/** Trims the block for saving. */
export function submitTaxInvoiceFields(form = {}) {
  return {
    invoiceNumber: String(form.invoiceNumber || '').trim(),
    invoiceDate:   form.invoiceDate || '',
    supplier:      String(form.supplier || '').trim(),
    vatDeductible: form.vatDeductible !== false,
  };
}
