// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinancePostedCompletion from '../FinancePostedCompletion';
import FinanceDocumentStatus from '../FinanceDocumentStatus';
import { financeWorkflowDimensions } from '../../lib/financeWorkflowDimensions';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../lib/financeApi', () => ({ callFinanceApi: (...args) => mock.api(...args) }));
afterEach(cleanup); beforeEach(() => mock.api.mockReset());
const hash = 'a'.repeat(64);
const detail = (overrides = {}) => ({ sourceId: 'r1', sourceHash: hash, row: { amount: 100, quantity: null, unit_cost: null, is_tax_invoice: true, vat_amount: 13.04,
  finance_metadata: {} }, completion: { available: true, history: [] }, ...overrides });

describe('«استكمال المستند المرحّل» in the document form', () => {
  it('appears only on a posted document', () => {
    const { container } = render(<FinancePostedCompletion kind="startup" detail={detail({ completion: { available: false, history: [] } })} onDone={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('sends only the changed non-financial fields, shows the treatment unchanged, then saves with a reason and re-reads', async () => {
    const done = vi.fn(), message = vi.fn();
    render(<FinancePostedCompletion kind="startup" detail={detail()} onDone={done} onMessage={message} />);
    const previewButton = screen.getByRole('button', { name: 'معاينة الاستكمال' });
    expect(previewButton).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('سبب المصروف للمشروع'), { target: { value: 'تجهيز سكن العمال' } });
    fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('مرجع مراجعة الضريبة'), { target: { value: 'مراجعة 2026-Q3' } });
    const completion = { purpose: 'تجهيز سكن العمال', taxReviewRef: 'مراجعة 2026-Q3', quantityMode: 'single', quantity: 4 };
    mock.api.mockResolvedValueOnce({ previewHash: 'b'.repeat(64), treatmentUnchanged: true, fields: {
      purpose: { before: null, after: 'تجهيز سكن العمال' }, quantity: { before: { mode: 'single', quantity: null, unitCost: null }, after: { mode: 'single', quantity: 4, unitCost: 25 } } } });
    fireEvent.click(previewButton);
    await screen.findByRole('table', { name: 'معاينة الاستكمال' });
    expect(mock.api).toHaveBeenCalledWith('finance-workbench', { action: 'previewCompletion', kind: 'startup', sourceId: 'r1', sourceHash: hash, completion });
    expect(screen.getByRole('table').textContent).toContain('كمية متجانسة: 4 × 25');
    expect(screen.getByText(/معالجة القيد لم تتغير/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'احفظ الاستكمال' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('سبب الاستكمال'), { target: { value: 'من الفاتورة الأصلية' } });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox'));
    mock.api.mockResolvedValueOnce({ saved: true });
    fireEvent.click(save);
    await waitFor(() => expect(done).toHaveBeenCalledWith('r1'));
    expect(mock.api).toHaveBeenLastCalledWith('finance-workbench', { action: 'complete', kind: 'startup', sourceId: 'r1', sourceHash: hash, completion,
      previewHash: 'b'.repeat(64), reason: 'من الفاتورة الأصلية', confirm: true });
    expect(message.mock.calls[0][0]).toContain('لم يتغير المبلغ ولا الحسابات ولا القيود');
  });

  it('shows the server’s refusal and the history of who completed what', async () => {
    render(<FinancePostedCompletion kind="startup" detail={detail({ row: { amount: 100, finance_metadata: { purpose: 'قديم' } },
      completion: { available: true, history: [{ byName: 'هادي', atIso: '2026-10-30T09:00:00.000Z', reason: 'من الفاتورة', fields: ['purpose', 'quantity'] }] } })} onDone={vi.fn()} />);
    expect(screen.getByText(/سجل الاستكمال \(1\)/)).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toContain('سبب المصروف للمشروع، الكمية وطريقتها — هادي');
    fireEvent.change(screen.getByLabelText('سبب المصروف للمشروع'), { target: { value: 'جديد' } });
    mock.api.mockRejectedValueOnce(new Error('هذا الاستكمال يغيّر معالجة القيد'));
    fireEvent.click(screen.getByRole('button', { name: 'معاينة الاستكمال' }));
    expect((await screen.findByRole('alert')).textContent).toContain('يغيّر معالجة القيد');
  });
});

describe('blockers resolved by the founding-period rule', () => {
  it('are listed apart with the rule’s entry, not as blockers', () => {
    const dimensions = financeWorkflowDimensions({ row: {}, issues: ['الكمية وسعر الوحدة لا يطابقان الإجمالي.'], paymentProven: true, paymentProof: 'founding_rule',
      paymentRule: 'payment_correction', paymentRuleEntry: 291, postingHistory: { active: [{}], reversed: [{}] },
      resolvedByRule: ['حالة السداد غير مثبتة.', 'الحساب المقابل لهذا التمويل غير محسوم؛ لا يفترض الصندوق أو البنك.', 'الغرض ودليل المراجعة غير مكتملين.'] });
    expect(dimensions.postingBlockers).toHaveLength(1);
    render(<FinanceDocumentStatus dimensions={dimensions} />);
    const section = screen.getByRole('group', { name: 'محلولة بقاعدة فترة التأسيس' });
    expect(section.textContent).toContain('محلولة بقاعدة فترة التأسيس (3)');
    expect(section.textContent).toContain('#291');
    expect(section.textContent).toContain('«تصحيح جهة دفع» المرحّل إلى 2300');
    expect(section.textContent).toContain('إثبات السداد: حالة السداد غير مثبتة.');
    expect(section.textContent).toContain('دليل المراجعة هو قيد القاعدة، وسبب المصروف مكتوب.');
  });

  it('labels an approval given before the completions', () => {
    const dimensions = financeWorkflowDimensions({ row: { approval_status: 'approved' }, approved: false, approvalBeforeCompletion: true, issues: [] });
    expect(dimensions.approval.label).toBe('اعتُمد قبل الترحيل — استُكملت بعده حقول غير مالية');
  });
});
