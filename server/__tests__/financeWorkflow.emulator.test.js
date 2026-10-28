import { reportSubmission } from '../../src/lib/reportPublication.js';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';
import { financeWorkbench } from '../financeWorkbench.js';
import { exceptionSources, allocationSources, originalUrl, evidenceSeed, evidenceCall, saveEvidence, linkAllocation, approveEvidence } from './financeSourceEvidenceFixtures.js';
import { financeReports } from '../financeReports.js';
import { postSource } from '../../functions/src/ledger.js';
import { expensePatch, financeFixture, syntheticFinanceInvoiceLines, syntheticPrintedInvoiceLines, syntheticSharedInvoiceLines } from './financeFixtures.js';
import { financeReviewId, financeSourceHash } from '../../functions/src/financeReview.js';
import { approveFinanceSelection } from '../../src/lib/financeWorkbenchActions.js';
import { dispatch } from '../../functions/src/handlers.js';
import { deleteStartupPlan } from '../../functions/src/startupCosts.js';
import { reviewedPartialSeed, partialSourceId, partialReviewRef } from './financeReviewedVatFixtures.js';

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

  it.each(['workbench', 'legacy'])('posts only the reviewed eligible VAT once through %s, with source/period/approval guards intact', async door => {
    const seed = reviewedPartialSeed(auth.uid);
    for (const [path, value] of Object.entries(seed)) await db.doc(path).set(value);
    const request = { kind: 'startup', sourceId: partialSourceId };
    const read = await call({ action: 'read', ...request });
    expect(read.approvalReady).toBe(true); expect(read.approved).toBe(false);
    await expect(postSource(db, FieldValue, request, { userId: auth.uid })).rejects.toThrow(/اعتماد/);
    await call({ action: 'approve', ...request, sourceHash: read.sourceHash, postingHash: read.postingPreview.postingHash, reason: 'TEST reviewed partial allocation', confirm: true });
    const before = (await db.doc(`startup_cost_entries/${partialSourceId}`).get()).data();
    if (door === 'legacy') await postSource(db, FieldValue, request, { userId: auth.uid });
    else await call({ action: 'post', ...request, sourceHash: read.sourceHash, confirm: true });
    const entries = await db.collection('journal_entries').get(); expect(entries.size).toBe(1);
    expect(entries.docs[0].data().lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: '1500', debit: 75, credit: 0 }),
      expect.objectContaining({ accountId: '1200', debit: 6.75, credit: 0 }),
      expect.objectContaining({ accountId: '1020', debit: 0, credit: 81.75 }),
    ]));
    expect(entries.docs[0].data().purchaseTaxSnapshot).toMatchObject({ documentVat: 10.66, vatAmount: 10.66, vat: 6.75, net: 75,
      reviewedAllocation: { ref: partialReviewRef, eligibleVat: 6.75, returnAction: 'none' } });
    const after = (await db.doc(`startup_cost_entries/${partialSourceId}`).get()).data();
    expect(after.vat_amount).toBe(10.66); expect(after.finance_metadata.invoiceLines).toEqual(before.finance_metadata.invoiceLines);
    await expect(postSource(db, FieldValue, request, { userId: auth.uid })).rejects.toThrow();
    expect((await db.collection('journal_entries').get()).size).toBe(1);
    expect((await db.collection('vat_returns').get()).size).toBe(0);
  }, 120000);

  it('confirms and audits an annual status change without creating a payment, then refuses deleting any parent with payments or a journal', async () => {
    const request = { action: 'update', parentId: 'test-parent', patch: { payment_status: 'paid' }, confirmed: true,
      reason: 'سبب اختبار معزول للتأكيد', expected: { payment_status: 'pending', annual_cost: 1000 } };
    await expect(dispatch(db, FieldValue, 'annualPlanAction', { ...request, confirmed: false }, auth)).rejects.toThrow();
    await dispatch(db, FieldValue, 'annualPlanAction', request, auth);
    expect((await db.doc('annual_expenses/test-parent').get()).data()).toMatchObject({ actual_amount: 0, annual_cost: 1000, payment_status: 'paid' });
    expect((await db.collection('audit_logs').where('action', '==', 'annual-plan-update').get()).docs[0].data().reason).toBe(request.reason);
    expect((await db.collection('journal_entries').get()).size).toBe(0); expect((await db.collection('annual_expense_entries').get()).size).toBe(0);
    await db.doc('annual_expense_entries/isolated-payment').set({ annual_expense_id: 'test-parent', amount: 10 });
    const deletion = { action: 'delete', parentId: 'test-parent', confirmed: true };
    await expect(dispatch(db, FieldValue, 'annualPlanAction', deletion, auth)).rejects.toThrow(/الحذف ممنوع/);
    await db.doc('annual_expense_entries/isolated-payment').delete();
    await db.doc('journal_entries/isolated-journal').set({ sourceId: 'test-parent', status: 'posted' });
    await expect(dispatch(db, FieldValue, 'annualPlanAction', deletion, auth)).rejects.toThrow(/الحذف ممنوع/);
    expect((await db.doc('annual_expenses/test-parent').get()).exists).toBe(true);
  }, 120000);

  it('keeps the startup server deletion guard and deletes only an empty confirmed annual plan', async () => {
    await dispatch(db, FieldValue, 'startupUpdatePlan', { parentId: 'test-parent', patch: { itemName: 'خطة اختبار معدلة' }, reason: 'سبب موثق من تأكيد الواجهة' }, auth);
    expect((await db.collection('audit_logs').where('action', '==', 'startup-plan-update').get()).docs[0].data().note).toBe('سبب موثق من تأكيد الواجهة');
    await db.doc('startup_cost_entries/isolated-spend').set({ startup_cost_id: 'test-parent', amount: 5 });
    await expect(deleteStartupPlan(db, FieldValue, { parentId: 'test-parent' }, { role: 'admin', userId: auth.uid })).rejects.toThrow(/مصروف/);
    await dispatch(db, FieldValue, 'annualPlanAction', { action: 'delete', parentId: 'test-parent', confirmed: true }, auth);
    expect((await db.doc('annual_expenses/test-parent').get()).exists).toBe(false);
    expect((await db.doc('startup_cost_entries/isolated-spend').get()).exists).toBe(true);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
  }, 120000);
  async function captured(overrides = {}, requestId = 'TEST-REQUEST') {
    const input = { kind: 'variable', requestId, patch: expensePatch(overrides) };
    const preview = await call({ action: 'previewCapture', ...input });
    const result = await call({ action: 'capture', ...input, previewHash: preview.previewHash, reason: 'مستند اختبار فقط', confirm: true });
    const read = await call({ action: 'read', kind: 'variable', sourceId: result.sourceId });
    return { input, preview, result, read, common: { kind: 'variable', sourceId: result.sourceId, sourceHash: read.sourceHash } };
  }
  const approve = data => call({ action: 'approve', ...data.common, postingHash: data.read.postingPreview.postingHash, reason: 'اعتماد مستند الاختبار', confirm: true });

  it('records known source quantities with an undivided shared total and posts the startup source once without component prices', async () => {
    const invoiceLines = syntheticSharedInvoiceLines();
    const patch = expensePatch({ parentId: 'test-parent', amount: 2950, invoiceLines });
    delete patch.categoryId; delete patch.quantity;
    const input = { kind: 'startup', requestId: 'TEST-SHARED-TOTAL', patch };
    const preview = await call({ action: 'previewCapture', ...input });
    const saved = await call({ action: 'capture', ...input, previewHash: preview.previewHash, reason: 'مبلغ مشترك اختباري دون توزيع', confirm: true });
    const read = await call({ action: 'read', kind: 'startup', sourceId: saved.sourceId });
    const common = { kind: 'startup', sourceId: saved.sourceId, sourceHash: read.sourceHash };
    expect(read.approvalReady).toBe(true); expect(read.row.quantity).toBeNull(); expect(read.row.unit_cost).toBeNull();
    expect(read.row.finance_metadata.invoiceLines).toEqual(invoiceLines);
    await call({ action: 'approve', ...common, postingHash: read.postingPreview.postingHash, reason: 'اعتماد المبلغ المشترك الاختباري', confirm: true });
    const posted = await call({ action: 'post', ...common, confirm: true });
    expect(posted.verification.linesMatched).toBe(true);
    const entries = await db.collection('journal_entries').get(); expect(entries.size).toBe(1);
    expect(entries.docs[0].data().lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: '1500', debit: 2950, credit: 0 }), expect.objectContaining({ accountId: '2000', debit: 0, credit: 2950 }),
    ]));
    expect((await db.doc('startup_costs/test-parent').get()).data().actual_amount).toBe(2950);
    const after = (await db.doc(`startup_cost_entries/${read.sourceId}`).get()).data();
    expect(after.finance_metadata.invoiceLines.items.every(item => item.unitCost === null && item.amount === null)).toBe(true);
    expect(after.payment_status).toBe('unpaid');
    await expect(call({ action: 'post', ...common, confirm: true })).rejects.toThrow();
    expect((await db.collection('journal_entries').get()).size).toBe(1);
  }, 120000);

  it('keeps heterogeneous quantities, invalidates their approval on evidence change, then posts exactly once through the existing adapter', async () => {
    const lines = syntheticFinanceInvoiceLines();
    const data = await captured({ quantity: undefined, amount: 50, invoiceLines: lines });
    expect(data.read.row).toMatchObject({ quantity: null, unit_cost: null, finance_metadata: { invoiceLines: lines } });
    await approve(data);
    lines.items[0].sourceRef = 'TEST-INVOICE corrected line reference';
    const patch = { invoiceLines: lines }, preview = await call({ action: 'preview', ...data.common, patch });
    await call({ action: 'save', ...data.common, patch, previewHash: preview.previewHash, reason: 'تصحيح مرجع بند اختباري', confirm: true });
    await expect(postSource(db, FieldValue, { kind: 'variable', sourceId: data.read.sourceId }, { userId: auth.uid })).rejects.toThrow(/اعتماد/);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
    const read = await call({ action: 'read', kind: 'variable', sourceId: data.read.sourceId });
    const current = { read, common: { ...data.common, sourceHash: read.sourceHash } };
    expect(read.sourceHash).not.toBe(data.read.sourceHash); expect(read.approved).toBe(false);
    await approve(current);
    const posted = await call({ action: 'post', ...current.common, confirm: true });
    expect(posted.verification.linesMatched).toBe(true);
    const journals = await db.collection('journal_entries').get(); expect(journals.size).toBe(1);
    expect(journals.docs[0].data().lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: '5100', debit: 50, credit: 0 }), expect.objectContaining({ accountId: '2000', debit: 0, credit: 50 }),
    ]));
    const saved = (await db.doc(`variable_expenses/${read.sourceId}`).get()).data();
    expect(saved.finance_metadata.invoiceLines).toEqual(lines); expect(saved.payment_status).toBe('unpaid');
    await expect(call({ action: 'post', ...current.common, confirm: true })).rejects.toThrow();
    expect((await db.collection('journal_entries').get()).size).toBe(1);
  }, 120000);

  it('preserves partial VAT evidence but refuses full deduction through the current and legacy posting doors', async () => {
    const invoiceLines = syntheticPrintedInvoiceLines();
    const data = await captured({ quantity: undefined, amount: 81.75, invoiceLines, isTaxInvoice: true, vatAmount: 10.66, vatRate: 0.15,
      vatDeductible: true, taxReviewRef: 'TEST-PARTIAL-REVIEW' });
    expect(data.read.approvalReady).toBe(false); expect(data.read.issues.some(issue => issue.includes('الجزئي'))).toBe(true);
    await expect(call({ action: 'approve', ...data.common, postingHash: 'a'.repeat(64), reason: 'رفض معزول', confirm: true })).rejects.toThrow(/الجزئي/);
    // Simulate a stale legacy approval in this demo emulator only. Shared posting
    // validation must still reject it before any journal is created.
    const row = { ...data.read.row, approval_status: 'approved' };
    await db.doc(`variable_expenses/${data.read.sourceId}`).update({ approval_status: 'approved' });
    await db.doc(`finance_reviews/${financeReviewId('variable', data.read.sourceId)}`).set({ status: 'approved', sourceHash: financeSourceHash(row) });
    await expect(postSource(db, FieldValue, { kind: 'variable', sourceId: data.read.sourceId }, { userId: auth.uid })).rejects.toThrow(/الجزئي/);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
    expect((await db.doc(`variable_expenses/${data.read.sourceId}`).get()).data().vat_amount).toBe(10.66);
    expect((await db.doc(`variable_expenses/${data.read.sourceId}`).get()).data().finance_metadata.invoiceLines.items[1]).toMatchObject({ quantity: 2, unitCost: 13.04, amount: 30 });
  }, 120000);

  it('bulk approval calls the original transactional path per eligible version and never posts or proves payment', async () => {
    await captured({ invoiceNumber: 'BULK-A', invoiceUrl: 'https://example.org/bulk-a' }, 'BULK-A');
    await captured({ invoiceNumber: 'BULK-B', invoiceUrl: 'https://example.org/bulk-b' }, 'BULK-B');
    const before = await call({ action: 'browse' });
    expect(before.items.every(item => item.workflowStage === 'ready')).toBe(true);
    const result = await approveFinanceSelection({ items: before.items, confirmed: true, reason: 'اعتماد مجموعة اختبار معزولة', call: (_endpoint, request) => call(request) });
    expect(result.verified).toHaveLength(2); expect(result.uncertain).toHaveLength(0);
    expect((await call({ action: 'browse' })).items.every(item => item.workflowStage === 'approved')).toBe(true);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
    expect((await db.collection('variable_expenses').get()).docs.every(doc => doc.data().payment_status === 'unpaid')).toBe(true);
    expect((await db.collection('finance_reviews').get()).size).toBe(2);
    const attemptAgain = await approveFinanceSelection({ items: before.items, confirmed: true, reason: 'اختبار إعادة مجموعة قديمة', call: (_endpoint, request) => call(request) });
    expect(attemptAgain.skipped).toHaveLength(2); expect((await db.collection('finance_reviews').get()).size).toBe(2);
  }, 120000);

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

  it('posts an explicitly bounded owner quantity exception once without a fake quantity, price or payment', async () => {
    await Promise.all(Object.entries(evidenceSeed()).map(([path, value]) => db.doc(path).set(value)));
    const sourceId = exceptionSources[0][0], read = await evidenceCall(db, { action: 'read', sourceId });
    await saveEvidence(db, sourceId, { quantityException: { version: 1, grantRef: read.sourceContext.quantityGrant.ref, sourceRef: 'TEST isolated decision proof' } });
    await approveEvidence(db, sourceId);
    const posted = await evidenceCall(db, { action: 'post', sourceId, sourceHash: (await evidenceCall(db, { action: 'read', sourceId })).sourceHash, confirm: true });
    expect(posted.verification.linesMatched).toBe(true);
    const row = (await db.doc(`startup_cost_entries/${sourceId}`).get()).data();
    expect(row).toMatchObject({ amount: 20, quantity: null, unit_cost: null, payment_status: 'unpaid' });
    expect((await db.collection('journal_entries').get()).docs.flatMap(doc => doc.data().lines).find(line => line.accountId === '1500').debit).toBe(20);
    await expect(postSource(db, FieldValue, { kind: 'startup', sourceId }, { userId: auth.uid })).rejects.toThrow();
    expect((await db.collection('journal_entries').get()).size).toBe(1);
    await expect(evidenceCall(db, { action: 'preview', sourceId, sourceHash: financeSourceHash(row), patch: {} })).rejects.toThrow(/مصدر/);
  }, 120000);

  it('posts the two allocated existing sources concurrently exactly once each within the reviewed 280 ceiling', async () => {
    await Promise.all(Object.entries(evidenceSeed()).map(([path, value]) => db.doc(path).set(value)));
    await linkAllocation(db); for (const sourceId of allocationSources) await approveEvidence(db, sourceId);
    const reads = await Promise.all(allocationSources.map(sourceId => evidenceCall(db, { action: 'read', sourceId })));
    const posted = await Promise.all(reads.map(read => evidenceCall(db, { action: 'post', sourceId: read.sourceId, sourceHash: read.sourceHash, confirm: true })));
    expect(posted.every(result => result.verification.linesMatched)).toBe(true);
    const entries = (await db.collection('journal_entries').get()).docs.map(doc => doc.data());
    expect(entries).toHaveLength(2); expect(new Set(entries.map(entry => entry.sourceId)).size).toBe(2);
    expect(entries.flatMap(entry => entry.lines).filter(line => line.accountId === '1500').reduce((sum, line) => sum + line.debit, 0)).toBe(280);
    for (const sourceId of allocationSources) await expect(postSource(db, FieldValue, { kind: 'startup', sourceId }, { userId: auth.uid })).rejects.toThrow();
    expect((await db.collection('startup_cost_entries').get()).size).toBe(4);
  }, 180000);

  it('rechecks allocation peers, closed periods, injected duplicates and concurrent saves before posting through either door', async () => {
    await Promise.all(Object.entries(evidenceSeed()).map(([path, value]) => db.doc(path).set(value)));
    await linkAllocation(db); const sourceId = allocationSources[0]; await approveEvidence(db, sourceId);
    const before = await evidenceCall(db, { action: 'read', sourceId });
    const peer = await evidenceCall(db, { action: 'read', sourceId: allocationSources[1] });
    const previews = await Promise.all(['TEST first correction', 'TEST second correction'].map(purpose => evidenceCall(db, { action: 'preview', sourceId: peer.sourceId, sourceHash: peer.sourceHash, patch: { purpose } })));
    const saves = await Promise.allSettled(previews.map((preview, index) => evidenceCall(db, { action: 'save', sourceId: peer.sourceId, sourceHash: peer.sourceHash,
      patch: { purpose: index ? 'TEST second correction' : 'TEST first correction' }, previewHash: preview.previewHash, reason: 'TEST concurrent correction', confirm: true })));
    expect(saves.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await evidenceCall(db, { action: 'read', sourceId })).approved).toBe(false);
    await expect(postSource(db, FieldValue, { kind: 'startup', sourceId }, { userId: auth.uid })).rejects.toThrow(/توزيع الأصل/);
    await approveEvidence(db, sourceId);
    await db.doc('accounting_periods/2026-10').set({ status: 'closed' });
    await expect(evidenceCall(db, { action: 'post', sourceId, sourceHash: before.sourceHash, confirm: true })).rejects.toThrow();
    await db.doc('accounting_periods/2026-10').delete();
    await expect(evidenceCall(db, { action: 'preview', sourceId, sourceHash: before.sourceHash, patch: { amount: 201 } })).rejects.toThrow(/مبلغ أحد جزأي/);
    await db.doc('monthly_expenses/injected-duplicate').set({ invoice_url: `${originalUrl}?usp=sharing` });
    await expect(postSource(db, FieldValue, { kind: 'startup', sourceId }, { userId: auth.uid })).rejects.toThrow('يوجد مصروف آخر بنفس هوية أصل المستند ولو اختلف شكل رابطه؛ راجع التكرار قبل الاعتماد والترحيل.');
    expect((await db.collection('journal_entries').get()).size).toBe(0);
  }, 180000);

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
    expect(reportSubmission((await financeReports(db, auth, { action: 'read', reportId: report.reportId })).report)).toEqual(report);
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
