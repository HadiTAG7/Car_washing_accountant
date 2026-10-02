import { round2 } from './journal.js';

export const COMPARISON_FIELDS = ['netRevenue', 'variable', 'monthly', 'other', 'totalCosts', 'totalFees', 'annualReserve', 'netAfterReserve'];
export const validReportMonth = key => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(key));

const read = (row, field) => ['variable', 'monthly', 'other'].includes(field)
  ? row.expenseBreakdown?.groups?.find(group => group.key === field)?.amount : row[field];

// Presentation only: sum already allocated, rounded server amounts. Missing
// reports/fields are unknown, never converted to zero or extrapolated.
export function comparePartnerReports({ statements = [], mode = 'month', first, second, throughMonth = 12 }) {
  const limit = Math.max(1, Math.min(12, Number(throughMonth) || 12));
  const rows = new Map();
  for (const row of statements) {
    if (!validReportMonth(row?.periodKey)) continue;
    rows.set(row.periodKey, rows.has(row.periodKey) ? null : row);
  }
  const summarize = period => {
    const expected = mode === 'year' && /^\d{4}$/.test(String(period))
      ? Array.from({ length: limit }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`)
      : mode === 'month' && validReportMonth(period) ? [period] : [];
    const available = expected.filter(key => rows.get(key));
    const values = Object.fromEntries(COMPARISON_FIELDS.map(field => {
      const numbers = available.map(key => read(rows.get(key), field));
      return [field, numbers.length && numbers.every(Number.isFinite)
        ? round2(numbers.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100) : null];
    }));
    return { period, expected, available, missing: expected.filter(key => !rows.get(key)), values,
      complete: expected.length > 0 && available.length === expected.length };
  };
  const a = summarize(first); const b = summarize(second);
  const comparable = a.available.length > 0 && b.available.length > 0 && (mode === 'month'
    || a.available.map(key => key.slice(5)).join() === b.available.map(key => key.slice(5)).join());
  return { first: a, second: b, comparable,
    differences: Object.fromEntries(COMPARISON_FIELDS.map(field => [field,
      comparable && a.values[field] != null && b.values[field] != null ? round2(a.values[field] - b.values[field]) : null])),
  };
}
