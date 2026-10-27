import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { financeWorkbench } from '../financeWorkbench.js';
import { postSource } from '../../functions/src/ledger.js';
import { correctedSourceSeed, historySourceId as sourceId } from './financePostingHistoryFixture.js';
import { expensePatch } from './financeFixtures.js';

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:5288';
const auth = { uid: 'test-admin' };
describe.skipIf(!enabled)('corrected history — owned isolated demo emulator', () => {
  let app, db;
  const names = ['users', 'startup_cost_entries', 'startup_costs', 'chart_of_accounts', 'app_settings', 'journal_entries', 'journal_lines', 'accounting_periods', 'posting_locks', 'finance_reviews', 'audit_logs', 'finance_workbench_receipts', 'counters'];
  beforeAll(() => { app = initializeApp({ projectId: 'demo-sweater' }, 'finance-posting-history'); db = getFirestore(app); });
  beforeEach(async () => {
    for (const name of names) for (const doc of (await db.collection(name).get()).docs) await doc.ref.delete();
    for (const [path, value] of Object.entries(correctedSourceSeed({ split: true }))) await db.doc(path).set(value);
  }, 30000);
  afterAll(async () => { await db.terminate(); await deleteApp(app); });
  async function snapshot() {
    const tables = await Promise.all(names.map(async name => [name, (await db.collection(name).get()).docs.map(d => [d.id, d.data()])]));
    return JSON.stringify(tables);
  }
  it('reads the reversal and live purchase/payment/financing while repeated posting attempts write nothing', async () => {
    const before = await snapshot(), detail = await financeWorkbench(db, auth, { action: 'read', kind: 'startup', sourceId });
    expect(detail.workflowStage).toBe('posted_review');
    expect(detail.postingHistory.active.map(j => j.number)).toEqual([137, 138]);
    expect(detail.postingHistory.reversed[0].mirrorMatched).toBe(true);
    expect(detail.postingHistory.fundingCorrections[0].number).toBe(168);
    const request = { action: 'post', kind: 'startup', sourceId, sourceHash: detail.sourceHash, confirm: true };
    const attempts = await Promise.allSettled([financeWorkbench(db, auth, request), financeWorkbench(db, auth, request),
      postSource(db, FieldValue, { kind: 'startup', sourceId }, { userId: auth.uid })]);
    expect(attempts.every(result => result.status === 'rejected')).toBe(true);
    expect(await snapshot()).toBe(before);
  });
  it('keeps protected edits and reapproval blocked, including a closed period and changed source', async () => {
    await db.doc('accounting_periods/2026-05').set({ status: 'closed' });
    const detail = await financeWorkbench(db, auth, { action: 'read', kind: 'startup', sourceId });
    await db.doc(`startup_cost_entries/${sourceId}`).update({ description: 'مصدر تغير في الاختبار فقط' });
    const before = await snapshot(), common = { kind: 'startup', sourceId, sourceHash: detail.sourceHash };
    await expect(financeWorkbench(db, auth, { ...common, action: 'preview', patch: {} })).rejects.toThrow();
    await expect(financeWorkbench(db, auth, { ...common, action: 'approve', postingHash: 'a'.repeat(64), confirm: true, reason: 'سبب اختبار معزول' })).rejects.toThrow();
    expect(await snapshot()).toBe(before);
  });
  it('reads standalone legacy lines and embedded new reversal lines without writing', async () => {
    const ref = db.doc('journal_entries/old'), original = (await ref.get()).data();
    for (let index = 0; index < original.lines.length; index++) await db.doc(`journal_lines/old-${index}`).set({ ...original.lines[index], entryId: 'old' });
    await ref.update({ lines: FieldValue.delete() });
    const before = await snapshot(), detail = await financeWorkbench(db, auth, { action: 'read', kind: 'startup', sourceId });
    expect(detail.postingHistory.reversed[0].mirrorMatched).toBe(true);
    expect(await snapshot()).toBe(before);
  });
  it('rejects direct reposting of a reversed original even with a genuinely valid current approval', async () => {
    await db.doc('startup_costs/parent').set({ item_name: 'بند اختبار', budgeted_amount: 1000, actual_amount: 0 });
    await db.doc('app_settings/accounting').set({ value: { vatRegistered: false } });
    for (const account of ['1500', '2000']) await db.doc(`chart_of_accounts/${account}`).set({ code: account, active: true });
    const patch = { ...expensePatch({ invoiceNumber: 'ISOLATED-APPROVED', invoiceUrl: 'https://example.org/isolated-approved' }), parentId: 'parent' };
    delete patch.categoryId;
    const input = { kind: 'startup', requestId: 'isolated-approved-history', patch };
    const preview = await financeWorkbench(db, auth, { ...input, action: 'previewCapture' });
    const saved = await financeWorkbench(db, auth, { ...input, action: 'capture', previewHash: preview.previewHash, confirm: true, reason: 'تهيئة اختبار معزول' });
    const read = await financeWorkbench(db, auth, { action: 'read', kind: 'startup', sourceId: saved.sourceId });
    await financeWorkbench(db, auth, { action: 'approve', kind: 'startup', sourceId: saved.sourceId, sourceHash: read.sourceHash,
      postingHash: read.postingPreview.postingHash, confirm: true, reason: 'اعتماد اختباري قبل إضافة التاريخ' });
    await db.doc('journal_entries/approved-old-reversed').set({ sourceKind: 'startup', sourceId: saved.sourceId, status: 'reversed' });
    const before = await snapshot();
    await expect(postSource(db, FieldValue, { kind: 'startup', sourceId: saved.sourceId }, { userId: auth.uid }))
      .rejects.toThrow(/قيد سابق أو معكوس/);
    expect(await snapshot()).toBe(before);
  });
  it.each(['partner', 'accountant', 'operator'])('denies %s the history read without changing data', async role => {
    await db.doc('users/test-admin').update({ role });
    const before = await snapshot();
    await expect(financeWorkbench(db, auth, { action: 'read', kind: 'startup', sourceId })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await snapshot()).toBe(before);
  });
});
