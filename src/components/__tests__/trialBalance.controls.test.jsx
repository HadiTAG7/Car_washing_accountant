// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  role: 'admin', isPartnerView: false,
  accounts: [
    { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit' },
    { code: '5100', nameArabic: 'المصروفات', accountType: 'expense', normalBalance: 'debit' },
    { code: '1510', nameArabic: 'مجمع الإهلاك', accountType: 'asset', normalBalance: 'credit' },
    { code: '1100', nameArabic: 'الذمم المدينة', accountType: 'asset', normalBalance: 'debit' },
  ], entries: [{ id: 'e', status: 'posted', entryDate: '2026-10-01' }],
  lines: [{ entryId: 'e', accountId: '1010', credit: 100 }, { entryId: 'e', accountId: '5100', debit: 100 }],
  loading: false, error: null, refetch: vi.fn(),
}));
const recon = vi.hoisted(() => vi.fn(() => ({ differences: 1, unavailable: 1, monthly: [], rows: [
  { key: 'advances', label: 'العهد والسلف', code: '1300', ledger: 100, page: 140, difference: 40, href: '?page=temporary_expenses', note: 'اختبار' },
  { key: 'vat', label: 'ضريبة المدخلات', code: '1200', ledger: 0, page: null, difference: null, href: '?page=vat', error: 'denied' },
] })));
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => fixture }));
vi.mock('../../hooks/useTrialReconciliation', () => ({ useTrialReconciliation: recon }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => fixture }));
vi.mock('../../data/initialData', () => ({ todayISO: () => '2026-10-23', formatCurrency: n => Number(n).toFixed(2) }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../DateField', () => ({ default: ({ value, onChange, ariaLabel }) => <input aria-label={ariaLabel} value={value} onChange={onChange} /> }));
import TrialBalancePage from '../TrialBalancePage';
afterEach(() => { cleanup(); fixture.isPartnerView = false; recon.mockClear(); });
it('defaults to year to date, shows groups, abnormal balance, exact ledger link and unused accounts on demand', () => {
  render(<TrialBalancePage />);
  expect(screen.getByLabelText('من تاريخ').value).toBe('2026-01-01');
  expect(screen.getByLabelText('إلى تاريخ').value).toBe('2026-10-23');
  expect(screen.getByText('الأصول')).toBeTruthy();
  expect(screen.getAllByText('رصيد غير طبيعي')).toHaveLength(2);
  expect(screen.getAllByRole('link', { name: 'الصندوق' })[0].getAttribute('href')).toBe('?page=ledger&account=1010&from=2026-01-01&to=2026-10-23');
  expect(screen.queryByText('مجمع الإهلاك')).toBeNull();
  fireEvent.click(screen.getByLabelText('عرض كل الحسابات'));
  expect(screen.getByText('مجمع الإهلاك')).toBeTruthy();
  expect(screen.getByText('الذمم المدينة')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-09-01' } });
  expect(screen.getAllByRole('link', { name: 'الصندوق' })[0].getAttribute('href')).toContain('from=2026-09-01');
});
it('exposes current reconciliation basis and failure, without approval or posting actions', () => {
  render(<TrialBalancePage />);
  expect(screen.getByText(/متوازن ما يعني مطابق: 1 فروقات/)).toBeTruthy();
  expect(screen.getByText(/مستقلة عن فلتر حركة الفترة/)).toBeTruthy();
  expect(screen.getByText('غير متاح')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /حفظ|اعتماد|ترحيل/ })).toBeNull();
});
it('does not mount company source readers for a partner simulation', () => {
  fixture.isPartnerView = true;
  render(<TrialBalancePage />);
  expect(recon).not.toHaveBeenCalled();
  expect(screen.queryByText('مطابقة الدفاتر الفرعية')).toBeNull();
});
