// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ seller: {}, issue: vi.fn() }));
vi.mock('../../hooks/useFirestoreQuery', () => ({ useFirestoreQuery: () => ({ data: m.seller, loading: false }) }));
vi.mock('../../hooks/useAccountingSettings', () => ({ useAccountingSettings: () => ({ policyAt: () => ({ known: true, vatRegistered: true }), policyConfigured: true }) }));
vi.mock('../../lib/accounting/firestoreInvoicing', () => ({ fetchSellerProfile: vi.fn(), issueInvoiceForSettlement: (...args) => m.issue(...args) }));
import SettlementInvoicePanel from '../SettlementInvoicePanel';
const approved = { status: 'approved', journalEntryId: 'test-posted', figures: { services: { net: 40, vat: 6, gross: 46 } } };
beforeEach(() => { vi.useRealTimers(); m.seller = { name: 'منشأة اختبار', address: 'عنوان', vatNumber: '300000000000003', vatRegistered: true }; m.issue.mockReset(); });
afterEach(cleanup);
const fillBuyer = () => {
  fireEvent.change(screen.getByLabelText('عنوان سويتر'), { target: { value: 'عنوان اختبار' } });
  fireEvent.change(screen.getByLabelText('الرقم الضريبي لسويتر'), { target: { value: '311111111111113' } });
};
it('keeps monthly issuance disabled before approval or without buyer identity', () => {
  const props = { periodKey: '2026-09', busy: false, onIssue: vi.fn() };
  const view = render(<SettlementInvoicePanel {...props} settlement={{ ...approved, status: 'calculated' }} />);
  fillBuyer(); expect(screen.getByRole('button', { name: 'إصدار فاتورة سويتر الشهرية' }).disabled).toBe(true);
  view.rerender(<SettlementInvoicePanel {...props} settlement={approved} />);
  expect(screen.getByRole('button', { name: 'إصدار فاتورة سويتر الشهرية' }).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('عنوان سويتر'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'إصدار فاتورة سويتر الشهرية' }).disabled).toBe(true);
});
it('one action sends month, issue date and complete Sweater customer, never client amounts', async () => {
  const onIssue = vi.fn(fn => fn());
  render(<SettlementInvoicePanel periodKey="2026-09" settlement={approved} busy={false} onIssue={onIssue} />);
  fillBuyer(); fireEvent.click(screen.getByRole('button', { name: 'إصدار فاتورة سويتر الشهرية' }));
  await waitFor(() => expect(m.issue).toHaveBeenCalledTimes(1));
  expect(m.issue.mock.calls[0]).toEqual(['2026-09', { issueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), customer: {
    name: 'شركة اللمسة العصرية التقنية', address: 'عنوان اختبار', vatNumber: '311111111111113',
  } }]);
});
it('already issued month links to its registered document instead of offering duplicate issuance', () => {
  render(<SettlementInvoicePanel periodKey="2026-09" settlement={{ ...approved, status: 'invoiced', invoiceDocumentId: 'test-doc', invoiceNumber: 'TEST-1' }} />);
  expect(screen.getByRole('link', { name: 'افتح الفاتورة TEST-1' }).getAttribute('href')).toBe('?page=documents&document=test-doc');
  expect(screen.queryByRole('button', { name: 'إصدار فاتورة سويتر الشهرية' })).toBeNull();
});
