import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { approvePayroll, payPayroll, previewPayrollPreapproval, savePayrollDraft } from '../src/payroll.js';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Local demo emulator required');
const suite = host ? describe : describe.skip;
const now = new Date('2026-11-01T09:00:00Z');
let app, db;
suite('payroll preapproval transactional guards — synthetic demo only', () => {
  beforeAll(() => { app = initializeApp({ projectId: 'demo-sweater' }, 'payroll-preapproval'); db = getFirestore(app); });
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => {
    for (const name of ['bikers', 'washes', 'temporary_expenses', 'payroll_runs', 'payroll_periods', 'audit_logs', 'users', 'app_admins', 'journal_entries']) {
      const snap = await db.collection(name).get();
      for (const doc of snap.docs) await db.recursiveDelete(doc.ref);
    }
    await db.collection('bikers').doc('b1').set({ name: 'Synthetic worker', salary: 900, start_date: '2026-08-01', current_status: 'هرب' });
    await db.collection('users').doc('admin').set({ role: 'admin' });
    await db.collection('users').doc('acct').set({ role: 'accountant' });
  }, 60000);
  const draft = () => savePayrollDraft(db, FieldValue, { periodKey: '2026-10' }, { userId: 'admin', now });
  it('read preview writes nothing and rejection leaves draft, advances and journals unchanged', async () => {
    const read = await previewPayrollPreapproval(db, { periodKey: '2026-10' }, { now });
    expect(read.missingEndDates.count).toBe(1);
    expect((await db.collection('payroll_runs').get()).empty).toBe(true);
    expect((await db.collection('audit_logs').get()).empty).toBe(true);
    const d = await draft(); const before = (await db.collection('payroll_runs').doc(d.runId).get()).data();
    await expect(approvePayroll(db, FieldValue, { runId: d.runId }, { userId: 'admin', now })).rejects.toThrow(/بلا تاريخ نهاية/);
    expect((await db.collection('payroll_runs').doc(d.runId).get()).data()).toEqual(before);
    expect((await db.collection('journal_entries').get()).empty).toBe(true);
  });
  it('only stored admin can override; persists reason, evidence and audit without journal', async () => {
    const d = await draft();
    await expect(approvePayroll(db, FieldValue, { runId: d.runId, overrideReason: 'Owner review', role: 'admin' }, { userId: 'acct', now })).rejects.toThrow(/للمدير فقط/);
    const result = await approvePayroll(db, FieldValue, { runId: d.runId, overrideReason: 'Owner verified service' }, { userId: 'admin', now });
    expect(result.status).toBe('approved');
    const run = (await db.collection('payroll_runs').doc(d.runId).get()).data();
    expect(run).toMatchObject({ approvalOverrideReason: 'Owner verified service', preapprovalSnapshot: { missingEndDates: { count: 1 } } });
    const audit = (await db.collection('audit_logs').get()).docs.map(d => d.data()).find(r => r.action === 'payroll-approve');
    expect(JSON.stringify(audit)).toContain('Owner verified service');
    expect((await db.collection('journal_entries').get()).empty).toBe(true);
    await expect(payPayroll(db, FieldValue, { runId: d.runId, payDate: '2026-11-01' }, { userId: 'admin', now })).rejects.toThrow(/طريقة/);
    expect((await db.collection('journal_entries').get()).empty).toBe(true);
  });
  it('rechecks current worker status after draft save; zero washes alone do not block', async () => {
    await db.collection('bikers').doc('b1').update({ current_status: 'شغال' });
    const d = await draft();
    await db.collection('bikers').doc('b1').update({ current_status: 'مشيناه' });
    await expect(approvePayroll(db, FieldValue, { runId: d.runId }, { userId: 'admin', now })).rejects.toThrow(/بلا تاريخ نهاية/);
    await db.collection('bikers').doc('b1').update({ end_date: '2026-10-20' });
    expect((await approvePayroll(db, FieldValue, { runId: d.runId }, { userId: 'admin', now })).status).toBe('approved');
    expect((await db.collection('journal_entries').get()).empty).toBe(true);
  });
});
