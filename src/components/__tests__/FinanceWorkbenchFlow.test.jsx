// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FinanceExpenseForm from '../FinanceExpenseForm';
import FinanceWorkbenchPage from '../FinanceWorkbenchPage';
import { financeWorkflowDimensions } from '../../lib/financeWorkflowDimensions';
const mock = vi.hoisted(() => ({ api: vi.fn(), read: vi.fn() }));
vi.mock('../../lib/financeApi', () => ({ callFinanceApi: (...args) => mock.api(...args) }));
vi.mock('../../hooks/useFinanceRead', () => ({ useFinanceRead: (...args) => mock.read(...args) }));
vi.mock('../TopBar', () => ({ default: () => null }));
const base = data => ({ allowed: true, loading: false, error: null, refresh: vi.fn(), data });
const callbacks = () => ({ onSaved: vi.fn(), onMessage: vi.fn(), options: base({ items: [] }) });
beforeEach(() => { mock.api.mockReset(); mock.read.mockReset(); });
afterEach(cleanup);
it('shows corrected posting and financing history read-only without treating missing source evidence as complete', () => {
  const detail = { sourceId: 'synthetic', row: { description: 'أصل مصحح', amount: 100 }, protectedSource: true,
    workflowStage: 'posted_review', issues: ['دليل المصدر ناقص'], paymentProven: false,
    postingHistory: { active: [{ id: 'purchase', number: 137 }, { id: 'payment', number: 138, settlementOf: 'purchase' }],
      reversed: [{ id: 'old', number: 4, reversal: { number: 130 }, mirrorMatched: true }], fundingCorrections: [{ id: 'funding', number: 168 }] } };
  render(<FinanceExpenseForm kind="startup" detail={detail} {...callbacks()} />);
  expect(screen.getByText('مرحل ويحتاج مراجعة')).toBeTruthy();
  const history = screen.getByRole('region', { name: 'القيود السارية وسجل العكس' });
  expect(history.textContent).toContain('#137، #138 (سداد)');
  expect(history.textContent).toContain('الأصل #4 معكوس');
  expect(history.textContent).toContain('#130'); expect(history.textContent).toContain('#168');
  expect(screen.queryByRole('button', { name: 'رحّل' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'اعتمد' })).toBeNull();
  expect(screen.getByText('دليل المصدر ناقص')).toBeTruthy(); expect(mock.api).not.toHaveBeenCalled();
});
it('shows a posted stale-context approval as review-needed without offering approval or reposting', () => {
  const detail = { sourceId: 'synthetic-context', sourceHash: 'current', row: { description: 'مستند اختبار', amount: 200, approval_status: 'approved' },
    review: { status: 'approved', sourceHash: 'current', sourceContextHash: 'old' }, sourceContext: { contextHash: 'new' }, approved: false,
    approvalContextChanged: true, protectedSource: true, workflowStage: 'posted_review', issues: [], paymentProven: true,
    workflowNote: 'تغيّرت نسخة أحد جزأي المستند بعد الاعتماد؛ القيد محفوظ، والاعتماد الحالي يحتاج مراجعة.',
    postingHistory: { active: [{ id: 'synthetic-journal', number: 9001 }], reversed: [], fundingCorrections: [] } };
  detail.workflowDimensions = financeWorkflowDimensions(detail, { recorded: true });
  render(<FinanceExpenseForm kind="startup" detail={detail} {...callbacks()} />);
  expect(screen.getByText('مرحل ويحتاج مراجعة')).toBeTruthy();
  expect(screen.getByText('اعتماد سابق — تغيّر سياق المستند')).toBeTruthy();
  expect(screen.getByText(detail.workflowNote)).toBeTruthy();
  expect(screen.queryByText('اعتماد النسخة الحالية')).toBeNull();
  expect(screen.queryByRole('button', { name: 'اعتمد' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'رحّل' })).toBeNull(); expect(mock.api).not.toHaveBeenCalled();
});
it('keeps exactly seven basic fields, opens only tax invoices, hides opaque source codes and never edits existing payment on a warning', () => {
  const detail = { sourceId: 'opaque-secret-id', row: { description: 'تحويل بنكي', amount: 100, spent_date: '2026-10-18', payment_method: 'cash', is_tax_invoice: true }, workflowStage: 'incomplete', issues: [] };
  render(<FinanceExpenseForm kind="annual" detail={detail} {...callbacks()} />);
  expect(screen.getByRole('region', { name: 'الأساسي' }).querySelectorAll('input,select')).toHaveLength(7);
  expect(screen.getByText('الضريبة').closest('details').open).toBe(true);
  expect(screen.getByText('السداد والتمويل').closest('details').open).toBe(false);
  expect(screen.getByText(/طريقة دفع متناقضة:/)).toBeTruthy();
  expect(screen.getByLabelText('طريقة الدفع').value).toBe('cash');
  expect(screen.queryByText('opaque-secret-id')).toBeNull(); expect(mock.api).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).toBeNull();
});
it('only applies a new-document suggestion after explicit confirmation, without inferring funding or payment proof', () => {
  render(<FinanceExpenseForm kind="variable" requestId="TEST" {...callbacks()} />);
  fireEvent.change(screen.getByLabelText('نوع الإيصال للاقتراح فقط'), { target: { value: 'مدى' } });
  expect(screen.getByLabelText('طريقة الدفع').value).toBe('unknown');
  fireEvent.click(screen.getByRole('button', { name: 'تأكيد الاقتراح' }));
  expect(screen.getByLabelText('طريقة الدفع').value).toBe('card');
  expect(screen.getByLabelText('من أين دُفع المبلغ؟').value).toBe('unknown');
  expect(screen.getByLabelText('حالة السداد').value).toBe('unknown'); expect(mock.api).not.toHaveBeenCalled();
});
it('first save is only a preview, second save reuses capture and verifies readback; no approval is sent', async () => {
  const props = callbacks(), preview = { sourceId: 'saved', previewHash: 'b'.repeat(64), before: {}, after: {}, issues: [], postingPreview: { lines: [] } };
  mock.api.mockImplementation(async (_e, request) => request.action === 'previewCapture' ? preview : request.action === 'capture' ? { sourceId: 'saved', sourceHash: 'c'.repeat(64) } : { sourceHash: 'c'.repeat(64) });
  render(<FinanceExpenseForm kind="variable" requestId="TEST" {...props} />);
  fireEvent.change(screen.getByLabelText('الوصف'), { target: { value: 'اختبار حفظ' } });
  fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));
  await waitFor(() => expect(screen.getByText(/لم يُحفظ بعد. راجع المعاينة/)).toBeTruthy());
  expect(mock.api.mock.calls.map(([, r]) => r.action)).toEqual(['previewCapture']);
  fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith('saved'));
  expect(mock.api.mock.calls.map(([, r]) => r.action)).toEqual(['previewCapture', 'capture', 'read']);
  expect(mock.api.mock.calls[1][1]).toMatchObject({ confirm: true, previewHash: preview.previewHash });
});
it('preserves an unsaved form when navigation is declined and supports stage filters without a write', () => {
  const items = [{ kind: 'variable', sourceId: 'a', title: 'الأول', amount: 100, workflowStage: 'incomplete' }, { kind: 'variable', sourceId: 'b', title: 'الثاني', amount: 200, workflowStage: 'ready', approvalReady: true }];
  mock.read.mockImplementation((_e, request) => base(request.action === 'browse' ? { items } : request.action === 'options' ? { items: [] } : { sourceId: request.sourceId, row: { expense_name: request.sourceId === 'a' ? 'الأول' : 'الثاني' }, issues: [] }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<FinanceWorkbenchPage />); fireEvent.change(screen.getByLabelText('الوصف'), { target: { value: 'مسودة لم تحفظ' } });
  fireEvent.click(screen.getByRole('button', { name: /^الثاني/ }));
  expect(confirm).toHaveBeenCalled(); expect(screen.getByLabelText('الوصف').value).toBe('مسودة لم تحفظ');
  fireEvent.click(screen.getByRole('button', { name: /^جاهز للاعتماد 1/ }));
  expect(screen.getByLabelText('الوصف').value).toBe('مسودة لم تحفظ'); expect(mock.api).not.toHaveBeenCalled(); confirm.mockRestore();
});
it('bulk dialog shows count and amount, requires reason and confirmation and calls only the existing approval per document', async () => {
  const items = ['a', 'b'].map(sourceId => ({ kind: 'variable', sourceId, title: `مستند ${sourceId}`, amount: 100, workflowStage: 'ready', approvalReady: true, sourceHash: 'a'.repeat(64), postingHash: 'b'.repeat(64) }));
  const approved = new Set();
  mock.read.mockImplementation((_e, request) => base(request.action === 'browse' ? { items } : request.action === 'options' ? { items: [] } : null));
  mock.api.mockImplementation(async (_e, request) => {
    if (request.action === 'approve') { approved.add(request.sourceId); return { saved: true }; }
    return { sourceHash: 'a'.repeat(64), postingPreview: { postingHash: 'b'.repeat(64) }, approved: approved.has(request.sourceId), approvalReady: true, issues: [] };
  });
  render(<FinanceWorkbenchPage />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'تحديد الجاهز في هذه الصفحة' }));
  fireEvent.click(screen.getByRole('button', { name: 'اعتماد المحدد (2)' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/2 مستند · 200.00/)).toBeTruthy();
  const confirm = dialog.getByRole('button', { name: 'تأكيد الاعتماد الجماعي' }); expect(confirm.disabled).toBe(true);
  fireEvent.change(dialog.getByLabelText('سبب الاعتماد الجماعي'), { target: { value: 'مطابقة مستندات الاختبار' } });
  fireEvent.click(dialog.getByRole('checkbox')); fireEvent.click(confirm);
  await waitFor(() => expect(dialog.getByRole('status').textContent).toContain('تم التحقق من اعتماد 2'));
  expect(mock.api.mock.calls.map(([, r]) => r.action)).toEqual(['read', 'approve', 'read', 'read', 'approve', 'read']);
});
