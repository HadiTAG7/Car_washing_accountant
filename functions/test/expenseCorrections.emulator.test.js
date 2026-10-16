import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { dispatch } from '../src/handlers.js';
if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== 'demo-sweater') throw Error('Only isolated demo-sweater emulator is allowed');
let app, db;
beforeAll(() => { app = initializeApp({ projectId: 'demo-sweater' }, 'mcp-corrections-test'); db = getFirestore(app); });
afterAll(async () => { await deleteApp(app); });
beforeEach(async () => {
  for (const name of ['users', 'app_admins', 'variable_expenses', 'startup_costs', 'startup_cost_entries', 'annual_expenses', 'annual_expense_entries', 'journal_entries', 'posting_locks', 'accounting_periods', 'audit_logs', 'mcp_mutation_receipts', 'bikers', 'temporary_expenses', 'payroll_runs']) await db.recursiveDelete(db.collection(name));
  await db.collection('users').doc('test-admin').set({ role: 'admin' });
  await db.collection('variable_expenses').doc('test-expense').set({ expense_name: 'Synthetic expense', total_variable_cost: 665.05, quantity: 1, unit_cost: 665.05, logged_date: '2026-09-12', is_tax_invoice: false });
  await db.collection('startup_costs').doc('test-parent').set({ item_name: 'Synthetic bikes', budgeted_amount: 1000, actual_amount: 0 });
  await db.collection('bikers').doc('test-worker').set({ name: 'Synthetic worker' });
});
const invoke = (name, data, uid = 'test-admin') => dispatch(db, FieldValue, name, data, { uid });
const correction = { kind: 'variable', sourceId: 'test-expense', targetKind: 'startup', targetParentId: 'test-parent', patch: { quantity: 50 }, reason: 'Synthetic owner correction' };
it('real Firestore query transaction moves once, synchronizes parent and safely replays concurrently', async () => {
  const p = await invoke('expensePreviewCorrection', correction);
  const request = { ...correction, previewHash: p.previewHash, confirm: true };
  const results = await Promise.all([invoke('expenseSaveCorrection', request), invoke('expenseSaveCorrection', request)]);
  expect(results.every(r => r.saved)).toBe(true); expect(results.filter(r => r.replay)).toHaveLength(1);
  expect((await db.collection('variable_expenses').doc('test-expense').get()).exists).toBe(false);
  expect((await db.collection('startup_cost_entries').get()).size).toBe(1);
  expect((await db.collection('audit_logs').get()).size).toBe(1);
  expect((await db.collection('startup_costs').doc('test-parent').get()).data().actual_amount).toBe(665.05);
});
it('real source changes, new sibling and posting lock invalidate plans without source mutation', async () => {
  const p = await invoke('expensePreviewCorrection', correction);
  await db.collection('startup_cost_entries').doc('test-other').set({ startup_cost_id: 'test-parent', amount: 10 });
  await expect(invoke('expenseSaveCorrection', { ...correction, previewHash: p.previewHash, confirm: true })).rejects.toThrow(/تغيّر/);
  await db.collection('posting_locks').doc('variable__test-expense').set({ entryId: 'test-journal' });
  await expect(invoke('expensePreviewCorrection', correction)).rejects.toThrow(/مرحّل/);
  expect((await db.collection('audit_logs').get()).empty).toBe(true);
  expect((await db.collection('variable_expenses').doc('test-expense').get()).exists).toBe(true);
});
it('different idempotency keys cannot create two identical advances under concurrent writes', async () => {
  const request = { bikerId: 'test-worker', amount: 33, spentDate: '2026-10-01', assignmentMonth: '2026-09', paymentMethod: 'cash', description: 'Synthetic paid advance', confirm: true };
  const results = await Promise.allSettled(['test-1', 'test-2'].map(requestId => invoke('workerRecordAdvance', { ...request, requestId })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')[0].reason.code).toBe('already-exists');
  expect((await db.collection('temporary_expenses').get()).size).toBe(1);
  expect((await db.collection('audit_logs').get()).size).toBe(1);
});
it('stored role revocation overrides payload claims', async () => {
  await db.collection('users').doc('test-admin').set({ role: 'supervisor' });
  await expect(invoke('expensePreviewCorrection', { ...correction, role: 'admin' })).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await db.collection('audit_logs').get()).empty).toBe(true);
});
it('read tools expose verified identifiers and payment state with no writes', async () => {
  await db.collection('payroll_runs').doc('test-run').set({ periodKey: '2026-09', status: 'draft', totals: { net: 700 } });
  await db.collection('payroll_runs').doc('test-run').collection('items').doc('test-worker').set({ bikerId: 'test-worker', name: 'Synthetic worker', status: 'draft', netDue: 700, advanceDeduction: 33 });
  const options = await invoke('expenseCorrectionOptions', {});
  expect(options.startup.records).toContainEqual(expect.objectContaining({ id: 'test-parent', name: 'Synthetic bikes' }));
  expect(await invoke('payrollReadStatus', { periodKey: '2026-09', runId: 'test-run' })).toMatchObject({ runsTruncated: false, runs: [{ id: 'test-run', itemsTruncated: false, items: [{ bikerId: 'test-worker', netDue: 700 }] }] });
  await expect(invoke('payrollReadStatus', { periodKey: '2026-08', runId: 'test-run' })).rejects.toMatchObject({ code: 'invalid-argument' });
  expect((await db.collection('audit_logs').get()).empty).toBe(true);
});
