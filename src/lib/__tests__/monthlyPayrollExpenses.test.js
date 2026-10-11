import { expect, it } from 'vitest';
import { monthlyPayrollExpenses, monthlyItemsForPeriod, hasManualSalaryRows } from '../monthlyPayrollExpenses';
it('shows salary expense before payment without commissions or advance double counting', () => {
  const input = { periodKey: '2026-10', estimated: true, lines: [
    { bikerId: 'a', name: 'A', basicDue: 900, bonus: 20, deduction: 10, commission: 100, advanceDeduction: 300, netDue: 710, payDate: 'invented-date' },
    { bikerId: 'b', name: 'B', basicDue: 450, status: 'paid', payDate: '2026-11-01' },
  ] };
  const before = structuredClone(input);
  const view = monthlyPayrollExpenses(input, '2026-10');
  expect(view).toMatchObject({ total: 1360, paid: 450, pending: 910, estimated: true });
  expect(view.rows[0]).toMatchObject({ amount: 910, paid: false, payDate: null });
  expect(view.rows[1].payDate).toBe('2026-11-01'); expect(input).toEqual(before);
});
it('preserves paid snapshots and zero activity without repricing the payroll', () => {
  expect(monthlyPayrollExpenses({ periodKey: '2026-09', snapshotOnly: true, lines: [{ basicDue: 100, status: 'paid' }] }, '2026-09'))
    .toMatchObject({ total: 100, paid: 100, pending: 0, snapshotOnly: true });
  expect(monthlyPayrollExpenses({ periodKey: '2026-10', lines: [] }, '2026-10').total).toBe(0);
});
it('rejects unavailable, wrong-month and malformed amounts rather than presenting a verified zero', () => {
  expect(() => monthlyPayrollExpenses(null, '2026-10')).toThrow();
  expect(() => monthlyPayrollExpenses({ periodKey: '2026-09', lines: [] }, '2026-10')).toThrow();
  for (const basicDue of [NaN, Infinity, -1]) expect(() => monthlyPayrollExpenses({ periodKey: '2026-10', lines: [{ basicDue }] }, '2026-10')).toThrow();
});
it('selects one-off expenses by month and detects legacy salary ambiguity before adding payroll', () => {
  const rows = [{ expenseName: 'STC', recurrence: 'one_time', loggedDate: '2026-09-23' },
    { expenseName: 'STC', recurrence: 'one_time', loggedDate: '2026-10-07' },
    { expenseName: 'Rent', recurrence: 'monthly' }];
  expect(monthlyItemsForPeriod(rows, '2026-10')).toEqual(rows.slice(1));
  expect(hasManualSalaryRows(rows)).toBe(false);
  expect(hasManualSalaryRows([{ expenseName: 'راتب عامل' }])).toBe(true);
  expect(hasManualSalaryRows([{ categoryId: 'salary' }], [{ id: 'salary', label: 'رواتب وأجور' }])).toBe(true);
});
