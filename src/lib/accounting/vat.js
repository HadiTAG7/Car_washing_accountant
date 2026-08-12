// ═══════════════════════════════════════════════════════════════════════════
// ضريبة القيمة المضافة — VAT arithmetic
// ═══════════════════════════════════════════════════════════════════════════
// One place that knows how to split a price into net + tax, whichever way the
// price was quoted. Every posting rule and every report goes through here so
// a rate change or a rounding decision is a single edit.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from './journal';

/** KSA standard rate. */
export const VAT_RATE = 0.15;

/** How a price was quoted. */
export const PRICE_MODES = ['inclusive', 'exclusive'];

/**
 * Splits an amount into { gross, net, vat } for a given quoting mode.
 *
 *   inclusive → the amount ALREADY contains the tax:
 *               vat = amount × r / (1 + r);  net = amount − vat
 *   exclusive → the amount is before tax:
 *               vat = amount × r;            gross = amount + vat
 *
 * `taxable: false` returns the amount untouched with zero tax — used for a
 * non-registered business, an exempt supply, or a purchase whose input tax
 * is not deductible.
 */
export function splitVat(amount, { mode = 'inclusive', taxable = true, rate = VAT_RATE } = {}) {
  const a = Number(amount) || 0;
  if (!taxable || a === 0) {
    return { gross: round2(a), net: round2(a), vat: 0 };
  }
  if (mode === 'exclusive') {
    const vat = a * rate;
    return { gross: round2(a + vat), net: round2(a), vat: round2(vat) };
  }
  // inclusive (default)
  const vat = a * rate / (1 + rate);
  return { gross: round2(a), net: round2(a - vat), vat: round2(vat) };
}

/**
 * Rounding safety: after independent rounding, net + vat can miss gross by a
 * halala. The ledger cannot absorb that — an entry would not balance — so the
 * difference is pushed onto `net`, the larger figure, where it is immaterial.
 */
export function splitVatBalanced(amount, opts) {
  const { gross, net, vat } = splitVat(amount, opts);
  const drift = round2(gross - net - vat);
  return drift === 0 ? { gross, net, vat } : { gross, net: round2(net + drift), vat };
}

/** Back-compat helpers mirroring the names used before the ledger existed. */
export function extractVat(inclusiveAmount, isTaxInvoice = true) {
  return isTaxInvoice ? splitVat(inclusiveAmount, { mode: 'inclusive' }).vat : 0;
}
export function netOfVat(inclusiveAmount, isTaxInvoice = true) {
  return isTaxInvoice
    ? splitVat(inclusiveAmount, { mode: 'inclusive' }).net
    : round2(inclusiveAmount);
}

/**
 * Summarises a VAT return period from posted ledger lines.
 *
 * Output tax is what was charged on sales (a credit balance on the output
 * account); input tax is what was paid on purchases and is deductible (a
 * debit balance on the input account). The net is what is owed to — or
 * reclaimable from — the authority.
 */
export function vatReturnFrom(lines, { outputAccount, inputAccount }) {
  let output = 0, input = 0;
  for (const l of lines || []) {
    const acc = String(l.accountId);
    if (acc === outputAccount) output += (Number(l.credit) || 0) - (Number(l.debit) || 0);
    if (acc === inputAccount)  input  += (Number(l.debit)  || 0) - (Number(l.credit) || 0);
  }
  const outputTax = round2(output);
  const inputTax  = round2(input);
  const netTax    = round2(outputTax - inputTax);
  return {
    outputTax,
    inputTax,
    netTax,
    // Positive → payable to ZATCA. Negative → reclaimable.
    direction: netTax > 0 ? 'payable' : netTax < 0 ? 'refundable' : 'nil',
  };
}
