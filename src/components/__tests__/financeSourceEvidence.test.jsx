// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FinanceExpenseForm from '../FinanceExpenseForm';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/financeApi', () => ({ callFinanceApi: api }));
afterEach(cleanup); beforeEach(() => { api.mockReset(); });
const source = () => ({ amount: 20, description: 'TEST synthetic source', spent_date: '2026-10-18', quantity: 2, unit_cost: 10,
  finance_metadata: {} });
const props = detail => ({ kind: 'startup', detail, onSaved: vi.fn(), onMessage: vi.fn(), options: { loading: false, data: { items: [] } } });
it('requires an explicit evidence link for a server-reviewed identity and previews it without inventing an invoice number', async () => {
  const before = { ...source(), invoice_number: null, is_tax_invoice: true, vat_deductible: false };
  api.mockImplementation(async (_route, request) => ({ before, after: { ...before,
    finance_metadata: { reviewedDocumentIdentity: request.patch.reviewedDocumentIdentity } }, previewHash: 'b'.repeat(64), issues: [] }));
  render(<FinanceExpenseForm {...props({ sourceId: 'TEST', sourceHash: 'a'.repeat(64), row: before, issues: [], sourceContext: { reviewedIdentityGrant: { ref: 'TEST-REVIEWED' } } })} />);
  const link = screen.getByRole('checkbox', { name: 'ربط هوية المستند بالرأي المراجع' });
  expect(link.checked).toBe(false); expect(api).not.toHaveBeenCalled();
  fireEvent.click(link);
  expect(screen.getByLabelText('مرجع دليل هوية المستند').value).toBe('');
  fireEvent.change(screen.getByLabelText('مرجع دليل هوية المستند'), { target: { value: 'TEST original reference' } });
  fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(api.mock.calls[0][1]).toMatchObject({ action: 'preview', patch: { invoiceNumber: null, isTaxInvoice: true, vatDeductible: false,
    reviewedDocumentIdentity: { version: 1, grantRef: 'TEST-REVIEWED', sourceRef: 'TEST original reference' } } });
  expect(screen.getByRole('region', { name: 'تغيير أدلة المصدر' })).toBeTruthy();
});

it('offers total-only quantity only for an existing server-authorized source, never a new source', () => {
  const view = render(<FinanceExpenseForm {...props(null)} requestId="TEST" />);
  expect(screen.queryByRole('option', { name: 'إجمالي مثبت — العدد غير متاح بقرار هادي' })).toBeNull(); view.unmount();
  render(<FinanceExpenseForm {...props({ sourceId: 'TEST', row: source(), issues: [], sourceContext: { quantityGrant: { ref: 'TEST-SCOPE' } } })} />);
  expect(screen.getByRole('option', { name: 'إجمالي مثبت — العدد غير متاح بقرار هادي' })).toBeTruthy();
});
it('previews a total-only correction without scalar quantity or fake price and displays before/after evidence and warning', async () => {
  const before = source();
  api.mockImplementation(async (_route, request) => ({ before, after: { ...before, quantity: null, unit_cost: null,
    finance_metadata: { quantityException: request.patch.quantityException } }, previewHash: 'b'.repeat(64), issues: [] }));
  render(<FinanceExpenseForm {...props({ sourceId: 'TEST', sourceHash: 'a'.repeat(64), row: before, issues: [], sourceContext: { quantityGrant: { ref: 'TEST-SCOPE' } } })} />);
  fireEvent.change(screen.getByLabelText('طريقة تمثيل الكمية'), { target: { value: 'total' } });
  expect(screen.queryByLabelText('الكمية')).toBeNull();
  expect(screen.getByText(/لا نفترض كمية واحدة/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('مرجع دليل المبلغ واستثناء العدد'), { target: { value: 'TEST reviewed decision' } });
  fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'تغيير أدلة المصدر' })).toBeTruthy());
  const request = api.mock.calls[0][1];
  expect(request.action).toBe('preview'); expect(request.confirm).toBeUndefined(); expect(request.patch.quantity).toBeUndefined(); expect(request.patch.unit_cost).toBeUndefined();
  expect(request.patch.quantityException).toEqual({ version: 1, grantRef: 'TEST-SCOPE', sourceRef: 'TEST reviewed decision' });
  expect(request.patch.amount).toBe(20); expect(request.patch.invoiceLines).toBeNull(); expect(api).toHaveBeenCalledTimes(1);
});
it('keeps the original allocation fixed, sends only the reviewed link, and requires a source reference', async () => {
  const before = source();
  api.mockImplementation(async (_route, request) => ({ before, after: { ...before, finance_metadata: { documentAllocation: request.patch.documentAllocation } }, previewHash: 'b'.repeat(64), issues: [] }));
  render(<FinanceExpenseForm {...props({ sourceId: 'TEST', sourceHash: 'a'.repeat(64), row: before, issues: [], sourceContext: { allocationGrant: { ref: 'TEST-ALLOCATION' } } })} />);
  expect(screen.getByText(/من إجمالي 280 ريال/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'ربط هذا السجل بحصته المراجعة من الأصل' }));
  expect(screen.getByLabelText('مرجع مراجعة توزيع الأصل').value).toBe('');
  fireEvent.change(screen.getByLabelText('مرجع مراجعة توزيع الأصل'), { target: { value: 'TEST printed rows reviewed' } });
  fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(api.mock.calls[0][1].patch.documentAllocation).toEqual({ version: 1, grantRef: 'TEST-ALLOCATION', sourceRef: 'TEST printed rows reviewed' });
  expect(screen.getByText(/يلزم اكتمال الربط في السجلين/)).toBeTruthy();
});
it('keeps total-only and allocation controls protected on a posted source', () => {
  const row = source(); row.finance_metadata.quantityException = { version: 1, grantRef: 'TEST', sourceRef: 'TEST evidence' };
  row.finance_metadata.documentAllocation = { version: 1, grantRef: 'TEST-GROUP', sourceRef: 'TEST evidence' };
  render(<FinanceExpenseForm {...props({ sourceId: 'TEST', row, issues: [], protectedSource: true, sourceContext: { quantityGrant: { ref: 'TEST' }, allocationGrant: { ref: 'TEST-GROUP' } } })} />);
  for (const label of ['طريقة تمثيل الكمية', 'مرجع دليل المبلغ واستثناء العدد', 'مرجع مراجعة توزيع الأصل']) expect(screen.getByLabelText(label).disabled).toBe(true);
  expect(screen.getByRole('checkbox', { name: 'ربط هذا السجل بحصته المراجعة من الأصل' }).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'احفظ' })).toBeNull(); expect(api).not.toHaveBeenCalled();
});
