import { buildVatReport, outputTaxFromWashes, periodKeyFor, periodRange, periodLabel } from './accounting/vatReturn';
import { taxPolicyAt, normalizeTaxPolicyHistory } from './accounting/taxPolicy';
import { round2 } from './accounting/journal';
import { APPROVED_SETTLEMENT_STATUSES } from './financeHome';

export const TAX_FILING_REPORT_ID = 'finance-2026-10-24-3-weekly-2026-10-18-2026-10-24';
export function vatPeriodLabel(period, language = 'ar') {
  if (language !== 'en') return periodLabel(period);
  const range = periodRange(period);
  if (!range.from) return period;
  const month = date => new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  return period.includes('-Q') ? `Q${period.at(-1)} ${period.slice(0, 4)} · ${month(range.from)} – ${month(range.to)}`
    : `${month(range.from)} ${period.slice(0, 4)}`;
}

// Last calendar day of the month following the period, including year rollover.
export function vatFilingDeadline(period) {
  if (!/^(\d{4}-Q[1-4]|\d{4}-(0[1-9]|1[0-2]))$/.test(period || '')) return null;
  const range = periodRange(period);
  if (!range) return null;
  const [year, month] = range.to.split('-').map(Number);
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}
export const vatDaysRemaining = (deadline, today) => Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

export function registeredVatPeriods(settings, today) {
  const first = normalizeTaxPolicyHistory(settings.taxPolicyHistory, settings).find(row => row.vatRegistered)?.effectiveFrom;
  if (!first || first > today) return [];
  const periods = [];
  const filing = settings.vatFilingPeriod || 'quarterly';
  let key = periodKeyFor(first, filing), current = periodKeyFor(today, filing);
  for (let guard = 0; key && key <= current && guard < 240; guard++) {
    periods.push(key);
    const end = periodRange(key).to;
    const next = new Date(`${end}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    key = periodKeyFor(next.toISOString().slice(0, 10), filing);
  }
  return periods;
}

// A bounded historical observation, not owner confirmation or a filing action.
// The reference must still exist in the pinned, saved tax report.
export function reportedVatFilings(report) {
  if (report?.reportId !== TAX_FILING_REPORT_ID || report.sourceRole !== 3) return {};
  const observation = report.visibleWarnings?.find(row => row.id === 'historical-q3');
  if (!observation?.text?.includes('65011830763') || !report.cases?.some(row => row.caseId === 'TAX-Q3-FILED-CREDIT-PRESENTATION-20261015')) return {};
  return { '2026-Q3': { status: 'reported', submittedAt: '2026-10-15', reference: '65011830763', reportId: report.reportId, reportDate: report.dateRiyadh } };
}

// Presentation only. The existing engine continues to own invoice eligibility,
// frozen purchase tax and wash tax. Approved settlement VAT REPLACES its own
// month's Sweater wash VAT; it is never added to that same supply twice.
export function buildVatDashboardReport({ inputs = [], washes = [], entries = [], lines = [], settlements = [], settings, period = '', filing = 'quarterly', today }) {
  const datedWashes = washes.filter(row => !today || row.washDate <= today);
  const datedEntries = entries.filter(row => !today || row.entryDate <= today);
  const datedInputs = inputs.filter(row => !today || !row.invoiceDate || row.invoiceDate <= today);
  const postedEntryOf = wash => datedEntries.find(entry => entry.status === 'posted' && !entry.reversalOf
    && (entry.sourceKind || entry.sourceType) === 'wash' && String(entry.sourceId) === String(wash.id));
  const options = { period, filing, policyAt: day => taxPolicyAt(day, settings), postedEntryOf,
    vatRegistered: settings.vatRegistered, washPriceMode: settings.washPriceMode };
  const base = buildVatReport({ inputs: datedInputs, washes: datedWashes, entries: datedEntries, lines, ...options });
  let tax = base.operationalOutput.tax;
  let gross = base.operationalOutput.gross, net = base.operationalOutput.net, count = base.operationalOutput.count;
  let settlementMonths = 0;
  const approved = settlements.filter(row => APPROVED_SETTLEMENT_STATUSES.has(row.status)
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.periodKey || '')
    && (!today || row.periodKey <= today.slice(0, 7))
    && (!period || periodKeyFor(`${row.periodKey}-01`, filing) === period));
  const duplicates = approved.some(row => approved.filter(other => other.periodKey === row.periodKey).length !== 1);
  const invalid = approved.some(row => ['vat', 'gross', 'net', 'count'].some(key => typeof row.figures?.services?.[key] !== 'number' || !Number.isFinite(row.figures.services[key]) || row.figures.services[key] < 0));
  if (!duplicates && !invalid) for (const row of approved) {
    const monthWashes = datedWashes.filter(wash => wash.revenueOrigin === 'sweater' && wash.washDate?.startsWith(`${row.periodKey}-`));
    const replaced = outputTaxFromWashes(monthWashes, { ...options, period: row.periodKey, filing: 'monthly' });
    tax = round2(tax - replaced.tax + row.figures.services.vat); settlementMonths++;
    gross = round2(gross - replaced.gross + row.figures.services.gross);
    net = round2(net - replaced.net + row.figures.services.net);
    count = count - replaced.count + row.figures.services.count;
  }
  const output = { ...base.operationalOutput, tax, gross, net, count, source: settlementMonths ? 'settlement-and-operations' : 'operations' };
  const netTax = round2(tax - base.input.tax);
  // Undated documents cannot belong to a selected quarter. Keep them visible
  // separately rather than charging their counts/amounts to every quarter.
  const unassigned = base.ineligible.filter(row => !row.claimDate);
  const ineligible = base.ineligible.filter(row => row.claimDate);
  return { ...base, output, operationalOutput: output, netTax,
    direction: netTax > 0.005 ? 'payable' : netTax < -0.005 ? 'refundable' : 'nil',
    outputMismatch: round2(tax - base.ledgerOutput.tax), ineligible, unassigned,
    forfeitedTax: round2(ineligible.reduce((sum, row) => sum + (row.documentVat || 0), 0)),
    outputUnavailable: duplicates || invalid || base.unknownPolicyWashes > 0, settlementMonths };
}

export function groupVatGaps(rows) {
  const reasons = new Map(), suppliers = new Map();
  const add = (map, key, row) => {
    if (!map.has(key)) map.set(key, { key, count: 0, amount: 0, tax: 0, rows: [] });
    const group = map.get(key); group.count++; group.amount = round2(group.amount + (Number(row.amount) || 0));
    group.tax = round2(group.tax + (Number(row.documentVat) || 0)); group.rows.push(row);
  };
  for (const row of rows) {
    // One document may lack several things: reason groups overlap explicitly.
    for (const reason of new Set(row.missing?.length ? row.missing : ['بيانات الفاتورة ناقصة'])) add(reasons, reason, row);
    add(suppliers, row.supplier?.trim() || 'المورّد غير محدد', row);
  }
  return { reasons: [...reasons.values()].sort((a, b) => b.tax - a.tax || b.count - a.count),
    suppliers: [...suppliers.values()].sort((a, b) => b.tax - a.tax || b.count - a.count) };
}
