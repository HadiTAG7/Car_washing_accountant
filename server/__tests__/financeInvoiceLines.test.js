import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { financeProblems, financeSourceHash, assertFinanceApproval, financeReviewId } from '../../functions/src/financeReview.js';
import { invoiceLinesShapeIssues } from '../../functions/src/financeInvoiceLines.js';
import { expensePatch, memoryFinanceDb, syntheticFinanceInvoiceLines as syntheticInvoiceLines, syntheticPrintedInvoiceLines, syntheticSharedInvoiceLines } from './financeFixtures.js';
const auth = { uid: 'test-admin' };
const database = () => memoryFinanceDb({ 'users/test-admin': { role: 'admin' }, 'variable_expense_categories/test-category': {},
  'app_settings/accounting': { value: { vatRegistered: true } }, 'chart_of_accounts/5100': {}, 'chart_of_accounts/2000': {}, 'chart_of_accounts/1200': {} });
async function capture(db, patch = {}) {
  const input = { kind: 'variable', requestId: 'TEST-LINES', patch: { ...expensePatch(), amount: 50, invoiceLines: syntheticInvoiceLines(), ...patch } };
  delete input.patch.quantity;
  const preview = await financeWorkbench(db, auth, { ...input, action: 'previewCapture' });
  const result = await financeWorkbench(db, auth, { ...input, action: 'capture', previewHash: preview.previewHash, reason: 'بيانات اختبار معزولة', confirm: true });
  const read = await financeWorkbench(db, auth, { action: 'read', kind: input.kind, sourceId: result.sourceId });
  return { input, preview, result, read, common: { kind: input.kind, sourceId: result.sourceId, sourceHash: read.sourceHash } };
}

