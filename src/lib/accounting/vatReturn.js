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
 * `invoiceDate` is REQUIRED and has no fallback. The spend date is when money
 * left the account; the invoice date is when the supplier raised the document,
 * and they are routinely different — a purchase paid in April against a March
 * invoice is deducted in March. Substituting one for the other would file the
 * deduction in the wrong period, which is a misstatement even when the amount
 * is right. The user enters the date off the invoice, or the tax is not
 * deducted.
 */
export function inputInvoiceEligibility(row) {
  const missing = [];
  if (!row?.isTaxInvoice) {
    return { eligible: false, missing: ['غير مُعلَّمة كفاتورة ضريبية'] };
  }
  if (!isIsoDate(row.invoiceDate)) missing.push('تاريخ الفاتورة');
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

/**
 * The date a purchase is claimed on — the INVOICE date, and only that. A row
 * without one has no claim date at all, which is why it shows in every period
 * rather than drifting into whichever one its payment happened to fall in.
 */
export function claimDateOf(row) {
  const d = row?.invoiceDate || '';
  return isIsoDate(d) ? String(d).slice(0, 10) : '';
}

/**
 * The VAT on one purchase invoice, in order of authority.
 *
 *   1. The amount the SUPPLIER wrote on the document. A tax invoice states its
 *      own VAT; recomputing it from a rate is second-guessing the paper the
 *      deduction rests on, and a supplier's rounding is theirs to make.
 *   2. Failing that, the rate stored ON the invoice — a 5%-era purchase keeps
 *      its 5% however many times the standard rate has moved since.
 *   3. Failing that, the rate in force on the INVOICE's date.
 *
 * Today's rate is never the answer for a historical document.
 */
export function inputInvoiceTax(row, { policyAt = null, rate = VAT_RATE } = {}) {
  const amount = round2(Number(row?.amount) || 0);
  const mode = row?.priceMode === 'exclusive' ? 'exclusive' : 'inclusive';

  const stated = Number(row?.vatAmount);
  if (Number.isFinite(stated) && stated >= 0 && stated <= amount) {
    const gross = mode === 'exclusive' ? round2(amount + stated) : amount;
    return { gross, net: round2(gross - stated), vat: round2(stated), source: 'invoice' };
  }

  const onInvoice = Number(row?.vatRate);
  if (Number.isFinite(onInvoice) && onInvoice >= 0 && onInvoice < 1) {
    return { ...splitVatBalanced(amount, { mode, taxable: true, rate: onInvoice }), source: 'invoice-rate' };
  }

  const date = claimDateOf(row);
  const policy = policyAt ? policyAt(date) : null;
  if (policy && !policy.known) {
    return { gross: amount, net: amount, vat: 0, source: 'unknown-policy' };
  }
  const effective = policy?.vatRate ?? rate;
  return { ...splitVatBalanced(amount, { mode, taxable: true, rate: effective }), source: policy ? 'policy' : 'default' };
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
export function outputTaxFromWashes(washes, {
  period, filing = 'quarterly',
  // The policy in force on a given date, and the wash's own posted entry.
  // Both default to the flat behaviour so a caller that has neither still
  // works — but the page passes both, because neither shortcut is safe:
  // re-splitting a POSTED wash under today's switches restates a filed month,
  // and splitting an UNPOSTED one under today's switches answers a question
  // about July with August's rules.
  policyAt = null, postedEntryOf = null,
  vatRegistered = true, priceMode = 'inclusive', rate = VAT_RATE,
} = {}) {
  const resolve = policyAt
    || (() => ({ known: true, vatRegistered, washPriceMode: priceMode, vatRate: rate }));
  let gross = 0, net = 0, vat = 0, count = 0, excluded = 0, unknownPolicy = 0;
  for (const w of washes || []) {
    if (w.status !== 'مكتملة') { excluded += 1; continue; }
    const date = String(w.washDate || '').slice(0, 10);
    if (!isIsoDate(date)) { excluded += 1; continue; }
    if (period && periodKeyFor(date, filing) !== period) continue;
    const amount = round2((Number(w.quantity) || 0) * (Number(w.price) || 0));
    if (amount <= 0) continue;

    // A posted wash carries its own answer, frozen at posting.
    const recorded = postedEntryOf ? washEntryTax(postedEntryOf(w)) : null;
    if (recorded) {
      gross += recorded.gross; net += recorded.net; vat += recorded.vat; count += 1;
      continue;
    }
    const policy = resolve(date);
    if (!policy.known) {
      // Before the policy record begins. Counting it under today's rules is
      // exactly the invention this report must not make.
      unknownPolicy += 1;
      continue;
    }
    const s = splitVatBalanced(amount, {
      mode: w.priceMode || policy.washPriceMode,
      taxable: policy.vatRegistered,
      rate: policy.vatRate,
    });
    gross += s.gross; net += s.net; vat += s.vat; count += 1;
  }
  return {
    gross: round2(gross), net: round2(net), tax: round2(vat), count, excluded,
    // Completed washes whose period predates the policy record. Named, never
    // folded into the figure.
    unknownPolicy,
  };
}

/**
 * The tax a posted wash entry actually recorded.
 *
 * `taxSnapshot` is what `postSource` froze; an entry from before the snapshot
 * is read off its own lines, which say the same thing one step less directly.
 * Returns null when there is no entry — the caller then falls back to the
 * dated policy.
 */
export function washEntryTax(entry) {
  if (!entry) return null;
  const snap = entry.taxSnapshot;
  if (snap && Number.isFinite(Number(snap.net))) {
    return { net: round2(snap.net), vat: round2(snap.vat), gross: round2(snap.gross) };
  }
  const lines = Array.isArray(entry.lines) ? entry.lines : null;
  if (!lines) return null;
  let net = 0, vat = 0, gross = 0;
  for (const l of lines) {
    const code = String(l.accountId);
    const movement = (Number(l.credit) || 0) - (Number(l.debit) || 0);
    if (code === '4000') net += movement;
    else if (code === '2100') vat += movement;
    else gross += -movement;
  }
  return { net: round2(net), vat: round2(vat), gross: round2(gross) };
}

/** Posted entries inside the period, indexed by id. */
function postedEntriesIn(entries, period, filing) {
  const map = new Map();
  for (const e of entries || []) {
    // A reversed entry keeps counting; its mirror cancels it. Dropping one
    // side of a reversal would move the VAT figure by the full amount.
    if (e.status !== 'posted' && e.status !== 'reversed') continue;
    const date = String(e.entryDate || '').slice(0, 10);
    if (period && periodKeyFor(date, filing) !== period) continue;
    map.set(e.id, e);
  }
  return map;
}

/**
 * Movement on one VAT account across the posted entries of a period.
 *
 * `sign` is +1 for a liability that grows on the credit side (output tax,
 * 2100) and −1 for an asset that grows on the debit side (input tax, 1200),
 * so both come back as positive tax figures.
 *
 * `available: false` means the account has no posted movement at all — the
 * caller must not read that as "the ledger says zero", because an empty
 * ledger and a genuinely nil period are different facts.
 */
function ledgerTaxOn(entries, lines, { period, filing, account, sign }) {
  const posted = postedEntriesIn(entries, period, filing);
  let tax = 0;
  let found = false;
  for (const l of lines || []) {
    if (String(l.accountId) !== String(account)) continue;
    if (!posted.has(l.entryId)) continue;
    found = true;
    tax += sign * ((Number(l.credit) || 0) - (Number(l.debit) || 0));
  }
  return { tax: round2(tax), available: found };
}

/** ضريبة المخرجات المُرحّلة — a check on the figure derived from the washes. */
export function outputTaxFromLedger(entries, lines, { period, filing = 'quarterly', account = '2100' } = {}) {
  return ledgerTaxOn(entries, lines, { period, filing, account, sign: 1 });
}

/**
 * ضريبة المدخلات المُرحّلة — the same check on the purchase side.
 *
 * Input VAT sits on an ASSET account and grows on the debit side, so the sign
 * is inverted. Without this, a report could claim deductions the books have
 * never seen — the mirror of the output-side gap, and just as worth saying.
 */
export function inputTaxFromLedger(entries, lines, { period, filing = 'quarterly', account = '1200' } = {}) {
  return ledgerTaxOn(entries, lines, { period, filing, account, sign: -1 });
}

/** Source ids that already have a posted entry — used to spot what is not. */
export function postedSourceIds(entries) {
  const ids = new Set();
  for (const e of entries || []) {
    if (e.status === 'posted' && e.sourceId != null) ids.add(String(e.sourceId));
  }
  return ids;
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
  // The dated policy, and the posted entry behind a wash. Both optional so an
  // old caller still works; the page supplies both.
  policyAt = null, postedEntryOf = null,
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
      const s = inputInvoiceTax(row, { policyAt, rate });
      eligible.push({ ...row, claimDate: date, gross: s.gross, net: s.net, tax: s.vat, taxSource: s.source });
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
    (sum, r) => sum + inputInvoiceTax(r, { policyAt, rate }).vat, 0,
  ));

  // ── ضريبة المخرجات: الدفاتر هي المصدر ──
  // The posted movement on 2100 already contains everything: the washes that
  // were posted AND the credit/debit notes that adjusted them. Adding the
  // invoices to the washes would double the same sale, since an invoice
  // documents a wash that was already posted — so they are never summed
  // together. The wash figure is kept only as an INDEPENDENT check that says
  // how much has not reached the books yet.
  const operationalOutput = outputTaxFromWashes(washes, {
    period, filing, policyAt, postedEntryOf,
    vatRegistered, priceMode: washPriceMode, rate,
  });
  const ledgerOutput = outputTaxFromLedger(entries, lines, { period, filing });
  const ledgerInput  = inputTaxFromLedger(entries, lines, { period, filing });
  // Where the ledger has nothing at all, the operational figure is all there
  // is — and the report says which one it used.
  //
  // …unless the operational figure could not be computed either, because the
  // period predates the policy record. A number derived from today's switches
  // for a month nobody described is worse than no number: it looks filed.
  const policyGap = operationalOutput.unknownPolicy > 0 && !ledgerOutput.available;
  const output = ledgerOutput.available
    ? { ...operationalOutput, tax: ledgerOutput.tax, source: 'ledger' }
    : policyGap
      ? { ...operationalOutput, tax: 0, source: 'unknown-policy' }
      : { ...operationalOutput, source: 'operations' };

  // Eligible purchases the ledger has never seen. These are exactly the rows
  // that make the two input figures disagree, so the report names them rather
  // than leaving the user to hunt for the difference.
  const posted = postedSourceIds(entries);
  const unpostedEligible = eligible.filter((r) => !posted.has(String(r.id)));
  const unpostedInputTax = round2(unpostedEligible.reduce((sum, r) => sum + r.tax, 0));

  const netTax = round2(output.tax - inputTax);
  return {
    period,
    filing,
    vatRegistered,
    output,
    // Completed washes in the period whose date predates the policy record.
    // The page shows «السياسة التاريخية غير مهيأة» rather than a figure.
    unknownPolicyWashes: operationalOutput.unknownPolicy,
    policyUnconfigured: policyGap,
    operationalOutput,
    ledgerOutput,
    ledgerInput,
    // A difference between the two means some completed washes have not been
    // carried into the books yet. Named, not averaged.
    outputMismatch: ledgerOutput.available
      && Math.abs(round2(operationalOutput.tax - ledgerOutput.tax)) >= 0.01
      ? round2(operationalOutput.tax - ledgerOutput.tax)
      : 0,
    // The same check on the purchase side: claimed here, not in the books.
    inputMismatch: ledgerInput.available && Math.abs(round2(ledgerInput.tax - inputTax)) >= 0.01
      ? round2(inputTax - ledgerInput.tax)
      : 0,
    unpostedEligible,
    unpostedInputTax,
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
