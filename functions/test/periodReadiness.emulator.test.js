import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { dispatch } from '../src/handlers.js';
import { CLOSE_COLLECTIONS } from '../src/periodReadiness.js';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Local emulator only');
describe.skipIf(!host)('period close through real server and local emulator', () => {
  let app, db;
  beforeAll(() => { app = initializeApp({ projectId: 'demo-sweater' }, 'period-close-isolated'); db = getFirestore(app); });
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => {
    for (const col of [...CLOSE_COLLECTIONS, 'users', 'app_admins', 'audit_logs']) {
      const snap = await db.collection(col).get();
      if (snap.size) { const batch = db.batch(); snap.docs.forEach(d => batch.delete(d.ref)); await batch.commit(); }
    }
    await db.collection('users').doc('admin-test').set({ role: 'admin' });
    await db.collection('users').doc('accountant-test').set({ role: 'accountant' });
    await db.collection('users').doc('partner-test').set({ role: 'partner' });
    for (const id of ['1010','1020']) await db.collection('chart_of_accounts').doc(id).set({ code: id });
  });
  const call = (action, payload, uid = 'admin-test') => dispatch(db, FieldValue, action, payload, { uid });
  it('readiness is read-only and rejects partner access', async () => {
    const result = await call('ledgerCloseReadiness', { periodKey: '2026-08' });
    expect(result.periods[0].failedCount).toBeGreaterThan(0);
    expect((await db.collection('accounting_periods').get()).size).toBe(0);
    expect((await db.collection('audit_logs').get()).size).toBe(0);
    await expect(call('ledgerCloseReadiness', {}, 'partner-test')).rejects.toThrow(/المحاسب أو المدير/);
  });
  it('missing evidence refuses closing without any write', async () => {
    await expect(call('ledgerClosePeriod', { periodKey: '2026-08', checklist: { ok: true } })).rejects.toThrow(/غير جاهزة/);
    expect((await db.collection('accounting_periods').get()).size).toBe(0);
    expect((await db.collection('audit_logs').get()).size).toBe(0);
  });
  it('accountant cannot forge an administrator override', async () => {
    await expect(call('ledgerClosePeriod', { periodKey: '2026-08', overrideReason: 'Synthetic decision', role: 'admin' }, 'accountant-test')).rejects.toThrow(/للمدير فقط/);
    expect((await db.collection('accounting_periods').get()).size).toBe(0);
  });
  it('admin override records reason and failed checks atomically', async () => {
    await call('ledgerClosePeriod', { periodKey: '2026-08', overrideReason: 'Synthetic approved exception' });
    const period = (await db.collection('accounting_periods').doc('2026-08').get()).data();
    expect(period.closeOverrideReason).toBe('Synthetic approved exception');
    expect(period.closeChecklist.some(c => !c.ok)).toBe(true);
    const audit = (await db.collection('audit_logs').get()).docs[0].data();
    expect(audit.after.overrideReason).toBe(period.closeOverrideReason);
    expect(audit.userId).toBe('admin-test');
  });
  it('complete evidence closes with no override; current/future periods never close', async () => {
    const e = { periodKey: '2026-08', entryDate: '2026-08-31', status: 'posted', lines: [
      { accountId: '1010', debit: 100, credit: 0 }, { accountId: '3000', debit: 0, credit: 100 },
    ] };
    await db.collection('journal_entries').doc('settlement').set(e);
    await db.collection('journal_entries').doc('payroll').set(e);
    await db.collection('sweater_settlements').doc('2026-08').set({ periodKey: '2026-08', status: 'approved', journalEntryId: 'settlement' });
    await db.collection('payroll_runs').doc('run').set({ periodKey: '2026-08', status: 'approved', journalEntryId: 'payroll' });
    await call('ledgerClosePeriod', { periodKey: '2026-08' });
    expect((await db.collection('accounting_periods').doc('2026-08').get()).data().closeOverrideReason).toBeNull();
    await expect(call('ledgerClosePeriod', { periodKey: '2099-01', overrideReason: 'Test' })).rejects.toThrow(/قبل انتهائه/);
    expect((await db.collection('accounting_periods').doc('2099-01').get()).exists).toBe(false);
  });
});
