import { describe, expect, it } from 'vitest';
import { financeBlockerCategory, financeWorkflowDimensions as projectDimensions } from '../financeWorkflowDimensions';
const financeWorkflowDimensions = detail => projectDimensions(detail, { recorded: true });

const example = () => ({ row: { finance_revision: 3, approval_status: 'pending', payment_status: 'paid', payment_method: 'card', paid_date: '2026-10-03',
  invoice_number: null, is_tax_invoice: true, vat_deductible: false, finance_metadata: { taxReviewRef: 'TEST-TAX-OPINION' } },
  review: { sourceHash: 'current', status: 'pending', verificationKind: 'self' }, sourceHash: 'current', approved: false,
  workflowStage: 'incomplete', approvalReady: false, postingReady: false, paymentProven: false,
  issues: ['الحساب المقابل لهذا التمويل غير محسوم؛ لا يفترض الصندوق أو البنك.', 'حقول الفاتورة الضريبية غير مكتملة.'] });

describe('read-only financial status dimensions', () => {
  it('separates a registered, saved pending review from funding/tax posting blockers without changing source facts', () => {
    const detail = example(), before = structuredClone(detail), d = financeWorkflowDimensions(detail);
    expect(d.registration).toMatchObject({ status: 'recorded', label: 'مسجل بالفعل' });
    expect(d.details.saved).toBe(true); expect(d.review.status).toBe('saved_pending'); expect(d.review.recordSaved).toBe(true);
    expect(d.approval.current).toBe(false); expect(d.posting).toMatchObject({ status: 'unposted', ready: false });
    expect(d.sourceGaps).toEqual([]); expect(d.postingBlockers.map(item => item.category)).toEqual(['funding', 'tax']);
    expect(d.sourceFacts).toEqual({ invoiceNumber: null, isTaxInvoice: true, vatDeductible: false, taxReviewRef: 'TEST-TAX-OPINION' });
    expect(d.payment).toMatchObject({ recordedStatus: 'paid', proven: false, method: 'card', paidDate: '2026-10-03' });
    expect(d.compatibilityStage).toBe('incomplete'); expect(detail).toEqual(before);
  });
  it('does not treat a saved review, including one marked approved, as current approval', () => {
    const detail = example(); detail.review.status = 'approved'; detail.row.approval_status = 'approved';
    const d = financeWorkflowDimensions(detail); expect(d.review.recordSaved).toBe(true); expect(d.approval.current).toBe(false);
    expect(d.approval.label).toBe('اعتماد سابق يحتاج مراجعة');
  });
  it('identifies stale saved review without deleting its history or claiming no registration', () => {
    const detail = example(); detail.review.sourceHash = 'older';
    const d = financeWorkflowDimensions(detail); expect(d.review.status).toBe('saved_stale'); expect(d.registration.status).toBe('recorded'); expect(d.details.saved).toBe(true);
  });
  it('distinguishes an existing legacy source with no saved review from an unregistered draft', () => {
    const detail = example(); detail.review = null; delete detail.row.finance_revision;
    const d = financeWorkflowDimensions(detail); expect(d.registration.status).toBe('recorded'); expect(d.details.saved).toBe(false); expect(d.review.status).toBe('not_saved');
    expect(projectDimensions({ row: {}, sourceId: 'generated-but-not-persisted' }).registration.status).toBe('draft');
  });
  it('does not call a review current when its saved source hash is missing', () => {
    const detail = example(); delete detail.review.sourceHash;
    const d = financeWorkflowDimensions(detail); expect(d.review.status).toBe('saved_unknown'); expect(d.review.matchesSource).toBe(false); expect(d.approval.current).toBe(false);
  });
  it('keeps actual source gaps separate and does not infer funding or an invented invoice number', () => {
    const detail = example(); detail.issues.unshift('المورد غير محدد.', 'الكمية وسعر الوحدة لا يطابقان الإجمالي.');
    const d = financeWorkflowDimensions(detail); expect(d.sourceGaps).toHaveLength(2); expect(d.postingBlockers).toHaveLength(4); expect(d.sourceFacts.invoiceNumber).toBeNull();
  });
  it.each([
    [{ active: [{ id: 'one' }], reversed: [] }, true, 'posted'],
    [{ active: [], reversed: [{ id: 'one' }] }, true, 'reversed'],
    [{ active: [], reversed: [] }, true, 'protected'],
  ])('preserves registration for posted/reversed/protected source history', (postingHistory, protectedSource, status) => {
    const d = financeWorkflowDimensions({ ...example(), postingHistory, protectedSource });
    expect(d.registration.status).toBe('recorded'); expect(d.posting.status).toBe(status); expect(d.posting.ready).toBe(false);
  });
  it('reports proven payment only from the existing verified flag and never turns unknown into unpaid or zero', () => {
    const detail = example(); detail.row.payment_status = 'unknown'; detail.row.vat_deductible = undefined;
    const d = financeWorkflowDimensions(detail); expect(d.payment.recordedStatus).toBe('unknown'); expect(d.payment.proven).toBe(false); expect(d.sourceFacts.vatDeductible).toBeNull();
    expect(financeWorkflowDimensions({ ...detail, paymentProven: true }).payment.proven).toBe(true);
  });
  it.each([
    ['تاريخ السداد الفعلي غير مثبت.', 'payment'], ['السياسة التاريخية غير مهيأة لهذا التاريخ.', 'policy'],
    ['ربط التوزيع غير مكتمل في السجل الآخر؛ يُحفظ التصحيح دون اعتماد حتى يكتمل.', 'allocation'],
    ['المورد غير محدد.', 'source'], ['شرط مراجعة جديد غير معروف', 'review'],
  ])('categorizes %s without removing the original blocker', (message, category) => {
    expect(financeBlockerCategory(message)).toBe(category);
    expect(financeWorkflowDimensions({ ...example(), issues: [message] }).postingBlockers[0]).toEqual({ category, text: message });
  });
});
