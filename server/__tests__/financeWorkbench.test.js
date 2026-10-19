import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { assertFinanceApproval, financeProblems } from '../../functions/src/financeReview.js';
import { expensePatch, memoryFinanceDb } from './financeFixtures';

const auth = { uid: 'test-admin' };
function database() { return memoryFinanceDb({ 'users/test-admin': { role: 'admin' }, 'variable_expense_categories/test-category': { name: 'اختبار' },
  'app_settings/accounting': { value: { vatRegistered: false } }, 'chart_of_accounts/5100': {}, 'chart_of_accounts/2000': {} }); }
async function capture(db, overrides = {}) {
  const patch = expensePatch(overrides), request = { kind: 'variable', requestId: 'TEST-REQUEST', patch };
  const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...request });
  const result = await financeWorkbench(db, auth, { action: 'capture', ...request, previewHash: preview.previewHash, reason: 'مستند اختبار معزول', confirm: true });
  return { request, preview, result, read: await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: result.sourceId }) };
}
describe('finance workbench version-bound review', () => {
  it('preview does not save; capture preserves invoice/quantity/funding and does not post or pay', async () => {
    const db = database(), patch = expensePatch(), request = { action: 'previewCapture', kind: 'variable', requestId: 'TEST', patch };
    const preview = await financeWorkbench(db, auth, request);
    expect([...db.rows.keys()].filter(k => k.startsWith('variable_expenses/'))).toHaveLength(0);
    expect(preview.after).toMatchObject({ quantity: 2, unit_cost: 50, supplier: patch.supplier, payment_status: 'unpaid', payment_method: 'credit' });
    const data = await capture(db);
    expect(data.read.approved).toBe(false); expect(data.read.postingPreview.ready).toBe(true);
    expect([...db.rows.keys()].some(k => /^(journal_entries|payroll_runs|sales_documents)\//.test(k))).toBe(false);
    const again = await financeWorkbench(db, auth, { action: 'capture', ...data.request, previewHash: data.preview.previewHash, reason: 'مستند اختبار معزول', confirm: true });
    expect(again.duplicate).toBe(true);
  });
  it('approves the exact read version and invalidates it after an evidenced same-record correction', async () => {
    const db = database(), data = await capture(db), common = { kind: 'variable', sourceId: data.result.sourceId, sourceHash: data.read.sourceHash };
    await financeWorkbench(db, auth, { action: 'approve', ...common, reason: 'مطابقة مستند الاختبار', confirm: true });
    const approved = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: common.sourceId });
    expect(approved.approved).toBe(true);
    const patch = { description: 'وصف مصحح بمستند اختباري' }, preview = await financeWorkbench(db, auth, { action: 'preview', ...common, patch });
    await financeWorkbench(db, auth, { action: 'save', ...common, patch, previewHash: preview.previewHash, reason: 'تصحيح مثبت', confirm: true });
    const after = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: common.sourceId });
    expect(after.approved).toBe(false); expect(after.sourceHash).not.toBe(common.sourceHash);
    expect([...db.rows.keys()].filter(k => k.startsWith('variable_expenses/'))).toHaveLength(1);
    await expect(db.runTransaction(tx => assertFinanceApproval(db, tx, 'variable', common.sourceId, after.row))).rejects.toThrow(/اعتماد/);
  });
  it('does not infer cash, tax eligibility, supplier or funding from missing metadata', async () => {
    const db = database(), data = await capture(db, { supplier: null, paymentStatus: 'unknown', paymentMethod: 'unknown', fundingType: 'unknown', fundingReference: null });
    expect(data.read.issues.length).toBeGreaterThan(0);
    await expect(financeWorkbench(db, auth, { action: 'approve', kind: 'variable', sourceId: data.result.sourceId, sourceHash: data.read.sourceHash, reason: 'محاولة اختبار', confirm: true })).rejects.toThrow();
    expect(data.read.row.payment_method).toBe('unknown'); expect(data.read.row.vat_amount).toBeNull();
  });
  it('requires tax evidence for deductible invoices and preserves high-precision unit prices', async () => {
    const db = database(), data = await capture(db, { amount: 665.05, quantity: 50 });
    expect(data.read.row.unit_cost).toBe(13.301);
    expect(financeProblems('variable', { ...data.read.row, is_tax_invoice: true, vat_deductible: true, vat_amount: 10 })).toContain('أهلية المدخلات تحتاج مرجع مراجعة ضريبية؛ العلامة القديمة ليست إثباتًا.');
  });
  it('rejects stale source/preview, unknown keys, missing confirm and cross-kind duplicate originals', async () => {
    const db = database(), data = await capture(db), common = { kind: 'variable', sourceId: data.result.sourceId, sourceHash: data.read.sourceHash };
    await expect(financeWorkbench(db, auth, { action: 'save', ...common, patch: { amount: 200 }, reason: 'اختبار', previewHash: 'a'.repeat(64) })).rejects.toThrow();
    await expect(financeWorkbench(db, auth, { action: 'preview', ...common, patch: { madeUpAccount: '1010' } })).rejects.toThrow();
    await db.collection('variable_expenses').doc(common.sourceId).update({ supplier: 'تغير متزامن' });
    await expect(financeWorkbench(db, auth, { action: 'preview', ...common, patch: {} })).rejects.toThrow(/تغير/);
    await expect(financeWorkbench(db, auth, { action: 'previewCapture', kind: 'monthly', requestId: 'SECOND', patch: { ...expensePatch(), categoryId: undefined } })).rejects.toThrow(/مرتبط/);
  });
  it('refuses posted/reversed records and refuses moving a closed original date into an open month', async () => {
    const db = database(), data = await capture(db), common = { kind: 'variable', sourceId: data.result.sourceId, sourceHash: data.read.sourceHash };
    db.rows.set('accounting_periods/2026-10', { status: 'closed' });
    await expect(financeWorkbench(db, auth, { action: 'preview', ...common, patch: { date: '2026-11-01' } })).rejects.toThrow(/مقفلة/);
    db.rows.delete('accounting_periods/2026-10'); db.rows.set('journal_entries/reversed', { sourceId: common.sourceId, status: 'reversed' });
    await expect(financeWorkbench(db, auth, { action: 'preview', ...common, patch: {} })).rejects.toThrow(/مصدر/);
  });
  it.each(['partner', 'supervisor', 'operator', 'accountant'])('refuses %s without changing their role', async role => {
    const db = database(); db.rows.set('users/test-admin', { role });
    await expect(financeWorkbench(db, auth, { action: 'list', kind: 'variable' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.rows.get('users/test-admin').role).toBe(role);
  });
});
