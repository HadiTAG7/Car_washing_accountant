import { it, expect } from 'vitest';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { annualPlanAction } from '../src/annualPlans.js';
import { dispatch } from '../src/handlers.js';
import { postingLockId } from '../src/invariants.js';
const FV = { serverTimestamp: () => 'test-time' }, who = { userId: 'test-admin', role: 'admin' };
const parent = { expense_name: 'خطة اختبار معزولة', annual_cost: 100, actual_amount: 0, payment_status: 'pending' };
const dbFor = extra => memoryFinanceDb({ 'annual_expenses/p1': { ...parent }, 'users/test-admin': { role: 'admin' }, ...extra });
const update = { action: 'update', parentId: 'p1', patch: { payment_status: 'paid' }, reason: 'سبب اختبار موثق', confirmed: true };
it('requires confirmation and reason, rejects derived actual/tax fields, and never changes money on a failed request', async () => {
  for (const input of [{ ...update, confirmed: false }, { ...update, reason: '' }, { ...update, patch: { actual_amount: 999 } }, { ...update, patch: { annual_cost: Infinity } }]) {
    const db = dbFor(); await expect(annualPlanAction(db, FV, input, who)).rejects.toThrow(); expect(db.rows.get('annual_expenses/p1')).toEqual(parent); expect([...db.rows.keys()].some(key => key.startsWith('audit_logs/'))).toBe(false);
  }
});
it('audits before/after and reason atomically without a payment or journal, with stale-confirmation protection', async () => {
  const db = dbFor(), input = { ...update, expected: { payment_status: 'pending', annual_cost: 100 } };
  await dispatch(db, FV, 'annualPlanAction', input, { uid: 'test-admin' });
  expect(db.rows.get('annual_expenses/p1')).toEqual({ ...parent, payment_status: 'paid' });
  const audit = [...db.rows].find(([key]) => key.startsWith('audit_logs/'))[1];
  expect(audit).toMatchObject({ reason: update.reason, before: parent, after: { ...parent, payment_status: 'paid' } });
  expect([...db.rows.keys()].filter(key => /^(journal_entries|annual_expense_entries)\//.test(key))).toEqual([]);
  await expect(annualPlanAction(db, FV, input, who)).rejects.toThrow(/تغيرت الخطة/);
});
it('refuses deletion with any payment, stored actual, posted or reversed journal, or lock; it never cascades', async () => {
  for (const extra of [{ 'annual_expense_entries/e1': { annual_expense_id: 'p1', amount: 0 } },
    { 'annual_expenses/p1': { ...parent, actual_amount: 1 } }, { 'journal_entries/j1': { sourceId: 'p1', status: 'posted' } },
    { 'journal_entries/j1': { sourceId: 'p1', status: 'reversed' } }, { [`posting_locks/${postingLockId('annual', 'p1')}`]: {} }, { [`posting_locks/${postingLockId('expense', 'p1')}`]: {} }]) {
    const db = dbFor(extra), before = JSON.stringify([...db.rows]);
    await expect(annualPlanAction(db, FV, { action: 'delete', parentId: 'p1', confirmed: true }, who)).rejects.toThrow(/الحذف ممنوع/);
    expect(JSON.stringify([...db.rows])).toBe(before);
  }
});
it('deletes only an unused explicitly confirmed plan and retains its audit', async () => {
  const db = dbFor(); await expect(annualPlanAction(db, FV, { action: 'delete', parentId: 'p1' }, who)).rejects.toThrow(/تأكيد/);
  await annualPlanAction(db, FV, { action: 'delete', parentId: 'p1', confirmed: true }, who);
  expect(db.rows.has('annual_expenses/p1')).toBe(false); expect([...db.rows.values()].some(row => row.action === 'annual-plan-delete' && row.before.annual_cost === 100)).toBe(true);
});
it('does not grant a partner or supervisor access through the new UI handler', async () => {
  for (const role of ['partner', 'supervisor']) {
    const db = dbFor({ 'users/test-user': { role } });
    await expect(dispatch(db, FV, 'annualPlanAction', update, { uid: 'test-user' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.rows.get('annual_expenses/p1')).toEqual(parent);
  }
});
