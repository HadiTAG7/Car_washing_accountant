// ═══════════════════════════════════════════════════════════════════════════
// عرض مبالغ المشتريات — رقم واحد لا يعني شيئين
// ═══════════════════════════════════════════════════════════════════════════
// `total_monthly_cost`, `total_variable_cost` and `amount` are names that say
// nothing about whether the figure contains the tax. The screens each decided
// for themselves and they disagreed: the expenses page rendered
// `extractVat(total)` — the amount as a GROSS, at 15% — while a record saved
// with `price_mode: 'exclusive'` means the amount is the NET and the tax sits
// on top of it. One number, two meanings, and the gap between them is the
// whole tax.
//
// So the display goes through the same engine the ledger posts with. See
// docs/AMOUNT_DEFINITION.md for the definition itself.
//
// The one difference from `resolvePurchaseTax` is what happens when the tax
// cannot be determined. The poster REFUSES — it must, because an invented
// figure would be written into the books. A list cannot refuse to render, so
// this returns `known: false` and the caller shows «غير محدَّدة». That is not
// a softer rule; it is the same rule, which is that 15% is never assumed.
// ═══════════════════════════════════════════════════════════════════════════

import { resolvePurchaseTax } from './purchaseTax.js';
import { normalizedPriceMode } from '../vatFields.js';

/** What the stored amount IS, named so a column header can say it. */
export const AMOUNT_ROLE = {
  inclusive: { label: 'شامل الضريبة', short: 'إجمالي' },
  exclusive: { label: 'غير شامل الضريبة', short: 'صافي' },
};

export function amountRoleOf(row = {}) {
  return AMOUNT_ROLE[normalizedPriceMode(row.priceMode)];
}

/**
 * `{ known, net, vat, gross, source, deductible, reason }` for one purchase.
 *
 * `known: false` means the tax is genuinely undetermined — no amount on the
 * paper, no rate stamped on it, and no policy covering its date. `reason`
 * carries the engine's own message so the UI can explain rather than blank.
 *
 * `row` is the APP shape (camelCase), as the mappers produce it.
 */
export function purchaseAmounts(row = {}, { policyAt = null } = {}) {
  const amount = Number(row.amount) || 0;
  try {
    const r = resolvePurchaseTax({
      amount,
      priceMode: row.priceMode,
      isTaxInvoice: row.isTaxInvoice === true,
      vatDeductible: row.vatDeductible !== false,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      supplier: row.supplier,
      vatAmount: row.vatAmount ?? null,
      vatRate: row.vatRate ?? null,
      recordDate: row.recordDate || row.spentDate || row.loggedDate || '',
    }, { policyAt });
    return {
      known: true,
      net: r.net, vat: r.vat, gross: r.gross,
      documentVat: r.documentVat,
      source: r.source, rate: r.rate,
      deductible: r.deductible, noInputVatReason: r.noInputVatReason,
      reason: null,
    };
  } catch (e) {
    return {
      known: false,
      // The amount is still a fact — it is what the record says. Only the
      // SPLIT is unknown, so the gross/net are left null rather than filled
      // with the amount under a label that would be a guess.
      net: null, vat: null, gross: null, documentVat: null,
      source: null, rate: null, deductible: false, noInputVatReason: null,
      reason: e.message,
    };
  }
}

/**
 * The operational total of a list of purchases: what actually left the bank.
 *
 * `gross`, never the raw amount — an `exclusive` row's amount is the net and
 * summing it understates the cash by the tax on it. `undetermined` counts the
 * rows whose split could not be resolved, so a total is never quietly short.
 */
export function purchaseTotals(rows = [], { policyAt = null } = {}) {
  let gross = 0, net = 0, vat = 0, undetermined = 0, undeterminedAmount = 0;
  for (const row of rows) {
    const a = purchaseAmounts(row, { policyAt });
    if (!a.known) {
      undetermined += 1;
      undeterminedAmount += Number(row.amount) || 0;
      continue;
    }
    gross += a.gross; net += a.net; vat += a.vat;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    gross: r2(gross), net: r2(net), vat: r2(vat),
    undetermined, undeterminedAmount: r2(undeterminedAmount),
  };
}