describe('faithful heterogeneous financial source quantities', () => {
  it('preserves different units and prices without a false aggregate quantity or unit cost; preview never writes', async () => {
    const db = database(), lines = syntheticInvoiceLines(), before = structuredClone(lines);
    const input = { kind: 'variable', requestId: 'TEST', patch: { ...expensePatch(), quantity: undefined, amount: 50, invoiceLines: lines } };
    const preview = await financeWorkbench(db, auth, { ...input, action: 'previewCapture' });
    expect(preview.after).toMatchObject({ quantity: null, unit_cost: null, total_variable_cost: 50, finance_metadata: { invoiceLines: lines } });
    expect(preview.issues).toEqual([]); expect(lines).toEqual(before);
    expect([...db.rows.keys()].some(key => /^(variable_expenses|journal_entries|finance_reviews)\//.test(key))).toBe(false);
    const data = await capture(db);
    expect(data.read.approvalReady).toBe(true); expect(data.read.approved).toBe(false);
    expect(data.read.row.finance_metadata.invoiceLines).toEqual(lines);
    expect(data.read.row.payment_status).toBe('unpaid'); expect(data.read.row.payment_method).toBe('credit');
    expect([...db.rows.keys()].some(key => key.startsWith('journal_entries/'))).toBe(false);
  });
  it('handles differing pieces and installation at a 2950 synthetic total without inventing a common price', async () => {
    const lines = { version: 1, items: [
      { id: 'a', description: 'جهاز اختبار أول', quantity: 1, unit: 'جهاز', unitCost: 1100, amount: 1100, sourceRef: 'TEST line 1' },
      { id: 'b', description: 'جهاز اختبار مختلف', quantity: 2, unit: 'جهاز', unitCost: 800, amount: 1600, sourceRef: 'TEST line 2' },
      { id: 'c', description: 'تركيب اختباري', quantity: 1, unit: 'خدمة', unitCost: 250, amount: 250, sourceRef: 'TEST line 3' },
    ] };
    const data = await capture(database(), { amount: 2950, invoiceLines: lines });
    expect(data.read.postingPreview.lines.find(line => line.accountId === '5100').debit).toBe(2950);
    expect(data.read.row.unit_cost).toBeNull(); expect(data.read.row.finance_metadata.invoiceLines.items).toEqual(lines.items);
  });
  it('keeps other missing-information blockers and mismatched totals visible and unapprovable', async () => {
    const db = database(), data = await capture(db, { amount: 51, fundingType: 'unknown', fundingReference: null, paymentMethod: 'unknown' });
    expect(data.read.issues).toContain('مجموع بنود الفاتورة لا يطابق إجمالي المستند؛ لا تستخدم متوسطًا لسعر الوحدة.');
    expect(data.read.issues.some(issue => issue.includes('الحساب المقابل'))).toBe(true);
    expect(data.read.approvalReady).toBe(false);
    await expect(financeWorkbench(db, auth, { action: 'approve', ...data.common, postingHash: 'a'.repeat(64), reason: 'اختبار رفض', confirm: true })).rejects.toThrow();
    expect([...db.rows.keys()].some(key => key.startsWith('journal_entries/'))).toBe(false);
  });
  it.each(['duplicate', 'product', 'missing-source', 'unknown-key', 'unsupported-version', 'too-many', 'nan'])('rejects %s lines before saving any source', async failure => {
    const db = database(), lines = syntheticInvoiceLines();
    if (failure === 'duplicate') lines.items[1].id = lines.items[0].id;
    if (failure === 'product') lines.items[0].amount = 11;
    if (failure === 'missing-source') lines.items[0].sourceRef = '';
    if (failure === 'unknown-key') lines.items[0].accountId = '1010';
    if (failure === 'unsupported-version') lines.version = 2;
    if (failure === 'too-many') lines.items = Array.from({ length: 101 }, (_, index) => ({ ...lines.items[0], id: `x${index}` }));
    if (failure === 'nan') lines.items[0].quantity = NaN;
    expect(invoiceLinesShapeIssues(lines).length).toBeGreaterThan(0);
    await expect(financeWorkbench(db, auth, { action: 'previewCapture', kind: 'variable', requestId: 'INVALID', patch: { ...expensePatch(), quantity: undefined, invoiceLines: lines } })).rejects.toThrow();
    expect([...db.rows.keys()].some(key => /^(variable_expenses|audit_logs|finance_reviews)\//.test(key))).toBe(false);
  });
  it('never accepts scalar quantity alongside heterogeneous lines', async () => {
    await expect(financeWorkbench(database(), auth, { action: 'previewCapture', kind: 'variable', requestId: 'TEST',
      patch: { ...expensePatch(), amount: 50, invoiceLines: syntheticInvoiceLines() } })).rejects.toThrow(/كمية واحدة/);
  });
  it('binds line evidence and quantities to the approval even when the resulting journal amounts are unchanged', async () => {
    const db = database(), data = await capture(db);
    await financeWorkbench(db, auth, { action: 'approve', ...data.common, postingHash: data.read.postingPreview.postingHash, reason: 'اعتماد اختبار البنود', confirm: true });
    const changed = syntheticInvoiceLines(); changed.items[0] = { ...changed.items[0], quantity: 2, unitCost: 6, sourceRef: 'TEST reviewed line 1' };
    const patch = { invoiceLines: changed }, preview = await financeWorkbench(db, auth, { action: 'preview', ...data.common, patch });
    await financeWorkbench(db, auth, { action: 'save', ...data.common, patch, previewHash: preview.previewHash, reason: 'تصحيح بند بالدليل', confirm: true });
    const after = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: data.result.sourceId });
    expect(after.postingPreview.postingHash).toBe(data.read.postingPreview.postingHash);
    expect(after.sourceHash).not.toBe(data.read.sourceHash); expect(after.approved).toBe(false);
    await expect(db.runTransaction(tx => assertFinanceApproval(db, tx, 'variable', after.sourceId, after.row))).rejects.toThrow(/اعتماد/);
    await expect(financeWorkbench(db, auth, { action: 'approve', ...data.common, postingHash: data.read.postingPreview.postingHash, reason: 'نسخة قديمة', confirm: true })).rejects.toThrow(/تغير/);
  });
  it('retains printed 10.66 and reviewed eligible 6.75 but blocks both current and legacy approval, not deducting full VAT', async () => {
    const db = database(), lines = { version: 1, items: [{ ...syntheticInvoiceLines().items[0], quantity: 1, unitCost: 81.75, amount: 81.75 }],
      vatAllocation: { printedVat: 10.66, eligibleVat: 6.75, reviewRef: 'TEST-PARTIAL-OPINION' } };
    const data = await capture(db, { amount: 81.75, invoiceLines: lines, isTaxInvoice: true, vatAmount: 10.66, vatRate: 0.15, vatDeductible: true, taxReviewRef: 'TEST-PARTIAL-OPINION' });
    expect(data.read.row.vat_amount).toBe(10.66); expect(data.read.row.finance_metadata.invoiceLines.vatAllocation.eligibleVat).toBe(6.75);
    expect(data.read.issues.some(issue => issue.includes('الجزئي'))).toBe(true); expect(data.read.postingPreview.ready).toBe(false);
    const row = { ...data.read.row, approval_status: 'approved' };
    db.rows.set(`finance_reviews/${financeReviewId('variable', data.read.sourceId)}`, { status: 'approved', sourceHash: financeSourceHash(row) });
    await expect(db.runTransaction(tx => assertFinanceApproval(db, tx, 'variable', data.read.sourceId, row))).rejects.toThrow(/الجزئي/);
    expect([...db.rows.keys()].some(key => key.startsWith('journal_entries/'))).toBe(false);
  });
  it('requires an explicit matching allocation for full VAT and does not infer eligibility from the printed amount', async () => {
    const lines = syntheticInvoiceLines(), db = database();
    const data = await capture(db, { isTaxInvoice: true, vatAmount: 6.52, vatRate: 0.15, vatDeductible: true, taxReviewRef: 'TEST-REVIEW' });
    expect(data.read.approvalReady).toBe(false);
    lines.vatAllocation = { printedVat: 6.52, eligibleVat: 6.52, reviewRef: 'TEST-REVIEW' };
    const row = { ...data.read.row, finance_metadata: { ...data.read.row.finance_metadata, invoiceLines: lines } };
    expect(financeProblems('variable', row)).toEqual([]);
    expect(financeProblems('variable', { ...row, vat_amount: 10.66 })).toContain('ضريبة البنود المطبوعة لا تطابق الضريبة المحفوظة على الفاتورة.');
    lines.vatAllocation.eligibleVat = null;
    expect(financeProblems('variable', row).length).toBeGreaterThan(0);
  });
  it('preserves printed net unit prices and gross line rounding without inventing line VAT or changing the printed 30', async () => {
    const invoiceLines = syntheticPrintedInvoiceLines();
    const data = await capture(database(), { amount: 81.75, invoiceLines, isTaxInvoice: true, vatAmount: 10.66, vatDeductible: true, taxReviewRef: 'TEST-PARTIAL-REVIEW' });
    expect(data.read.row.finance_metadata.invoiceLines.items[1]).toMatchObject({ unitCost: 13.04, amount: 30, quantity: 2 });
    expect(data.read.issues.some(issue => issue.includes('الجزئي'))).toBe(true);
    expect(data.read.issues.some(issue => /بنود الفاتورة لا يطابق|أساس سعر الوحدة/.test(issue))).toBe(false);
    expect(data.read.approvalReady).toBe(false);
    expect(invoiceLines.items.every(line => !Object.hasOwn(line, 'vatAmount'))).toBe(true);
  });
  it('does not allow printed-amount labels to bypass same-basis quantity checks or invent missing unit prices', async () => {
    const invoiceLines = syntheticInvoiceLines();
    invoiceLines.items[0] = { ...invoiceLines.items[0], unitCost: 5, amountSource: 'printed', unitPriceMode: 'inclusive', amountNote: 'مرجع مطبوع اختباري' };
    const data = await capture(database(), { invoiceLines });
    expect(data.read.issues.some(issue => issue.includes('الأساس نفسه'))).toBe(true); expect(data.read.approvalReady).toBe(false);
    invoiceLines.items[0].unitCost = null;
    expect(invoiceLinesShapeIssues(invoiceLines).length).toBeGreaterThan(0);
  });
  it('preserves known quantities and one evidenced shared total with null component prices, never an artificial average', async () => {
    const db = database(), invoiceLines = syntheticSharedInvoiceLines();
    const data = await capture(db, { amount: 2950, invoiceLines });
    expect(data.read.approvalReady).toBe(true);
    expect(data.read.row).toMatchObject({ quantity: null, unit_cost: null, finance_metadata: { invoiceLines } });
    expect(data.read.row.finance_metadata.invoiceLines.items.map(item => [item.quantity, item.unitCost, item.amount])).toEqual([[1, null, null], [2, null, null]]);
    expect(data.read.postingPreview.lines.find(line => line.accountId === '5100').debit).toBe(2950);
    const missingFunding = await capture(database(), { amount: 2950, invoiceLines, fundingType: 'unknown', fundingReference: null });
    expect(missingFunding.read.approvalReady).toBe(false); expect(missingFunding.read.issues.some(issue => issue.includes('الحساب المقابل'))).toBe(true);
  });
  it.each(['missing-quantity', 'missing-shared-evidence', 'mixed-prices', 'empty-items'])('does not use a shared amount to excuse %s', async failure => {
    const invoiceLines = syntheticSharedInvoiceLines();
    if (failure === 'missing-quantity') invoiceLines.items[0].quantity = null;
    if (failure === 'missing-shared-evidence') invoiceLines.sharedTotal.sourceRef = '';
    if (failure === 'mixed-prices') invoiceLines.items[0].unitCost = 2950;
    if (failure === 'empty-items') invoiceLines.items = [];
    expect(invoiceLinesShapeIssues(invoiceLines).length).toBeGreaterThan(0);
  });
  it('keeps mismatched shared totals blocked and hashes the common source evidence', async () => {
    const invoiceLines = syntheticSharedInvoiceLines(), data = await capture(database(), { amount: 2900, invoiceLines });
    expect(data.read.approvalReady).toBe(false); expect(data.read.issues.some(issue => issue.includes('إجمالي المستند'))).toBe(true);
    const changed = structuredClone(data.read.row); changed.finance_metadata.invoiceLines.sharedTotal.sourceRef = 'TEST changed common evidence';
    expect(financeSourceHash(changed)).not.toBe(data.read.sourceHash);
  });
  it('rejects a legacy writer repopulating fabricated scalar quantity and price above valid source lines', async () => {
    const db = database(), data = await capture(db, { amount: 2950, invoiceLines: syntheticSharedInvoiceLines() });
    const corrupt = { ...data.read.row, quantity: 1, unit_cost: 2950, approval_status: 'approved' };
    db.rows.set(`finance_reviews/${financeReviewId('variable', data.read.sourceId)}`, { status: 'approved', sourceHash: financeSourceHash(corrupt) });
    expect(financeProblems('variable', corrupt).some(issue => issue.includes('سعر وحدة إجماليًا'))).toBe(true);
    await expect(db.runTransaction(tx => assertFinanceApproval(db, tx, 'variable', data.read.sourceId, corrupt))).rejects.toThrow(/سعر وحدة إجماليًا/);
    expect([...db.rows.keys()].some(key => key.startsWith('journal_entries/'))).toBe(false);
  });
});
