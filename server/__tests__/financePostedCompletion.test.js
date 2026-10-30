import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { foundingEntryId } from '../foundingSettlement.js';
import { expensePatch, memoryFinanceDb } from './financeFixtures.js';

const auth = { uid: 'test-admin' };
const wb = (db, request) => financeWorkbench(db, auth, request);
const read = (db, sourceId) => wb(db, { action: 'read', kind: 'variable', sourceId });
const lines = (cash, account = '1010') => [{ accountId: '5100', debit: 86.96, credit: 0 }, { accountId: '1200', debit: 13.04, credit: 0 },
  { accountId: account, debit: 0, credit: cash }];
const mirror = list => list.map(l => ({ accountId: l.accountId, debit: l.credit, credit: l.debit }));
// Like the seven reposted founding documents: a cash tax invoice whose original entry was reversed and
// posted again, Hadi's payment moved to 2300 by a posted «تصحيح جهة دفع», its non-financial fields empty.
function reposted() {
  return {
    'users/test-admin': { role: 'admin', displayName: 'هادي' }, 'variable_expense_categories/test-category': {},
    'app_settings/accounting': { value: { vatRegistered: false } },
    ...Object.fromEntries(['5100', '1010', '1020', '1200', '2300'].map(id => [`chart_of_accounts/${id}`, {}])),
    'variable_expenses/r1': { expense_name: 'سرير وملحقاته', total_variable_cost: 100, logged_date: '2026-08-20', category_id: 'test-category',
      supplier: 'مورد الأثاث', invoice_number: 'F-1', invoice_date: '2026-08-20', invoice_url: 'https://example.org/f-1', is_tax_invoice: true,
      vat_deductible: true, vat_amount: 13.04, vat_rate: 0.15, price_mode: 'inclusive', payment_method: 'cash', quantity: null, unit_cost: null },
    'journal_entries/je_old': { entryDate: '2026-08-20', sourceType: 'expense', sourceKind: 'variable', sourceId: 'r1', status: 'reversed',
      reversedBy: 'je_rev', entryNumber: 42, lines: lines(100) },
    'journal_entries/je_rev': { entryDate: '2026-08-21', sourceType: 'expense', sourceKind: 'variable', sourceId: 'r1', status: 'posted',
      reversalOf: 'je_old', entryNumber: 43, lines: mirror(lines(100)) },
    'journal_entries/je_new': { entryDate: '2026-08-21', sourceType: 'expense', sourceKind: 'variable', sourceId: 'r1', status: 'posted',
      entryNumber: 146, lines: lines(100) },
    'posting_locks/variable__r1': { entryId: 'je_new', entryNumber: 146 },
    [`journal_entries/${foundingEntryId('doc:variable:r1')}`]: { entryDate: '2026-09-30', sourceType: 'adjustment', sourceKind: 'founding_document',
      sourceId: foundingEntryId('doc:variable:r1'), status: 'posted', entryNumber: 291,
      foundingEntry: { key: 'doc:variable:r1', type: 'document', sourceKey: 'variable:r1' },
      lines: [{ accountId: '1010', debit: 100, credit: 0 }, { accountId: '2300', debit: 0, credit: 100 }] },
  };
}
const ledger = db => [...db.rows].filter(([path]) => /^(journal_entries|journal_lines|posting_locks|finance_reviews)\//.test(path));
async function complete(db, sourceId, completion, reason = 'استكمال بعد الترحيل') {
  const detail = await read(db, sourceId);
  const preview = await wb(db, { action: 'previewCompletion', kind: 'variable', sourceId, sourceHash: detail.sourceHash, completion });
  return wb(db, { action: 'complete', kind: 'variable', sourceId, sourceHash: detail.sourceHash, completion, previewHash: preview.previewHash, reason, confirm: true });
}

describe('a reposted founding document under the manager’s rule', () => {
  it('counts its payment, funding and counter-account blockers as resolved, then reaches «مكتمل» once its non-financial fields are completed', async () => {
    const db = memoryFinanceDb(reposted()), entriesBefore = structuredClone(ledger(db));
    let detail = await read(db, 'r1');
    expect(detail).toMatchObject({ workflowStage: 'posted_review', paymentProof: 'founding_rule', paymentRule: 'payment_correction', paymentRuleEntry: 291 });
    expect(detail.resolvedByRule).toEqual(['حالة السداد غير مثبتة.', 'دليل التمويل أو ذمة المورد غير مكتمل.', 'الحساب المقابل لهذا التمويل غير محسوم؛ لا يفترض الصندوق أو البنك.']);
    expect(detail.issues).toEqual(['الكمية وسعر الوحدة لا يطابقان الإجمالي.', 'الغرض ودليل المراجعة غير مكتملين.',
      'أهلية المدخلات تحتاج مرجع مراجعة ضريبية؛ العلامة القديمة ليست إثباتًا.']);
    expect(detail.workflowDimensions.ruleResolved.map(item => item.category)).toEqual(['payment', 'funding', 'funding']);
    expect(detail.workflowDimensions.payment).toMatchObject({ basis: 'founding_rule', ruleEntry: 291 });
    expect(detail.completion).toEqual({ available: true, history: [] });

    const saved = await complete(db, 'r1', { purpose: 'تجهيز سكن العمال', quantityMode: 'single', quantity: 4, taxReviewRef: 'مراجعة ضريبية 2026-Q3' });
    expect(saved).toMatchObject({ saved: true, financialPosting: false, fields: {
      purpose: { before: null, after: 'تجهيز سكن العمال' }, taxReviewRef: { before: null, after: 'مراجعة ضريبية 2026-Q3' },
      quantity: { before: { mode: 'single', quantity: null, unitCost: null }, after: { mode: 'single', quantity: 4, unitCost: 25 } } } });
    detail = await read(db, 'r1');
    // The rule's entry is the review evidence once the purpose is written.
    expect(detail).toMatchObject({ workflowStage: 'complete', issues: [], paymentProof: 'founding_rule' });
    expect(detail.resolvedByRule).toContain('الغرض ودليل المراجعة غير مكتملين.');
    const browse = await wb(db, { action: 'browse' });
    expect(browse.items.find(item => item.sourceId === 'r1')).toMatchObject({ workflowStage: 'complete', issueCount: 0 });
    // Amount, payment, tax and every entry stay as they were.
    const row = db.rows.get('variable_expenses/r1');
    expect(row).toMatchObject({ total_variable_cost: 100, payment_method: 'cash', vat_amount: 13.04, vat_deductible: true, quantity: 4, unit_cost: 25 });
    expect(row.payment_status).toBeUndefined();
    expect(row.finance_metadata.fundingType).toBeUndefined();
    expect(ledger(db)).toEqual(entriesBefore);
  });

  it('keeps the blockers when the rule does not apply', async () => {
    const data = reposted();
    data[`journal_entries/${foundingEntryId('doc:variable:r1')}`].status = 'reversed';
    const detail = await read(memoryFinanceDb(data), 'r1');
    expect(detail).toMatchObject({ workflowStage: 'posted_review', paymentProof: null, resolvedByRule: [] });
    expect(detail.issues).toContain('حالة السداد غير مثبتة.');
  });
});

describe('completing a posted document’s non-financial fields', () => {
  const seed = () => ({ 'users/test-admin': { role: 'admin', displayName: 'هادي' }, 'variable_expense_categories/test-category': {},
    'app_settings/accounting': { value: { vatRegistered: false } }, 'chart_of_accounts/5100': {}, 'chart_of_accounts/2000': {} });
  async function posted(db, patch = {}) {
    const p = expensePatch({ purpose: null, ...patch });
    const preview = await wb(db, { action: 'previewCapture', kind: 'variable', requestId: 'c1', patch: p });
    const { sourceId } = await wb(db, { action: 'capture', kind: 'variable', requestId: 'c1', patch: p, previewHash: preview.previewHash, reason: 'تسجيل', confirm: true });
    return sourceId;
  }
  async function approveAndPost(db, sourceId) {
    let detail = await read(db, sourceId);
    await wb(db, { action: 'approve', kind: 'variable', sourceId, sourceHash: detail.sourceHash, postingHash: detail.postingPreview.postingHash, reason: 'اعتماد', confirm: true });
    detail = await read(db, sourceId);
    await wb(db, { action: 'post', kind: 'variable', sourceId, sourceHash: detail.sourceHash, confirm: true });
  }

  it('records who completed what and when, writes no entry or review, and keeps the earlier approval shown as such', async () => {
    const db = memoryFinanceDb(seed()), id = await posted(db, { purpose: 'اختبار' });
    await approveAndPost(db, id);
    expect((await read(db, id)).workflowDimensions.approval.label).toBe('اعتماد النسخة الحالية');
    const entriesBefore = structuredClone(ledger(db)), audits = () => [...db.rows].filter(([p, v]) => p.startsWith('audit_logs/') && v.action === 'finance-complete-posted');
    const first = await complete(db, id, { purpose: 'مواد تنظيف للمغسلة' }, 'سبب أوضح');
    expect(first.fields).toEqual({ purpose: { before: 'اختبار', after: 'مواد تنظيف للمغسلة' } });
    await complete(db, id, { taxReviewRef: 'REF-7', quantityMode: 'single', quantity: 4 });
    const history = db.rows.get(`variable_expenses/${id}`).finance_metadata.postedCompletion;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ byUid: 'test-admin', byName: 'هادي', reason: 'سبب أوضح', atIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(Object.keys(history[1].fields).sort()).toEqual(['quantity', 'taxReviewRef']);
    expect(db.rows.get(`variable_expenses/${id}`)).toMatchObject({ updated_by: 'test-admin', total_variable_cost: 100, quantity: 4, unit_cost: 25, approval_status: 'approved' });
    expect(audits()).toHaveLength(2);
    expect(audits()[0][1]).toMatchObject({ userId: 'test-admin', kind: 'variable', sourceId: id, reason: 'سبب أوضح' });
    expect(ledger(db)).toEqual(entriesBefore);
    const detail = await read(db, id);
    expect(detail.workflowDimensions.approval.label).toBe('اعتُمد قبل الترحيل — استُكملت بعده حقول غير مالية');
    expect(detail.completion.history.map(item => [item.byName, item.fields])).toEqual([['هادي', ['purpose']], ['هادي', ['taxReviewRef', 'quantity']]]);
  });

  it('refuses an unposted record, a stale read, a changed preview, an unchanged value, money fields, and a new gap', async () => {
    const db = memoryFinanceDb(seed()), id = await posted(db);
    let detail = await read(db, id);
    await expect(wb(db, { action: 'previewCompletion', kind: 'variable', sourceId: id, sourceHash: detail.sourceHash, completion: { purpose: 'سبب' } }))
      .rejects.toThrow('الاستكمال للمستند المرحّل فقط');
    await wb(db, { action: 'save', kind: 'variable', sourceId: id, sourceHash: detail.sourceHash, patch: expensePatch(),
      previewHash: (await wb(db, { action: 'preview', kind: 'variable', sourceId: id, sourceHash: detail.sourceHash, patch: expensePatch() })).previewHash,
      reason: 'إكمال قبل الاعتماد', confirm: true });
    await approveAndPost(db, id);
    detail = await read(db, id);
    const ask = completion => wb(db, { action: 'previewCompletion', kind: 'variable', sourceId: id, sourceHash: detail.sourceHash, completion });
    await expect(ask({ amount: 5 })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(ask({ purpose: 'سبب', paymentStatus: 'paid' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(ask({})).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(ask({ quantity: 3 })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(ask({ purpose: 'سبب', quantity: 3 })).rejects.toThrow('حدد طريقة تمثيل الكمية');
    await expect(ask({ purpose: detail.row.finance_metadata.purpose })).rejects.toThrow('لا تغيير لاستكماله');
    await expect(wb(db, { action: 'previewCompletion', kind: 'variable', sourceId: id, sourceHash: 'a'.repeat(64), completion: { purpose: 'سبب جديد' } }))
      .rejects.toThrow('تغير السجل');
    // Lines that do not add up to the amount are a new gap; the record stays as it was.
    const bad = { version: 1, vatAllocation: null, items: [{ id: 'a', description: 'بند', quantity: 1, unit: 'قطعة', unitCost: 40, amount: 40, sourceRef: 'فاتورة' }] };
    await expect(ask({ quantityMode: 'lines', invoiceLines: bad })).rejects.toThrow('مجموع بنود الفاتورة لا يطابق');
    // A printed discount is read by the posting itself: lines that change what it builds are refused outright.
    const discounted = { version: 1, items: [{ id: 'a', description: 'بند', quantity: 1, unit: 'قطعة', unitCost: 120, amount: 120, sourceRef: 'فاتورة' }],
      printedDiscount: { amount: 10, description: 'خصم مطبوع', sourceRef: 'فاتورة' } };
    await expect(ask({ quantityMode: 'lines', invoiceLines: discounted })).rejects.toThrow('يغيّر معالجة القيد');
    const preview = await ask({ purpose: 'سبب جديد' });
    await expect(wb(db, { action: 'complete', kind: 'variable', sourceId: id, sourceHash: detail.sourceHash, completion: { purpose: 'سبب آخر' },
      previewHash: preview.previewHash, reason: 'سبب', confirm: true })).rejects.toThrow('تغيرت المعاينة');
    const request = { action: 'complete', kind: 'variable', sourceId: id, sourceHash: detail.sourceHash, completion: { purpose: 'سبب جديد' },
      previewHash: preview.previewHash, reason: 'سبب', confirm: true };
    await wb(db, request);
    // A repeated request returns the same result; it is not applied twice.
    expect(await wb(db, request)).toMatchObject({ duplicate: true, saved: true });
    expect(db.rows.get(`variable_expenses/${id}`).finance_metadata.postedCompletion).toHaveLength(1);
  });

  it('works on a posted record in a closed month: nothing it changes is in a report', async () => {
    const db = memoryFinanceDb(seed()), id = await posted(db, { purpose: 'اختبار' });
    await approveAndPost(db, id);
    db.rows.set('accounting_periods/2026-10', { status: 'closed' });
    await complete(db, id, { quantityMode: 'lines', invoiceLines: { version: 1, vatAllocation: null, items: [
      { id: 'a', description: 'بند أول', quantity: 2, unit: 'قطعة', unitCost: 30, amount: 60, sourceRef: 'فاتورة' },
      { id: 'b', description: 'بند ثانٍ', quantity: 1, unit: 'قطعة', unitCost: 40, amount: 40, sourceRef: 'فاتورة' }] } });
    expect(db.rows.get(`variable_expenses/${id}`)).toMatchObject({ quantity: null, unit_cost: null, finance_metadata: { invoiceLines: { items: [{ id: 'a' }, { id: 'b' }] } } });
    expect((await read(db, id)).workflowStage).toBe('posted_unproven');
  });
});
