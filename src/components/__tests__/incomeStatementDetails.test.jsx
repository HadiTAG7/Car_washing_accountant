// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ sources: {}, entries: [], accounts: [], partner: false, role: 'admin', loading: false }));
vi.mock('../../hooks/useBikers', () => ({ useBikers: () => ({ bikers: [] }) }));
vi.mock('../../hooks/useWashes', () => ({ useWashes: () => ({ items: [], loading: false }) }));
vi.mock('../../hooks/useVariableExpenses', () => ({ useVariableExpenses: () => ({ items: [], loading: false }) }));
vi.mock('../../hooks/useMonthlyExpenses', () => ({ useMonthlyExpenses: () => ({ items: [], loading: false }) }));
vi.mock('../../hooks/useAnnualExpenses', () => ({ useAnnualExpenses: () => ({ items: [], loading: false }) }));
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => ({ accounts: state.accounts, loading: false }) }));
vi.mock('../../hooks/useFeeRules', () => ({ useFeeRules: () => ({ rules: [] }) }));
vi.mock('../../hooks/useAccountingSettings', () => ({ useAccountingSettings: () => ({ settings: { vatRegistered: true, vatRate: 0.15 } }) }));
vi.mock('../../hooks/useIncomeStatementSources', () => ({ useIncomeStatementSources: () => ({ sources: state.sources,
  entries: state.entries, lines: state.entries.flatMap(entry => entry.lines.map((line, index) => ({ ...line, id: `${entry.id}:${index}`, entryId: entry.id }))), loading: state.loading }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ isPartnerView: state.partner, scalingFactor: state.partner ? 0.5 : 1, role: state.role }) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, missingEnvNames: [], db: {}, callLedger: vi.fn() }));
