import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';
import { financeWorkbench } from '../financeWorkbench.js';
import { financeReports } from '../financeReports.js';
import { postSource } from '../../functions/src/ledger.js';
import { expensePatch, financeFixture } from './financeFixtures.js';

const projectId = 'demo-sweater-finance';
const enabled = /^(127\.0\.0\.1|localhost):19080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '');
const auth = { uid: 'finance-test-admin' };
describe.skipIf(!enabled)('finance real Firestore workflow — isolated demo only', () => {
  let app, db, rules;
  beforeAll(async () => {
    app = initializeApp({ projectId }, `finance-${Date.now()}`); db = getFirestore(app);
    rules = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 19080,
      rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') } });
  }, 120000);
  beforeEach(async () => {
    // clearFirestore is restricted to this demo project's emulator database.
    await rules.clearFirestore();
    await Promise.all([
      db.doc(`users/${auth.uid}`).set({ role: 'admin' }),
      ...['partner', 'supervisor', 'operator', 'accountant'].map(role => db.doc(`users/${role}`).set({ role })),
      db.doc('variable_expense_categories/test-category').set({ name: 'اختبار معزول' }),
      db.doc('monthly_expense_categories/test-category').set({ label: 'تصنيف شهري اختباري' }),
      db.doc('annual_expenses/test-parent').set({ expense_name: 'خطة سنوية اختبارية', annual_cost: 1000, actual_amount: 0, payment_status: 'pending' }),
      db.doc('startup_costs/test-parent').set({ item_name: 'خطة تأسيس اختبارية', budgeted_amount: 1000, actual_amount: 0, status: 'in_progress' }),
      db.doc('app_settings/accounting').set({ value: { vatRegistered: false } }),
      ...['5100', '5200', '5300', '1500', '2000', '1020', '1010', '1200'].map(code => db.doc(`chart_of_accounts/${code}`).set({
        code, nameArabic: 'حساب اختبار', accountType: ['5100', '5200', '5300'].includes(code) ? 'expense' : code === '2000' ? 'liability' : 'asset', active: true })),
    ]);
  }, 120000);
  afterAll(async () => { if (rules) await rules.cleanup(); if (db) await db.terminate(); if (app) await deleteApp(app); });
  const call = input => financeWorkbench(db, auth, input);
  async function captured(overrides = {}, requestId = 'TEST-REQUEST') {
    const input = { kind: 'variable', requestId, patch: expensePatch(overrides) };
    const preview = await call({ action: 'previewCapture', ...input });
    const result = await call({ action: 'capture', ...input, previewHash: preview.previewHash, reason: 'مستند اختبار فقط', confirm: true });
    const read = await call({ action: 'read', kind: 'variable', sourceId: result.sourceId });
    return { input, preview, result, read, common: { kind: 'variable', sourceId: result.sourceId, sourceHash: read.sourceHash } };
  }
  const approve = data => call({ action: 'approve', ...data.common, postingHash: data.read.postingPreview.postingHash, reason: 'اعتماد مستند الاختبار', confirm: true });

  it('captures then approves then posts the canonical stored lines; duplicate post cannot create a second journal', async () => {
    const data = await captured();
    expect((await db.collection('journal_entries').get()).size).toBe(0);
    await approve(data);
    const posted = await call({ action: 'post', ...data.common, confirm: true });
    expect(posted.verification).toMatchObject({ verified: true, linesMatched: true });
    const entries = await db.collection('journal_entries').get(); expect(entries.size).toBe(1);
    expect(entries.docs[0].data().lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: '5100', debit: 100, credit: 0 }),
      expect.objectContaining({ accountId: '2000', debit: 0, credit: 100 }),
    ]));
    expect((await db.doc(`variable_expenses/${data.result.sourceId}`).get()).data().payment_status).toBe('unpaid');
    await expect(call({ action: 'post', ...data.common, confirm: true })).rejects.toThrow();
    await expect(approve(data)).rejects.toThrow(/تغيرت/);
    expect((await db.collection('journal_entries').get()).size).toBe(1);
  }, 120000);

  it.each([['monthly', '5200'], ['annual', '5300'], ['startup', '1500']])('%s uses its original classification and canonical account without marking a parent paid', async (kind, accountId) => {
    const patch = expensePatch();
    if (kind !== 'monthly') { delete patch.categoryId; patch.parentId = 'test-parent'; }
    const input = { kind, patch, requestId: `TEST-${kind}` };
    const preview = await call({ action: 'previewCapture', ...input });
    const saved = await call({ action: 'capture', ...input, previewHash: preview.previewHash, reason: 'مستند اختبار نوع المصروف', confirm: true });
    const read = await call({ action: 'read', kind, sourceId: saved.sourceId });
    expect(read.postingPreview.ready).toBe(true);
    await call({ action: 'approve', kind, sourceId: saved.sourceId, sourceHash: read.sourceHash, postingHash: read.postingPreview.postingHash, reason: 'اعتماد اختبار النوع', confirm: true });
    const posted = await call({ action: 'post', kind, sourceId: saved.sourceId, sourceHash: read.sourceHash, confirm: true });
    expect(posted.verification.linesMatched).toBe(true);
    const entry = (await db.doc(`journal_entries/${posted.verification.journalIds[0]}`).get()).data();
    expect(entry.lines.find(line => line.accountId === accountId).debit).toBe(100);
    if (kind !== 'monthly') {
      const parent = (await db.doc(`${kind === 'annual' ? 'annual_expenses' : 'startup_costs'}/test-parent`).get()).data();
      expect(parent.actual_amount).toBe(100); expect(parent.payment_status).not.toBe('paid');
    }
  }, 120000);

  it('two simultaneous capture requests and two posts commit only once', async () => {
    const input = { kind: 'variable', requestId: 'RACE', patch: expensePatch() };
    const preview = await call({ action: 'previewCapture', ...input });
    const requests = await Promise.all([0, 1].map(() => call({ action: 'capture', ...input, previewHash: preview.previewHash, reason: 'اختبار التزامن', confirm: true })));
    expect(requests.filter(r => r.duplicate)).toHaveLength(1);
    expect((await db.collection('variable_expenses').get()).size).toBe(1);
    const read = await call({ action: 'read', kind: 'variable', sourceId: requests[0].sourceId });
    const data = { read, common: { kind: 'variable', sourceId: read.sourceId, sourceHash: read.sourceHash } };
    await approve(data);
    const results = await Promise.allSettled([0, 1].map(() => call({ action: 'post', ...data.common, confirm: true })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.collection('journal_entries').get()).size).toBe(1);
  }, 180000);

  it('source correction invalidates approval and blocks the old callable/MCP postSource door', async () => {
    const data = await captured(); await approve(data);
    const patch = { description: 'تصحيح مثبت داخل نفس السجل' };
    const preview = await call({ action: 'preview', ...data.common, patch });
    await call({ action: 'save', ...data.common, patch, previewHash: preview.previewHash, reason: 'تصحيح اختبار', confirm: true });
    await expect(postSource(db, FieldValue, { kind: 'variable', sourceId: data.read.sourceId }, { userId: auth.uid })).rejects.toThrow(/اعتماد/);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
    expect((await db.collection('audit_logs').get()).size).toBeGreaterThanOrEqual(3);
    await expect(call({ action: 'preview', ...data.common, patch })).rejects.toThrow(/تغير/);
  }, 120000);

  it('different capture keys cannot create duplicate originals under simultaneous requests', async () => {
    const inputs = ['DIFF-1', 'DIFF-2'].map(requestId => ({ kind: 'variable', requestId, patch: expensePatch() }));
    const previews = await Promise.all(inputs.map(input => call({ action: 'previewCapture', ...input })));
    const results = await Promise.allSettled(inputs.map((input, i) => call({ action: 'capture', ...input, previewHash: previews[i].previewHash, reason: 'اختبار تكرار المستند', confirm: true })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.collection('variable_expenses').get()).size).toBe(1);
  }, 180000);

  it('approval binds the viewed journal preview, not just the source; policy changes require reapproval', async () => {
    const data = await captured({ amount: 115, isTaxInvoice: true, vatAmount: 15, vatRate: 0.15, vatDeductible: true, taxReviewRef: 'TEST-ELIGIBILITY' });
    await approve(data);
    await db.doc('app_settings/accounting').set({ value: { vatRegistered: true } });
    const changed = await call({ action: 'read', kind: 'variable', sourceId: data.read.sourceId });
    expect(changed.approved).toBe(false); expect(changed.postingPreview.postingHash).not.toBe(data.read.postingPreview.postingHash);
    await expect(call({ action: 'post', ...data.common, confirm: true })).rejects.toThrow();
    await expect(call({ action: 'approve', ...data.common, postingHash: data.read.postingPreview.postingHash, reason: 'اختبار طلب قديم', confirm: true })).rejects.toThrow();
    await approve({ ...data, read: changed });
    expect((await call({ action: 'post', ...data.common, confirm: true })).verification.linesMatched).toBe(true);
  }, 120000);

  it('a duplicate inserted after approval still blocks posting through the old server door', async () => {
    const data = await captured(); await approve(data);
    await db.doc('monthly_expenses/unreviewed-duplicate').set({ invoice_url: data.read.row.invoice_url });
    await expect(postSource(db, FieldValue, { kind: 'variable', sourceId: data.read.sourceId }, { userId: auth.uid })).rejects.toThrow(/مرتبط/);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
  }, 120000);

  it('checks changed tax preview, removed classification and closed periods again at posting', async () => {
    const data = await captured(); await approve(data);
    await db.doc('accounting_periods/2026-10').set({ status: 'closed' });
    await expect(call({ action: 'post', ...data.common, confirm: true })).rejects.toThrow();
    await db.doc('accounting_periods/2026-10').delete();
    await db.doc('variable_expense_categories/test-category').delete();
    await expect(call({ action: 'post', ...data.common, confirm: true })).rejects.toThrow(/تصنيف/);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
  }, 120000);

  it('preserves actual payment date and verifies both invoice/settlement entries without initiating payment', async () => {
    const data = await captured({ invoiceDate: '2026-10-17', paymentStatus: 'paid', paymentMethod: 'transfer',
      paidDate: '2026-10-19', fundingType: 'company_bank', fundingReference: 'إيصال تحويل اختباري حدث سابقًا' });
    await approve(data); const result = await call({ action: 'post', ...data.common, confirm: true });
    expect(result.verification.journalIds).toHaveLength(2);
    const entries = (await db.collection('journal_entries').get()).docs.map(d => d.data());
    expect(entries.map(e => e.entryDate).sort()).toEqual(['2026-10-17', '2026-10-19']);
    expect(entries.flatMap(e => e.lines).find(l => l.accountId === '1020')).toMatchObject({ credit: 100 });
    expect((await db.collection('payroll_runs').get()).size).toBe(0);
  }, 120000);

  it('reversed source remains protected, old date cannot be moved out of a closed period', async () => {
    const data = await captured(); await db.doc('accounting_periods/2026-10').set({ status: 'closed' });
    await expect(call({ action: 'preview', ...data.common, patch: { date: '2026-11-01' } })).rejects.toThrow(/مقفلة/);
    await db.doc('accounting_periods/2026-10').delete();
    await db.doc('journal_entries/old-reversed-test').set({ sourceId: data.read.sourceId, status: 'reversed', lines: [] });
    await expect(call({ action: 'preview', ...data.common, patch: {} })).rejects.toThrow(/مصدر/);
  }, 120000);

  it('archives reviewed report versions atomically without financial side effects and denies direct non-admin access', async () => {
    const report = financeFixture();
    const args = { action: 'save', report, expectedRevision: 0 };
    const results = await Promise.all([0, 1].map(() => financeReports(db, auth, args, new Date('2026-10-20T00:00:00Z'))));
    expect(results.filter(r => r.duplicate)).toHaveLength(1);
    expect((await financeReports(db, auth, { action: 'read', reportId: report.reportId })).report).toEqual(report);
    for (const role of ['partner', 'supervisor', 'operator', 'accountant']) {
      await expect(financeReports(db, { uid: role }, { action: 'list' })).rejects.toMatchObject({ code: 'permission-denied' });
      const client = rules.authenticatedContext(role).firestore();
      await assertFails(getDoc(doc(client, 'finance_reports', report.reportId)));
      await assertFails(getDoc(doc(client, 'finance_reports', report.reportId, 'revisions', '000001')));
      await assertFails(setDoc(doc(client, 'finance_reviews', 'forged'), { status: 'approved' }));
    }
    // Even admin cannot bypass the API review/version/audit service via SDK.
    await assertFails(setDoc(doc(rules.authenticatedContext(auth.uid).firestore(), 'finance_reports', 'forged'), { test: true }));
    await assertSucceeds(getDoc(doc(rules.authenticatedContext(auth.uid).firestore(), 'users', auth.uid)));
    expect((await db.collection('journal_entries').get()).size).toBe(0);
  }, 120000);
});
