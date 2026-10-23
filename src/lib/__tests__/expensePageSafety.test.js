import { it, expect } from 'vitest';
import { paidWithoutEntries, paymentParentIds, planHasFinancialHistory, riskyAdvances, advanceBikerState, ownerAdvanceTaskComplete } from '../expensePageSafety';
import { OWNER_ADVANCE_MONTH_PLAN as PLAN } from '../advanceMonth';
it('warns on paid/completed status without payments, not on an empty pending plan or double-counted parent totals', () => {
  const items = [{ id: 'empty-paid', paymentStatus: 'paid' }, { id: 'with-payment', paymentStatus: 'paid', actualAmount: 100 }, { id: 'empty-pending', paymentStatus: 'pending' }];
  const ids = paymentParentIds([{ annualExpenseId: 'with-payment' }], 'annual');
  expect(paidWithoutEntries(items, ids, 'annual').map(row => row.id)).toEqual(['empty-paid']);
  expect(paidWithoutEntries([{ id: 'legacy', status: 'completed', actualAmount: 100 }], new Set(), 'startup')).toHaveLength(1);
  expect(planHasFinancialHistory(items[1], ids)).toBe(true); expect(planHasFinancialHistory(items[2], ids)).toBe(false);
});
it('flags departed and deleted linked bikers only; subtracts recovered amounts and never infers identity from a title', () => {
  const bikers = [{ id: 'left', currentStatus: 'هرب مع الاجهزة' }, { id: 'dismissed', currentStatus: 'مشيناه' }, { id: 'working', currentStatus: 'شغال' }];
  const expenses = [{ id: '1', bikerId: 'left', amount: 100, recoveredAmount: 30, status: 'pending' },
    { id: '2', bikerId: 'dismissed', amount: 50, status: 'pending' }, { id: '3', bikerId: 'deleted', amount: 20, status: 'pending' },
    { id: '4', bikerId: 'left', amount: 10, status: 'recovered' }, { id: '5', title: 'سلفة هارب', amount: 100, status: 'pending' },
    { id: '6', bikerId: 'working', amount: 99, status: 'pending' }];
  expect(riskyAdvances(expenses, bikers)).toMatchObject({ count: 3, amount: 140 }); expect(advanceBikerState(expenses[4], bikers).risky).toBe(false);
});
it('folds the past owner task only when every original row explicitly has the requested assignment month', () => {
  const rows = PLAN.rows.map(([id]) => ({ id, assignmentMonth: '2026-09', assignmentMonthExplicit: true }));
  expect(ownerAdvanceTaskComplete(rows)).toBe(true); expect(ownerAdvanceTaskComplete(rows.slice(1))).toBe(false);
  expect(ownerAdvanceTaskComplete(rows.map((row, i) => i ? row : { ...row, assignmentMonthExplicit: false }))).toBe(false);
  expect(ownerAdvanceTaskComplete(rows.map((row, i) => i ? row : { ...row, assignmentMonth: '2026-10' }))).toBe(false);
});