vi.mock('../../lib/variableExpenseTotals', async original => ({ ...await original(), todayMonth: () => '2026-10' }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../charts/TrendCharts', () => ({ LineTrend: () => null }));
import FinancialSummaryPage from '../FinancialSummaryPage';
import IncomeStatementDetailsModal from '../IncomeStatementDetailsModal';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../lib/accounting/chartOfAccounts';
import { LanguageContext } from '../../i18n/LanguageContext';
import { loadEnglish, setLanguage } from '../../i18n/locale';
import { formatCurrency } from '../../data/initialData';
import { liveIncomeStatement } from '../../lib/accounting/liveIncomeStatement';

beforeEach(() => {
  setLanguage('ar'); state.partner = false; state.role = 'admin'; state.loading = false; state.accounts = DEFAULT_CHART_OF_ACCOUNTS;
  state.sources = { washes: [], variables: [{ id: 'synthetic-expense', expense_name: 'مصروف تجريبي', total_variable_cost: 115,
    invoice_date: '2026-10-03', invoice_number: 'synthetic-invoice', supplier: 'Synthetic supplier', is_tax_invoice: true, vat_amount: 15 }], monthlies: [], annualEntries: [], vouchers: [] };
  state.entries = [{ id: 'synthetic-payroll', entryDate: '2026-10-04', entryNumber: 163, status: 'posted', sourceType: 'payroll',
    sourceId: '2026-09__r1', payrollSnapshot: { periodKey: '2026-09' }, description: 'رواتب تجريبية لشهر سبتمبر',
    lines: [{ accountId: '5010', debit: 6960, credit: 0 }, { accountId: '1010', debit: 0, credit: 6960 }] }];
});
afterEach(() => { cleanup(); setLanguage('ar'); });
const openCosts = () => fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل: يُخصم منه: التكاليف المباشرة والعمولات' }));

describe('statement drilldown UI', () => {
  it('opens the amount from the statement, identifies net cost and its source document, and follows live updates without refetching', () => {
    const { rerender } = render(<FinancialSummaryPage />); openCosts();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('statement-detail-amount').textContent).toBe(formatCurrency(100));
    expect(within(dialog).getByText('مسجل غير مُرحّل')).toBeTruthy();
    const source = within(dialog).getByText('فتح سجل المصدر'); fireEvent.click(source);
    expect(source.closest('button').getAttribute('aria-expanded')).toBe('true');
    expect(within(dialog).getByText('synthetic-expense')).toBeTruthy();
    expect(within(dialog).getByText('الضريبة المنفصلة عن الدخل / التكلفة').nextElementSibling.textContent).toBe(formatCurrency(15));
    state.sources = { ...state.sources, variables: [{ ...state.sources.variables[0], total_variable_cost: 230, vat_amount: 30 }] };
    rerender(<FinancialSummaryPage />);
    expect(screen.getByTestId('statement-detail-amount').textContent).toBe(formatCurrency(200));
  });
  it('offers the salary accrual month, closes the old period, and shows September expense with its October payment date and original journal', () => {
    render(<FinancialSummaryPage />); openCosts();
    fireEvent.change(screen.getByLabelText('فترة التقرير (الشهر)'), { target: { value: '2026-09' } });
    expect(screen.queryByRole('dialog')).toBeNull(); openCosts();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('statement-detail-amount').textContent).toBe(formatCurrency(6960));
    expect(within(dialog).getByText(/فترة استحقاق الراتب/).textContent).toContain('2026-09');
    expect(within(dialog).getAllByText('2026-10-04').length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByText('فتح القيد #163'));
    expect(within(dialog).getByText('synthetic-payroll')).toBeTruthy();
  });
  it('supports the keyboard and calculation component links', () => {
    render(<FinancialSummaryPage />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'عرض تفاصيل: = مجمل الربح التشغيلي' }), { key: 'Enter' });
    expect(screen.getByRole('heading', { name: /تفاصيل الحساب — مجمل الربح/ })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /− التكاليف المباشرة والعمولات/ }));
    expect(screen.getByRole('heading', { name: /تفاصيل الحساب — التكاليف المباشرة/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق التفاصيل' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('links salary excluded from October to its September source details without adding it to October items', () => {
    render(<FinancialSummaryPage />); openCosts();
    expect(screen.getByTestId('statement-detail-amount').textContent).toBe(formatCurrency(100));
    fireEvent.click(screen.getByRole('button', { name: /فتح مصروف الرواتب في 2026-09/ }));
    expect(screen.getByLabelText('فترة التقرير (الشهر)').value).toBe('2026-09');
    expect(screen.getByTestId('statement-detail-amount').textContent).toBe(formatCurrency(6960));
    expect(screen.getByRole('button', { name: 'فتح القيد #163' })).toBeTruthy();
  });
  it.each(['partner', 'supervisor'])('immediately hides an open company record and all drilldown triggers when switching to %s', role => {
    const { rerender } = render(<FinancialSummaryPage />); openCosts();
    state.role = role; state.partner = role === 'partner'; rerender(<FinancialSummaryPage />);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText('synthetic-expense')).toBeNull();
    expect(screen.queryByRole('button', { name: /عرض تفاصيل:/ })).toBeNull();
  });
  it('renders English details, source links and labels', async () => {
    await loadEnglish(); setLanguage('en');
    render(<LanguageContext.Provider value={{ language: 'en' }}><FinancialSummaryPage /></LanguageContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Show details: Minus: direct costs and commissions' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Calculation details — Direct costs and commissions' })).toBeTruthy();
    expect(within(dialog).getByText('Registered, unposted')).toBeTruthy();
    fireEvent.click(within(dialog).getByText('Open source record'));
    expect(within(dialog).getByText('Document / booking number')).toBeTruthy();
    expect(within(dialog).getByText('VAT excluded from income / cost')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Close details' })).toBeTruthy();
  });
  it('states an unexplained remainder explicitly and identifies excluded tax records', () => {
    const statement = liveIncomeStatement({ accounts: state.accounts, periodKey: '2026-10', sources: state.sources });
    statement.details.directCosts.adjustments.push({ kind: 'unexplained', amount: 9 });
    statement.issues = [{ sourceId: 'synthetic-incomplete', reason: 'unresolved_purchase_tax' }];
    render(<IncomeStatementDetailsModal statement={statement} detailKey="directCosts" onClose={() => {}} onSelect={() => {}} />);
    expect(screen.getByText(/جزء غير مفسّر/)).toBeTruthy();
    expect(screen.getByText(/synthetic-incomplete/)).toBeTruthy();
  });
});
