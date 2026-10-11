import { describe, expect, it } from 'vitest';
import { liveIncomeStatement } from '../liveIncomeStatement.js';
import { partnerOperatingStatement } from '../partnerOperatingStatement.js';
import { DEFAULT_CHART_OF_ACCOUNTS as accounts } from '../chartOfAccounts.js';
import { monthlyStatement } from '../monthlyStatement.js';

const periodKey = '2026-10';
const preview = { periodKey, estimated: true, lines: [
  { bikerId: 'private-a', name: 'Private salary worker', basicDue: 900, bonus: 100, deduction: 50, commission: 45, advanceDeduction: 200 },
  { bikerId: 'private-b', basicDue: 900 },
] };
const entry = (amount, extra = {}) => ({ id: 'paid', status: 'posted', sourceType: 'payroll', sourceId: '2026-10__r1',
  entryDate: '2026-11-01', payrollSnapshot: { periodKey, totals: { basic: amount } },
  lines: [{ accountId: '5010', debit: amount, credit: 0 }, { accountId: '1020', debit: 0, credit: amount }], ...extra });
const opts = (entries = [], payrollPreview = preview, extra = {}) => ({ accounts, periodKey, feeRules: [{ key: 'none', rate: 0 }],
  entries, lines: entries.flatMap(e => e.lines.map((l, i) => ({ ...l, id: `${e.id}:${i}`, entryId: e.id }))),
  sources: { payrollPreviews: [payrollPreview] }, payrollPreview, ...extra });

describe('owner-authorized salary accrual in management income, without journal writes', () => {
  it('recognizes unpaid salary plus bonus minus wage deduction, never commissions or recovered advances', () => {
    const input = opts(); const frozen = structuredClone(input);
    const st = liveIncomeStatement(input);
    expect(st.totalCosts).toBe(1850);
    expect(st.expenseBreakdown.groups.find(g => g.key === 'monthly').amount).toBe(1850);
    expect(st.salaryAccrual).toMatchObject({ amount: 1850, unposted: 1850, estimated: true });
    expect(monthlyStatement(input).totalCosts).toBe(0);
    expect(st.details.totalCosts.reconciledTotal).toBe(1850);
    expect(input).toEqual(frozen);
  });
  it.each([950, 1850])('payment of %s replaces only the recognized salary, including partial payments', amount => {
    const st = liveIncomeStatement(opts([entry(amount)]));
    expect(st.totalCosts).toBe(1850);
    expect(st.salaryAccrual.unposted).toBe(1850 - amount);
    expect(st.expenseBreakdown.total).toBe(1850);
  });
  it('keeps paid salary frozen to the saved run, not a subsequent worker salary edit', () => {
    const paid = { ...preview, snapshotOnly: true, estimated: false, lines: [{ basicDue: 1000, status: 'paid' }] };
    expect(liveIncomeStatement(opts([entry(1000)], paid)).totalCosts).toBe(1000);
  });
  it('recognizes only the earned month, not the cash payment month', () => {
    expect(liveIncomeStatement(opts([entry(950)])).totalCosts).toBe(1850);
    expect(liveIncomeStatement(opts([entry(950)], { periodKey: '2026-11', lines: [] }, { periodKey: '2026-11' })).totalCosts).toBe(0);
  });
  it('a reversed payment leaves the unpaid wage obligation, without reversing cash or restoring advances in the report', () => {
    const original = entry(950, { status: 'reversed' });
    const mirror = entry(950, { id: 'mirror', sourceType: 'payroll_reversal', reversalOf: original.id,
      lines: [{ accountId: '5010', credit: 950 }, { accountId: '1020', debit: 950 }] });
    expect(liveIncomeStatement(opts([original, mirror])).totalCosts).toBe(1850);
  });
  it('applies partner allocation to the same wage obligation, not paid cash, and returns no worker identity', () => {
    for (const entries of [[], [entry(950)], [entry(1850)]]) {
      const st = partnerOperatingStatement(opts(entries, preview, { scalingFactor: 0.2 }));
      expect(st.totalCosts).toBe(370);
      expect(st.salaryAccrual.amount).toBe(370);
      expect(st.expenseBreakdown.groups.find(g => g.key === 'monthly').amount).toBe(370);
      expect(JSON.stringify(st)).not.toMatch(/Private salary worker|private-a|private-b/);
      expect(partnerOperatingStatement(opts(entries, preview, { scalingFactor: 0 })).totalCosts).toBe(0);
    }
  });
  it('does not subtract unrelated operating costs or another earned month payroll', () => {
    const other = entry(400, { id: 'other', sourceId: '2026-09__r1', payrollSnapshot: { periodKey: '2026-09' } });
    const rent = entry(100, { id: 'rent', sourceType: 'monthly', sourceId: 'rent', entryDate: '2026-10-03',
      lines: [{ accountId: '5200', debit: 100 }, { accountId: '1020', credit: 100 }] });
    expect(liveIncomeStatement(opts([other, rent])).totalCosts).toBe(1950);
  });
  it('rejects missing periods, malformed components, ambiguous legacy wages and payroll above the authoritative total', () => {
    expect(() => liveIncomeStatement(opts([], { ...preview, lines: [{ basicDue: NaN }] }))).toThrow();
    expect(() => liveIncomeStatement(opts([entry(1900)]))).toThrow();
    expect(() => liveIncomeStatement(opts([entry(900, { sourceId: 'unknown', payrollSnapshot: null })]))).toThrow();
    expect(() => liveIncomeStatement(opts([], preview, { sources: { payrollPreviews: [preview], monthlies: [
      { id: 'legacy', expense_name: 'راتب قديم', recurrence: 'one_time', logged_date: '2026-10-01', total_monthly_cost: 900 },
    ] } }))).toThrow(/رواتب|راتب/);
  });
});
