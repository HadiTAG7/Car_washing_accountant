// ═══════════════════════════════════════════════════════════════════════════
// تقرير ضريبة القيمة المضافة — output tax, deductible input tax, net
// ═══════════════════════════════════════════════════════════════════════════
// Pure logic. The page renders what this returns; it computes nothing itself.
//
// The rule that governs this whole file:
//
//   ضريبة المدخلات لا تُطالَب إلا بفاتورة ضريبية فعلية.
//
// A cost being recurring is NOT evidence that three tax invoices exist. The
// earlier report multiplied a monthly template by three inside a quarter,
// which invented two invoices that nobody had ever received — an overstated
// reclaim, and the kind an assessment reverses with a penalty. Deduction now
// requires a document: a date, an invoice number, a supplier, and an amount
// of its own for that specific purchase.
//
// Anything short of that is not silently dropped either. It is listed as
// «غير مؤهلة» with the exact missing fields, because a number quietly
// vanishing from a return is as bad as one quietly appearing in it.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from './journal';
import { splitVatBalanced, VAT_RATE } from './vat';

export const FILING_PERIODS = ['monthly', 'quarterly'];
export const FILING_PERIOD_LABELS = {
  monthly:   'شهري',
  quarterly: 'ربع سنوي',
};

const QUARTER_NAMES  = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
const QUARTER_MONTHS = ['يناير – مارس', 'أبريل – يونيو', 'يوليو – سبتمبر', 'أكتوبر – ديسمبر'];
const MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

// ─── الفترات ─────────────────────────────────────────────────────────────
/**
 * '2026-08-11' → '2026-08' (monthly) or '2026-Q3' (quarterly).
 *
 * ZATCA files quarterly below the SAR 40m threshold and monthly above it, so
 * neither can be assumed — the filing frequency is a setting, and this takes
 * it as an argument rather than baking one in.
 */
