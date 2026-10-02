import { describe, expect, it } from 'vitest';
import { comparePartnerReports } from '../partnerReportComparison.js';

const row = (periodKey, value) => ({ periodKey, netRevenue: value, totalCosts: value / 2,
  annualReserve: 5, totalFees: 2, netAfterReserve: value / 2 - 7,
  expenseBreakdown: { groups: [{ key: 'variable', amount: value / 4 }, { key: 'monthly', amount: value / 4 }, { key: 'other', amount: 0 }] } });

describe('partner report comparison uses scoped server results only', () => {
  it('compares monthly amounts, preserving signs and rounding, without reallocation', () => {
    const statements = [row('2026-08', 100.12), row('2026-07', -10.14)];
    const before = JSON.stringify(statements);
    const result = comparePartnerReports({ statements, mode: 'month', first: '2026-08', second: '2026-07' });
    expect(result.differences.netRevenue).toBe(110.26);
    expect(result.first.values.totalCosts).toBe(50.06);
    expect(result.second.values.netAfterReserve).toBe(-12.07);
    expect(result.comparable).toBe(true);
    expect(JSON.stringify(statements)).toBe(before);
  });
  it('keeps a verified zero distinct from an unavailable month or missing metric', () => {
    const result = comparePartnerReports({ statements: [{ periodKey: '2026-08', netRevenue: 0 }],
      mode: 'month', first: '2026-08', second: '2026-07' });
    expect(result.first.values.netRevenue).toBe(0);
    expect(result.first.values.totalCosts).toBeNull();
    expect(result.second.values.netRevenue).toBeNull();
    expect(result.differences.netRevenue).toBeNull();
  });
  it('compares the same months annually and does not annualise partial data', () => {
    const statements = [row('2026-01', 100), row('2026-02', 200), row('2025-01', 50), row('2025-02', 100), row('2025-03', 999)];
    const result = comparePartnerReports({ statements, mode: 'year', first: '2026', second: '2025', throughMonth: 2 });
    expect(result.first.values.netRevenue).toBe(300);
    expect(result.second.values.netRevenue).toBe(150);
    expect(result.differences.netRevenue).toBe(150);
    expect(result.first.complete).toBe(true);
  });
  it('does not present a difference when the yearly data covers different months', () => {
    const result = comparePartnerReports({ statements: [row('2026-01', 100), row('2025-02', 200)],
      mode: 'year', first: '2026', second: '2025', throughMonth: 2 });
    expect(result.first.values.netRevenue).toBe(100);
    expect(result.first.complete).toBe(false);
    expect(result.first.missing).toEqual(['2026-02']);
    expect(result.second.missing).toEqual(['2025-01']);
    expect(result.comparable).toBe(false);
    expect(result.differences.netRevenue).toBeNull();
  });
  it('rejects duplicate periods and invalid values instead of double counting or coercing to zero', () => {
    const result = comparePartnerReports({ statements: [row('2026-01', 1), row('2026-01', 2), row('2025-01', Infinity)],
      mode: 'year', first: '2026', second: '2025', throughMonth: 1 });
    expect(result.first.complete).toBe(false);
    expect(result.first.values.netRevenue).toBeNull();
    expect(result.second.values.netRevenue).toBeNull();
  });
});
