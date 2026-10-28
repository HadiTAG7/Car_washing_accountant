// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import FinanceExpenseForm from '../FinanceExpenseForm';
import { syntheticFinanceInvoiceLines, syntheticSharedInvoiceLines } from '../../../server/__tests__/financeFixtures';
const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/financeApi', () => ({ callFinanceApi: (...args) => api(...args) }));
afterEach(cleanup); beforeEach(() => api.mockReset());
const props = () => ({ kind: 'variable', onSaved: vi.fn(), onMessage: vi.fn(), options: { loading: false, data: { items: [] } } });
const row = () => ({ expense_name: 'فاتورة اختبار متعددة', total_variable_cost: 50, logged_date: '2026-10-18', quantity: null, unit_cost: null,
  finance_metadata: { invoiceLines: syntheticFinanceInvoiceLines() } });

it('opens a heterogeneous draft without inventing a quantity, unit or price and requires an explicit source line', () => {
  render(<FinanceExpenseForm {...props()} requestId="TEST-ONLY" />);
  fireEvent.change(screen.getByLabelText('طريقة تمثيل الكمية'), { target: { value: 'lines' } });
  expect(screen.queryByLabelText('الكمية')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'إضافة بند من الفاتورة' }));
  for (const label of ['كمية البند', 'وحدة البند', 'سعر وحدة البند', 'مبلغ البند', 'مرجع البند في المصدر']) expect(screen.getByLabelText(label).value).toBe('');
  expect(api).not.toHaveBeenCalled();
});
it('sends the exact edited lines without a scalar quantity and shows before/after line detail before any save', async () => {
  const before = row(), edited = syntheticFinanceInvoiceLines(); edited.items[0].quantity = 2; edited.items[0].unitCost = 6;
  api.mockResolvedValue({ before, after: { ...before, finance_metadata: { invoiceLines: edited } }, previewHash: 'b'.repeat(64), issues: [] });
  render(<FinanceExpenseForm {...props()} detail={{ sourceId: 'TEST', sourceHash: 'a'.repeat(64), row: before, issues: [] }} />);
  const first = within(screen.getByRole('group', { name: 'البند 1' }));
  fireEvent.change(first.getByLabelText('كمية البند'), { target: { value: '2' } });
  fireEvent.change(first.getByLabelText('سعر وحدة البند'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'تغيير بنود الفاتورة' })).toBeTruthy());
  const request = api.mock.calls[0][1];
  expect(request.action).toBe('preview'); expect(request.confirm).toBeUndefined(); expect(request.patch.quantity).toBeUndefined();
  expect(request.patch.invoiceLines).toEqual(edited); expect(api).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('[object Object]')).toBeNull();
  expect(screen.getByText('بنود الفاتورة قبل التغيير')).toBeTruthy(); expect(screen.getByText('بنود الفاتورة بعد التغيير')).toBeTruthy();
});
it('does not default printed VAT into eligible VAT when the reviewer opens the tax allocation', () => {
  const source = { ...row(), is_tax_invoice: true, vat_amount: 10.66 };
  render(<FinanceExpenseForm {...props()} detail={{ sourceId: 'TEST', row: source, issues: [] }} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'تفصيل أهلية ضريبة البنود من المراجعة' }));
  expect(screen.getByLabelText('ضريبة البنود المطبوعة').value).toBe('10.66');
  expect(screen.getByLabelText('ضريبة البنود المؤهلة — اتركها فارغة إن لم تُحسم').value).toBe('');
  expect(api).not.toHaveBeenCalled();
});
it('keeps protected-source line fields and representation disabled with no business action', () => {
  render(<FinanceExpenseForm {...props()} detail={{ sourceId: 'TEST', row: row(), protectedSource: true, issues: [] }} />);
  expect(screen.getByLabelText('طريقة تمثيل الكمية').disabled).toBe(true);
  expect(screen.getByRole('group', { name: 'البند 1' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'إضافة بند من الفاتورة' }).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'احفظ' })).toBeNull(); expect(api).not.toHaveBeenCalled();
});
it('shows an undivided shared amount while keeping component quantities and missing individual prices truthful', async () => {
  const invoiceLines = syntheticSharedInvoiceLines(), source = { ...row(), total_variable_cost: 2950, finance_metadata: { invoiceLines } };
  api.mockResolvedValue({ before: source, after: source, previewHash: 'b'.repeat(64), issues: [] });
  render(<FinanceExpenseForm {...props()} detail={{ sourceId: 'TEST', sourceHash: 'a'.repeat(64), row: source, issues: [] }} />);
  expect(screen.getByLabelText('المبلغ المشترك المثبت').value).toBe('2950');
  const first = within(screen.getByRole('group', { name: 'البند 1' }));
  expect(first.getByLabelText('كمية البند').value).toBe('1');
  expect(first.getByLabelText('سعر وحدة البند').disabled).toBe(true); expect(first.getByLabelText('سعر وحدة البند').value).toBe('');
  expect(first.getByLabelText('مبلغ البند').value).toBe('');
  fireEvent.change(screen.getByLabelText('ما الذي يشمله المبلغ المشترك؟'), { target: { value: 'بيان مشترك اختباري مؤيد' } });
  fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(api.mock.calls[0][1].action).toBe('preview'); expect(api.mock.calls[0][1].patch.quantity).toBeUndefined();
  expect(api.mock.calls[0][1].patch.invoiceLines.items.every(item => item.unitCost === null && item.amount === null)).toBe(true);
});
