// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ seller: {}, conflict: false, issue: vi.fn(), documents: [] }));
vi.mock('../../hooks/useSalesDocuments', () => ({ useSalesDocuments: () => ({ seller: m.seller, documents: m.documents, loading: false, error: null, totals: {}, gaps: [], integrityProblems: [], refetch: vi.fn() }) }));
vi.mock('../../hooks/useAccountingSettings', () => ({ useAccountingSettings: () => ({ policyAt: () => ({ known: true, vatRegistered: !m.conflict, vatRate: 0.15 }), loading: false, policyConfigured: true }) }));
vi.mock('../../hooks/useBikers', () => ({ useBikers: () => ({ bikers: [] }) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
vi.mock('../../hooks/useWashes', () => ({ useWashes: () => ({ items: [] }) }));
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => ({ entries: [], refetch: vi.fn() }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ canMutate: true }) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, missingEnvNames: [], describeBackendError: () => '' }));
vi.mock('../../lib/accounting/firestoreInvoicing', () => ({ issueSimplifiedInvoice: (...args) => m.issue(...args) }));
vi.mock('../../lib/accounting/firestoreLedger', () => ({ hasPostedEntryFor: () => false }));
vi.mock('../TopBar', () => ({ default: () => null }));
import SalesDocumentsPage from '../SalesDocumentsPage';
afterEach(cleanup);
beforeEach(() => { m.seller = { name: 'منشأة اختبار', address: 'عنوان', vatNumber: '300000000000003', vatRegistered: true }; m.conflict = false; m.documents = []; m.issue.mockReset(); m.issue.mockResolvedValue({ documentNumber: 'TEST', journalEntryNumber: 1 }); });
function complete() {
  fireEvent.change(screen.getByLabelText(/اسم العميل/), { target: { value: 'عميل اختبار' } });
  fireEvent.change(screen.getByLabelText('عنوان العميل'), { target: { value: 'عنوان عميل' } });
  fireEvent.change(screen.getByLabelText('الرقم الضريبي للعميل'), { target: { value: '311111111111113' } });
  fireEvent.change(screen.getByLabelText('طريقة السداد'), { target: { value: 'cash' } });
  fireEvent.change(screen.getByLabelText('وصف السطر 1'), { target: { value: 'خدمة اختبار' } });
  fireEvent.change(screen.getByLabelText('سعر الوحدة 1'), { target: { value: '23' } });
}
it('puts invoice kind first; payment has no default and collection defaults unpaid', async () => {
  render(<SalesDocumentsPage />);
  expect(screen.getAllByRole('combobox')[0].id).toBe('doc-kind');
  expect(screen.getByLabelText('طريقة السداد').value).toBe('');
  expect(screen.getByLabelText('حالة السداد').value).toBe('unpaid');
  complete(); fireEvent.click(screen.getByRole('button', { name: 'إصدار', exact: true }));
  await waitFor(() => expect(m.issue).toHaveBeenCalledTimes(1));
  expect(m.issue.mock.calls[0][0]).toMatchObject({ invoiceKind: 'standard', paymentStatus: 'unpaid', paymentMethod: 'cash', customer: { name: 'عميل اختبار', address: 'عنوان عميل', vatNumber: '311111111111113' } });
  await waitFor(() => expect(screen.getByLabelText('طريقة السداد').value).toBe(''));
});
it.each(['missing', 'conflict'])('blocks issuer %s even when the sale form is complete', state => {
  if (state === 'missing') m.seller = {}; else m.conflict = true;
  render(<SalesDocumentsPage />); complete();
  const issue = screen.getByRole('button', { name: 'إصدار', exact: true }); expect(issue.disabled).toBe(true); fireEvent.click(issue); expect(m.issue).not.toHaveBeenCalled();
  expect(screen.getByText('الناقص قبل الإصدار:')).toBeTruthy();
});
it('blocks standalone Sweater and routes to settlements; simplified hides business-required fields', () => {
  render(<SalesDocumentsPage />); complete();
  fireEvent.change(screen.getByLabelText(/اسم العميل/), { target: { value: 'شركة اللمسة العصرية التقنية' } });
  expect(screen.getByRole('button', { name: 'إصدار', exact: true }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/اسم العميل/), { target: { value: 'اللمسة العصرية' } });
  expect(screen.getByRole('button', { name: 'إصدار', exact: true }).disabled).toBe(true);
  expect(screen.getByRole('link', { name: 'فاتورة سويتر الشهرية من صفحة التسويات فقط' }).getAttribute('href')).toBe('?page=sweater_settlements');
  fireEvent.change(screen.getByLabelText('نوع المستند'), { target: { value: 'simplified' } });
  expect(screen.queryByLabelText('عنوان العميل')).toBeNull(); expect(screen.getByText(/المبسطة تحمل رمز QR/)).toBeTruthy();
});