export function periodKeyFor(isoDate, filing = 'quarterly') {
  const s = String(isoDate || '');
  if (s.length < 7) return '';
  const y = s.slice(0, 4);
  const m = parseInt(s.slice(5, 7), 10);
  if (!Number.isFinite(m) || m < 1 || m > 12) return '';
  if (filing === 'monthly') return `${y}-${String(m).padStart(2, '0')}`;
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/** 'الربع الثالث 2026 · يوليو – سبتمبر' / 'أغسطس 2026'. */
export function periodLabel(key) {
  const q = /^(\d{4})-Q([1-4])$/.exec(String(key || ''));
  if (q) {
    const i = +q[2] - 1;
    return `الربع ${QUARTER_NAMES[i]} ${q[1]} · ${QUARTER_MONTHS[i]}`;
  }
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (m) {
    const i = +m[2] - 1;
    return MONTH_NAMES[i] ? `${MONTH_NAMES[i]} ${m[1]}` : key;
  }
  return key || '';
}

/** The period containing `date` under the chosen filing frequency. */
export function currentPeriodKey(filing = 'quarterly', date = new Date()) {
  const off = date.getTimezoneOffset() * 60_000;
  return periodKeyFor(new Date(date.getTime() - off).toISOString().slice(0, 10), filing);
}

/** Inclusive [from, to] ISO dates spanned by a period key. */
export function periodRange(key) {
  const q = /^(\d{4})-Q([1-4])$/.exec(String(key || ''));
  if (q) {
    const startMonth = (+q[2] - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(Date.UTC(+q[1], endMonth, 0)).getUTCDate();
    return {
      from: `${q[1]}-${String(startMonth).padStart(2, '0')}-01`,
      to:   `${q[1]}-${String(endMonth).padStart(2, '0')}-${lastDay}`,
    };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (m) {
    const lastDay = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
    return { from: `${key}-01`, to: `${key}-${lastDay}` };
  }
  return { from: '', to: '' };
}

// ─── أهلية فاتورة المدخلات ───────────────────────────────────────────────
/**
 * What a tax invoice must carry before its VAT may be deducted. Each entry is
 * a field plus the Arabic name shown when it is missing, so the report can
 * tell the user precisely what to go and fill in.
 */
export const INPUT_INVOICE_REQUIREMENTS = [
  { field: 'invoiceDate',   label: 'تاريخ الفاتورة' },
  { field: 'invoiceNumber', label: 'رقم الفاتورة' },
  { field: 'supplier',      label: 'اسم المورّد' },
  { field: 'amount',        label: 'مبلغ الفاتورة' },
];

function hasText(v) { return String(v ?? '').trim().length > 0; }
function isIsoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').slice(0, 10)); }

/**
 * Judges one input record. Returns { eligible, missing: [Arabic labels] }.
 *
 * `invoiceDate` falls back to the spend date: a purchase logged on the day it
 * happened carries its date there, and requiring the field twice would reject
 * perfectly good records for a formatting reason.
 */
export function inputInvoiceEligibility(row) {
  const missing = [];
  if (!row?.isTaxInvoice) {
    return { eligible: false, missing: ['غير مُعلَّمة كفاتورة ضريبية'] };
  }
  const date = row.invoiceDate || row.spentDate;
  if (!isIsoDate(date)) missing.push('تاريخ الفاتورة');
  if (!hasText(row.invoiceNumber)) missing.push('رقم الفاتورة');
  if (!hasText(row.supplier)) missing.push('اسم المورّد');
  if (!(Number(row.amount) > 0)) missing.push('مبلغ الفاتورة');
  // An explicit non-deductible flag beats every other consideration: a
  // non-recoverable input tax is part of the cost, not a receivable.
  if (row.vatDeductible === false) {
    return { eligible: false, missing: ['مُستبعدة من الخصم صراحةً'] };
  }
  return { eligible: missing.length === 0, missing };
}

/** The date a purchase is claimed on — its invoice date, else its spend date. */
export function claimDateOf(row) {
  const d = row?.invoiceDate || row?.spentDate || '';
  return isIsoDate(d) ? String(d).slice(0, 10) : '';
}

// ─── ضريبة المخرجات ──────────────────────────────────────────────────────
/**
 * Output tax from completed washes in the period.
 *
 * Only مكتملة counts: an in-progress job is not an earned supply, so charging
 * output tax on it would declare a sale that has not happened. When the
 * business is not VAT-registered the whole amount is revenue and output tax
 * is zero — stated as such rather than computed and hidden.
 */
export function outputTaxFromWashes(washes, { period, filing = 'quarterly', vatRegistered = true, priceMode = 'inclusive', rate = VAT_RATE } = {}) {
  let gross = 0, net = 0, vat = 0, count = 0, excluded = 0;
  for (const w of washes || []) {
    if (w.status !== 'مكتملة') { excluded += 1; continue; }
    const date = String(w.washDate || '').slice(0, 10);
    if (!isIsoDate(date)) { excluded += 1; continue; }
    if (period && periodKeyFor(date, filing) !== period) continue;
    const amount = round2((Number(w.quantity) || 0) * (Number(w.price) || 0));
    if (amount <= 0) continue;
    const s = splitVatBalanced(amount, { mode: priceMode, taxable: vatRegistered, rate });
    gross += s.gross; net += s.net; vat += s.vat; count += 1;
  }
  return {
    gross: round2(gross), net: round2(net), tax: round2(vat), count, excluded,
  };
}

/** Output tax already posted to the ledger, as an independent cross-check. */
export function outputTaxFromLedger(entries, lines, { period, filing = 'quarterly', account = '2100' } = {}) {
  const postedById = new Map();
  for (const e of entries || []) {
    if (e.status !== 'posted') continue;
    const date = String(e.entryDate || '').slice(0, 10);
    if (period && periodKeyFor(date, filing) !== period) continue;
    postedById.set(e.id, e);
  }
  let tax = 0;
  let found = false;
  for (const l of lines || []) {
    if (String(l.accountId) !== String(account)) continue;
    if (!postedById.has(l.entryId)) continue;
    found = true;
    tax += (Number(l.credit) || 0) - (Number(l.debit) || 0);
  }
  return { tax: round2(tax), available: found };
}

// ─── التقرير ─────────────────────────────────────────────────────────────
/**
 * Builds the whole report.
 *
 * `inputs` are the candidate purchase records; every one is judged, and the
 * result carries BOTH lists — the deducted ones and the rejected ones with
 * their reasons. Nothing is multiplied, extrapolated or assumed: an amount
 * appears once, on the date of its own invoice.
 */
export function buildVatReport({
  inputs = [], washes = [], entries = [], lines = [],
  period = '', filing = 'quarterly',
  vatRegistered = true, washPriceMode = 'inclusive', rate = VAT_RATE,
} = {}) {
  const eligible = [];
  const ineligible = [];

  for (const row of inputs) {
    const date = claimDateOf(row);
    const { eligible: ok, missing } = inputInvoiceEligibility(row);
    const outsidePeriod = Boolean(period) && Boolean(date) && periodKeyFor(date, filing) !== period;

    if (ok) {
      // An eligible row always has a usable date — it is one of the
      // requirements — so period filtering is unambiguous.
      if (outsidePeriod) continue;
      const amount = round2(Number(row.amount) || 0);
      const s = splitVatBalanced(amount, { mode: row.priceMode || 'inclusive', taxable: true, rate });
      eligible.push({ ...row, claimDate: date, gross: s.gross, net: s.net, tax: s.vat });
      continue;
    }

    // A reject with a date belongs to that date's period. A reject WITHOUT
    // one belongs to no period at all, so it is shown in every view: an
    // invoice that can never be claimed anywhere must not disappear just
    // because a period is selected — that silence is what let a dateless
    // recurring cost be multiplied by three in the first place.
    if (outsidePeriod) continue;
    ineligible.push({ ...row, claimDate: date, missing });
  }

  const inputTax = round2(eligible.reduce((sum, r) => sum + r.tax, 0));
  const inputGross = round2(eligible.reduce((sum, r) => sum + r.gross, 0));
  const inputNet = round2(eligible.reduce((sum, r) => sum + r.net, 0));
  const forfeitedTax = round2(ineligible.reduce(
    (sum, r) => sum + splitVatBalanced(Number(r.amount) || 0, { mode: 'inclusive', taxable: true, rate }).vat, 0,
  ));

  const output = outputTaxFromWashes(washes, { period, filing, vatRegistered, priceMode: washPriceMode, rate });
  const ledgerOutput = outputTaxFromLedger(entries, lines, { period, filing });

  const netTax = round2(output.tax - inputTax);
  return {
    period,
    filing,
    vatRegistered,
    output,
    ledgerOutput,
    // A difference between the operational figure and the posted one means
    // some completed washes have not been carried into the books yet.
    outputMismatch: ledgerOutput.available && Math.abs(round2(ledgerOutput.tax - output.tax)) >= 0.01
      ? round2(output.tax - ledgerOutput.tax)
      : 0,
    input: { tax: inputTax, gross: inputGross, net: inputNet, count: eligible.length },
    eligible,
    ineligible,
    // What is being left on the table for want of a document — the number
    // that tells the user why filling the fields in is worth their time.
    forfeitedTax,
    netTax,
    direction: netTax > 0.005 ? 'payable' : netTax < -0.005 ? 'refundable' : 'nil',
  };
}

/** Every period present in the data, newest first, plus the current one. */
export function availablePeriods(rows, filing = 'quarterly', extra = []) {
  const set = new Set();
  for (const r of rows || []) {
    const k = periodKeyFor(claimDateOf(r) || r?.date || '', filing);
    if (k) set.add(k);
  }
  for (const d of extra || []) {
    const k = periodKeyFor(d, filing);
    if (k) set.add(k);
  }
  set.add(currentPeriodKey(filing));
  return [...set].sort().reverse();
}
