import { buildVatReport, outputTaxFromWashes, periodKeyFor, periodRange } from './vatReturn.js';
import { taxPolicyAt } from './taxPolicy.js';
import { isRealCalendarDate } from '../vatFields.js';

const round = n => Math.round(n * 100) / 100;
const APPROVED = new Set(['approved', 'invoiced', 'partially_collected', 'collected', 'closed']);

export function riyadhDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Calendar deadline, not an instant; Q4 correctly rolls into the next year. */
export function declarationDeadline(period) {
  if (!/^\d{4}-(Q[1-4]|0[1-9]|1[0-2])$/.test(String(period))) return null;
  const { to } = periodRange(period);
  const [year, month] = to.split('-').map(Number);
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}

export function daysToDeadline(deadline, today = riyadhDay()) {
  if (!isRealCalendarDate(deadline) || !isRealCalendarDate(today)) return null;
  return Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

/** Only dated, explicitly registered history establishes the first period. */
export function registeredPeriods(settings, today = riyadhDay(), filing = 'quarterly') {
  const history = settings.taxPolicyHistory || [];
  const first = history.filter(p => p.vatRegistered === true && isRealCalendarDate(p.effectiveFrom) && p.effectiveFrom <= today)
    .map(p => p.effectiveFrom).sort()[0];
  if (!first) return [];
  const from = new Date(`${first.slice(0, 7)}-01T00:00:00Z`);
  const end = today.slice(0, 7); const periods = new Set();
  while (from.toISOString().slice(0, 7) <= end) {
    const month = from.toISOString().slice(0, 7);
    const last = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    // Include a month if any registration segment overlaps it, including a mid-month change.
    const dates = [`${month}-01`, last, ...history.map(p => p.effectiveFrom).filter(d => d >= `${month}-01` && d <= last)];
    if (dates.some(d => d <= today && taxPolicyAt(d, settings).vatRegistered === true)) periods.add(periodKeyFor(month, filing));
    from.setUTCMonth(from.getUTCMonth() + 1);
  }
  return [...periods];
}

/** Display-only basis. The shared filing/ledger engine and frozen entries stay untouched. */
export function buildVatDashboardReport({ settlements = [], ...options } = {}) {
  const base = buildVatReport(options);
  const { period = '', filing = 'quarterly', washes = [] } = options;
  const approved = settlements.filter(s => APPROVED.has(s.status)
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(s.periodKey)
    && (!period || periodKeyFor(`${s.periodKey}-01`, filing) === period));
  const months = new Set(approved.map(s => s.periodKey));
  const remaining = washes.filter(w => !(w.revenueOrigin === 'sweater' && months.has(String(w.washDate).slice(0, 7))));
  // One SSP month is represented by its approved settlement OR local SSP washes, never both.
  const output = outputTaxFromWashes(remaining, { period, filing, policyAt: options.policyAt,
    postedEntryOf: options.postedEntryOf, vatRegistered: options.vatRegistered, priceMode: options.washPriceMode });
  let invalidSettlements = 0;
  for (const settlement of approved) {
    const service = settlement.figures?.services;
    if (!service || !['gross', 'net', 'vat'].every(k => typeof service[k] === 'number' && Number.isFinite(service[k]))) {
      invalidSettlements += 1; continue;
    }
    output.gross = round(output.gross + service.gross);
    output.net = round(output.net + service.net);
    output.tax = round(output.tax + service.vat);
    output.count += Number(service.count) || 0;
  }
  const inPeriod = row => {
    const date = row.claimDate || row.invoiceDate || row.spentDate;
    return !period || (isRealCalendarDate(date) && periodKeyFor(date, filing) === period);
  };
  const undated = [...base.ineligible, ...base.unresolved, ...base.needsConversion]
    .filter(r => !isRealCalendarDate(r.claimDate || r.invoiceDate || r.spentDate));
  const ineligible = base.ineligible.filter(inPeriod);
  const unresolved = base.unresolved.filter(inPeriod);
  const needsConversion = base.needsConversion.filter(inPeriod);
  const netTax = round(output.tax - base.input.tax);
  return { ...base, output: { ...output, source: approved.length ? 'settlements-and-washes' : 'operations' },
    operationalOutput: output, ineligible, unresolved, needsConversion, undated, invalidSettlements,
    unresolvedCount: unresolved.length, unresolvedGross: round(unresolved.reduce((n,r) => n + r.gross,0)),
    needsConversionCount: needsConversion.length,
    needsConversionAmount: round(needsConversion.reduce((n,r) => n + r.amount,0)),
    needsConversionTax: round(needsConversion.reduce((n,r) => n + (r.pendingTax || 0),0)),
    forfeitedTax: round(ineligible.reduce((n,r) => n + (r.documentVat || 0),0)),
    outputMismatch: round(output.tax - base.ledgerOutput.tax),
    inputMismatch: round(base.input.tax - base.ledgerInput.tax),
    policyUnconfigured: output.unknownPolicy > 0 || unresolved.length > 0 || invalidSettlements > 0,
    netTax, direction: netTax > 0 ? 'payable' : netTax < 0 ? 'refundable' : 'nil' };
}

/** Reasons may overlap; supplier totals count each document once. Never invent missing VAT. */
export function invoiceFollowUp(report) {
  const reasons = new Map(); const suppliers = new Map();
  for (const row of report.ineligible) {
    const missing = row.missing?.length ? row.missing : ['نواقص أخرى'];
    for (const reason of new Set(missing)) {
      if (!reasons.has(reason)) reasons.set(reason, { reason, count: 0, amount: 0, rows: [] });
      const group = reasons.get(reason); group.count += 1; group.amount = round(group.amount + (Number(row.amount) || 0)); group.rows.push(row);
    }
    const supplier = String(row.supplier || '').trim() || 'المورّد غير مسجّل';
    if (!suppliers.has(supplier)) suppliers.set(supplier, { supplier, count: 0, tax: 0, unknownTax: 0 });
    const group = suppliers.get(supplier); group.count += 1;
    // An unmarked receipt with no stated tax is unknown, not zero and not a 15% estimate.
    const stated = row.vatAmount ?? (row.isTaxInvoice ? row.documentVat : null);
    if (typeof stated === 'number' && Number.isFinite(stated)) group.tax = round(group.tax + stated);
    else group.unknownTax += 1;
  }
  return { reasons: [...reasons.values()].sort((a,b) => b.amount - a.amount),
    suppliers: [...suppliers.values()].sort((a,b) => b.count - a.count) };
}
