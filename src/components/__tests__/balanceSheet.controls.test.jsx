// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ partner: false, assetReady: true, assetReads: vi.fn(), export: vi.fn() }));
vi.mock('../../lib/exportCsv', () => ({ downloadCsv: state.export }));
vi.mock('../../hooks/useLedger', () => import('../../../scripts/balance-sheet-preview/data.jsx'));
vi.mock('../../hooks/useFeeRules', () => import('../../../scripts/balance-sheet-preview/data.jsx'));
vi.mock('../../hooks/useIncomeStatementSources', () => import('../../../scripts/balance-sheet-preview/data.jsx'));
vi.mock('../../hooks/useIncomePayrollPreviews', () => import('../../../scripts/balance-sheet-preview/data.jsx'));
vi.mock('../../hooks/useAccountingSettings', () => import('../../../scripts/balance-sheet-preview/data.jsx'));
vi.mock('../../hooks/useFinanceRead', () => import('../../../scripts/balance-sheet-preview/data.jsx'));
vi.mock('../../lib/firebaseClient', () => import('../../../scripts/balance-sheet-preview/data.jsx'));
vi.mock('../../hooks/useBalanceAssetSources', async () => {
  const data = await import('../../../scripts/balance-sheet-preview/data.jsx');
  return { useBalanceAssetSources: () => { state.assetReads(); return { ...data.useBalanceAssetSources(), assetSourcesReady: state.assetReady }; } };
});
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: 'admin', isPartnerView: state.partner }) }));
vi.mock('../../data/initialData', async importOriginal => ({ ...await importOriginal(), todayISO: () => '2026-10-23' }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../DateField', () => ({ default: ({ value, onChange, ariaLabel }) => <input aria-label={ariaLabel} value={value} onChange={onChange} /> }));
import BalanceSheetPage from '../BalanceSheetPage';
afterEach(() => { cleanup(); state.partner = false; state.assetReady = true; state.assetReads.mockClear(); state.export.mockClear(); });
it('shows comparison, current/noncurrent, separate results and expandable names/types without changing balances', () => {
  const { container } = render(<BalanceSheetPage />);
  expect(screen.getByLabelText('كما في تاريخ').value).toBe('2026-10-23');
  expect(screen.getByLabelText('تاريخ المقارنة').value).toBe('2026-09-30');
  expect(screen.getByText('الأصول المتداولة')).toBeTruthy();
  expect(screen.getByText('الالتزامات غير المتداولة')).toBeTruthy();
  expect(screen.getByText('الخسائر المتراكمة من السنوات السابقة')).toBeTruthy();
  expect(screen.getByText('نتيجة السنة الحالية')).toBeTruthy();
  expect(screen.getByText('ما انسجل إهلاك')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'الأصول الثابتة' }));
  expect(screen.getByText('الدبابات')).toBeTruthy(); expect(screen.getByText('الجوالات')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'رأس مال الشركاء' }));
  expect(screen.getByText('شريك تجريبي')).toBeTruthy();
  expect(container.textContent).not.toContain('3000-demo');
  expect(screen.getByText('المعادلة من القيود المرحّلة بس')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'الرواتب غير المرحلة من قائمة الدخل' }).getAttribute('href')).toBe('?page=finance_payroll');
  expect(screen.queryByRole('button', { name: /حفظ|اعتماد|ترحيل/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'تصدير CSV' }));
  const [, headers, rows] = state.export.mock.calls[0];
  expect(headers).toEqual(['رقم الحساب', 'البند', 'المبلغ']);
  expect(rows).toContainEqual(['1500', 'أصول ثابتة', 190]);
  expect(rows).toContainEqual(['3000-demo', 'رأس مال — شريك تجريبي', 250]);
  expect(rows.filter(row => row[1] === 'إجمالي حقوق الملكية')).toHaveLength(1);
});
it('missing asset source preserves the full balance and does not display a zero intangible split', () => {
  state.assetReady = false; render(<BalanceSheetPage />);
  expect(screen.getByText('تعذر تفصيل الأصول؛ الرصيد الكامل باقٍ دون توزيع افتراضي.')).toBeTruthy();
  expect(screen.queryByText('رسوم انضمام سويتر — أصول غير ملموسة')).toBeNull();
  expect(screen.getByText(/المعادلة المحاسبية متحققة/)).toBeTruthy();
});
it('does not mount company asset detail or unposted readers for partner simulation', () => {
  state.partner = true; render(<BalanceSheetPage />);
  expect(state.assetReads).not.toHaveBeenCalled();
  expect(screen.queryByText('اللي ما ترحّل')).toBeNull();
});
