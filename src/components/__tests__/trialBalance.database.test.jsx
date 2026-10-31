// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  role: 'admin', isPartnerView: false,
  accounts: [
    { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit' },
    { code: '3000', nameArabic: 'رأس المال', accountType: 'equity', normalBalance: 'credit' },
    { code: '5100', nameArabic: 'المصروفات', accountType: 'expense', normalBalance: 'debit' },
  ], entries: [], lines: [], loading: false, error: null, needsSeeding: false, refetch: vi.fn(),
}));
const mocks = vi.hoisted(() => ({
  ledger: vi.fn(), sums: vi.fn(),
  recon: vi.fn(() => ({ differences: 0, unavailable: 0, monthly: [], rows: [] })),
}));
vi.mock('../../lib/firebaseClient', async load => ({ ...(await load()), dataSource: 'supabase', isFirebaseConfigured: true, missingEnvNames: [] }));
vi.mock('../../hooks/useLedger', () => ({ useLedger: (...args) => { mocks.ledger(...args); return fixture; } }));
vi.mock('../../hooks/useTrialBalanceSums', () => ({ useTrialBalanceSums: (...args) => { mocks.sums(...args); return {
  data: { opening: [{ account_id: '1010', debit: '1000', credit: '0' }, { account_id: '3000', debit: '0', credit: '1000' }],
    movement: [{ account_id: '1010', debit: '0', credit: '250.5' }, { account_id: '5100', debit: '250.5', credit: '0' }] },
  loading: false, error: null, refetch: vi.fn() }; } }));
vi.mock('../../hooks/useTrialReconciliation', () => ({ useTrialReconciliation: mocks.recon }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => fixture }));
vi.mock('../../data/initialData', () => ({ todayISO: () => '2026-10-23', formatCurrency: n => Number(n).toFixed(2) }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../DateField', () => ({ default: ({ value, onChange, ariaLabel }) => <input aria-label={ariaLabel} value={value} onChange={onChange} /> }));
import TrialBalancePage from '../TrialBalancePage';
afterEach(() => { cleanup(); fixture.isPartnerView = false; mocks.ledger.mockClear(); mocks.sums.mockClear(); mocks.recon.mockClear(); });
const row = name => screen.getAllByRole('link', { name })[0].closest('tr').textContent;

it('reads the chart only and takes the balances from the database sums for the chosen period', () => {
  render(<TrialBalancePage />);
  expect(mocks.ledger.mock.calls.every(([options]) => options?.journal === false)).toBe(true);
  expect(mocks.sums).toHaveBeenLastCalledWith({ from: '2026-01-01', to: '2026-10-23', enabled: true });
  expect(row('الصندوق')).toContain('1000.00');
  expect(row('الصندوق')).toContain('250.50');
  expect(row('الصندوق')).toContain('749.50');
  expect(screen.getByText(/الميزان متوازن/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-09-01' } });
  expect(mocks.sums).toHaveBeenLastCalledWith({ from: '2026-09-01', to: '2026-10-23', enabled: true });
  fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-11-01' } });
  expect(mocks.sums).toHaveBeenLastCalledWith({ from: '2026-11-01', to: '2026-10-23', enabled: false });
  expect(screen.getByRole('alert').textContent).toContain('تاريخ البداية');
});

it('loads the journal for the subledger reconciliation only when asked', () => {
  render(<TrialBalancePage />);
  expect(mocks.recon).not.toHaveBeenCalled();
  expect(screen.getByText(/متوازن ما يعني مطابق: مطابقة الدفاتر الفرعية أسفل الصفحة/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'تحميل المطابقة' }));
  expect(mocks.ledger.mock.calls.some(([options]) => options === undefined)).toBe(true);
  expect(mocks.recon).toHaveBeenCalled();
  expect(screen.getByText(/مستقلة عن فلتر حركة الفترة/)).toBeTruthy();
});

it('offers no reconciliation in a partner view', () => {
  fixture.isPartnerView = true;
  render(<TrialBalancePage />);
  expect(screen.queryByRole('button', { name: 'تحميل المطابقة' })).toBeNull();
  expect(mocks.recon).not.toHaveBeenCalled();
});
