// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ sources: {}, entries: [], accounts: [], partner: false, role: 'admin', loading: false,
  payroll: [], payrollLoading: false, payrollError: null, snapshot: null, metricsError: null,
  reads: { washes: vi.fn(), variables: vi.fn(), monthly: vi.fn(), annual: vi.fn(), bikers: vi.fn() } }));
vi.mock('../../hooks/useIncomePayrollPreviews', async original => ({ ...await original(), useIncomePayrollPreviews: () => ({ data: state.payroll, loading: state.payrollLoading, error: state.payrollError, refetch: vi.fn() }) }));
vi.mock('../../hooks/useBikers', () => ({ useBikers: options => { state.reads.bikers(options); return { bikers: [] }; } }));
vi.mock('../../hooks/useWashes', () => ({ useWashes: () => { state.reads.washes(); return { items: [], loading: false }; } }));
vi.mock('../../hooks/useVariableExpenses', () => ({ useVariableExpenses: () => { state.reads.variables(); return { items: [], loading: false }; } }));
vi.mock('../../hooks/useMonthlyExpenses', () => ({ useMonthlyExpenses: () => { state.reads.monthly(); return { items: [], loading: false }; } }));
vi.mock('../../hooks/useAnnualExpenses', () => ({ useAnnualExpenses: () => { state.reads.annual(); return { items: [], loading: false }; } }));
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => ({ accounts: state.accounts, loading: false }) }));
// The month list now comes from date bounds (useStatementMonths has its own test).
vi.mock('../../hooks/useStatementMonths', () => ({ useStatementMonths: () => ['2026-10', '2026-09', '2026-08'] }));
vi.mock('../../hooks/usePayroll', () => ({ usePayrollRuns: () => ({ runs: [] }) }));
vi.mock('../../hooks/useSweater', () => ({ useSweaterMetrics: () => ({ snapshot: state.snapshot, loading: false, error: state.metricsError, refetch: vi.fn() }) }));
vi.mock('../../hooks/useFeeRules', () => ({ useFeeRules: () => ({ rules: [] }) }));
vi.mock('../../hooks/useAccountingSettings', () => ({ useAccountingSettings: () => ({ settings: { vatRegistered: true, vatRate: 0.15 } }) }));
vi.mock('../../hooks/useIncomeStatementSources', () => ({ useIncomeStatementSources: () => ({ sources: state.sources,
  entries: state.entries, lines: state.entries.flatMap(entry => entry.lines.map((line, index) => ({ ...line, id: `${entry.id}:${index}`, entryId: entry.id }))), loading: state.loading }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ isPartnerView: state.partner, scalingFactor: state.partner ? 0.5 : 1, role: state.role }) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, missingEnvNames: [], db: {}, callLedger: vi.fn(),
  describeBackendError: e => e.message, maskedProjectRef: () => null }));
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
  vi.clearAllMocks();
  setLanguage('ar'); state.partner = false; state.role = 'admin'; state.loading = false; state.accounts = DEFAULT_CHART_OF_ACCOUNTS;
  state.payroll = []; state.payrollLoading = false; state.payrollError = null;
  state.snapshot = null; state.metricsError = null;
  state.sources = { washes: [], variables: [{ id: 'synthetic-expense', expense_name: 'مصروف تجريبي', total_variable_cost: 115,
    invoice_date: '2026-10-03', invoice_number: 'synthetic-invoice', supplier: 'Synthetic supplier', is_tax_invoice: true, vat_amount: 15 }], monthlies: [], annualEntries: [], vouchers: [] };
  state.entries = [{ id: 'synthetic-payroll', entryDate: '2026-10-04', entryNumber: 163, status: 'posted', sourceType: 'payroll',
    sourceId: '2026-09__r1', payrollSnapshot: { periodKey: '2026-09' }, description: 'رواتب تجريبية لشهر سبتمبر',
    lines: [{ accountId: '5010', debit: 6960, credit: 0 }, { accountId: '1010', debit: 0, credit: 6960 }] }];
});
afterEach(() => { cleanup(); setLanguage('ar'); });
const openCosts = () => fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل: يُخصم منه: التكاليف المباشرة والعمولات' }));

describe('statement drilldown UI', () => {
  it('renders cost reconciliation from the accepted statement and explains salary payment timing', () => {
    render(<FinancialSummaryPage />);
    const box = screen.getByRole('region', { name: 'مطابقة التكاليف بالدفاتر' });
    expect(within(box).getByText('يُخصم: رواتب رُحّلت هذا الشهر وتخص أشهرًا أخرى')).toBeTruthy();
    const gap = within(box).getByText('فرق غير مفسّر').closest('tr');
    expect(gap.textContent).toContain(formatCurrency(0));
    expect(screen.getByText(/من الغسلات المسجلة · المرحّل في الدفتر:/)).toBeTruthy();
  });
  it('shows the annual full-month warning with working details only in a month with annual costs', () => {
    state.sources.annualEntries = [{ id: 'annual', amount: 88500, spent_date: '2026-08-24', description: 'Synthetic annual insurance' }];
    render(<FinancialSummaryPage />);
    expect(screen.queryByText(/هذا الشهر فيه مصاريف سنوية كاملة/)).toBeNull();
    fireEvent.change(screen.getByLabelText('فترة التقرير (الشهر)'), { target: { value: '2026-08' } });
    expect(screen.getByText(/هذا الشهر فيه مصاريف سنوية كاملة/).textContent).toContain(formatCurrency(88500));
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المصاريف السنوية' }));
    expect(screen.getByRole('dialog', { name: 'تفاصيل كشف: المصروفات السنوية المسجلة - أغسطس 2026', exact: true }).textContent).toContain('Synthetic annual insurance');
  });
  it('shows actual monthly Sweater counts, preserves zero, and never keeps an October snapshot in September', () => {
    state.snapshot = { periodKey: '2026-10', metrics: { completedWashes: 501 }, metricSources: { completedWashes: { extractedAtIso: '2026-10-23T14:39:02Z' } } };
    render(<FinancialSummaryPage />);
    expect(screen.getByText('سويتر: 501 غسلة مقابل 0 مسجلة')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('فترة التقرير (الشهر)'), { target: { value: '2026-09' } });
    expect(screen.queryByText(/سويتر: 501/)).toBeNull();
  });
  it('uses overview quantity and SSP deduplication, and displays a measured zero snapshot rather than missing data', () => {
    state.sources.washes = [
      { id: 'synthetic-aggregate', wash_date: '2026-10-04', status: 'مكتملة', quantity: 2, price: 20 },
      { id: 'synthetic-w1', wash_date: '2026-10-04', status: 'مكتملة', quantity: 1, price: 20, ssp_booking_id: 'same' },
      { id: 'synthetic-w2', wash_date: '2026-10-04', status: 'مكتملة', quantity: 1, price: 20, ssp_booking_id: 'same' },
    ];
    state.snapshot = { periodKey: '2026-10', metrics: { completedWashes: 0 } };
    render(<FinancialSummaryPage />);
    expect(screen.getByText('سويتر: 0 غسلة مقابل 3 مسجلة')).toBeTruthy();
  });
  it('keeps snapshot read errors separate from the statement and hides company-wide counts for partners', () => {
    state.metricsError = new Error('Synthetic snapshot unavailable');
    const { rerender } = render(<FinancialSummaryPage />);
    expect(screen.getByText(/تعذرت قراءة لقطة سويتر/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'مطابقة التكاليف بالدفاتر' })).toBeTruthy();
    state.partner = true; state.role = 'partner'; state.metricsError = null;
    state.snapshot = { periodKey: '2026-10', metrics: { completedWashes: 501 } };
    rerender(<FinancialSummaryPage />);
    expect(screen.queryByText(/سويتر: 501/)).toBeNull();
  });
  it('reuses statement snapshots instead of reading the expense and wash registers again', () => {
    render(<FinancialSummaryPage />);
    for (const name of ['washes', 'variables', 'monthly', 'annual']) expect(state.reads[name]).not.toHaveBeenCalled();
    expect(state.reads.bikers).toHaveBeenCalledWith({ enabled: false });
  });
  it('a historical payroll gap blocks the chart, not the verified selected-month income or its details', () => {
    state.payroll = [{ periodKey: '2026-09', unavailable: true }, { periodKey: '2026-10', lines: [{ basicDue: 900 }] }];
    render(<FinancialSummaryPage />); openCosts();
    expect(screen.getByTestId('statement-detail-amount').textContent).toBe(formatCurrency(1000));
    // The six-month trend reads six months, so it loads only when asked for.
    expect(screen.queryByText('تعذّر تأكيد اتجاه الأشهر السابقة')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'عرض الاتجاه' }));
    expect(screen.getByText('تعذّر تأكيد اتجاه الأشهر السابقة')).toBeTruthy();
  });
  it('shows unpaid salaries in the exact statement and drilldown, never an incomplete subtotal while loading or failed', () => {
    state.payroll = [{ periodKey: '2026-10', estimated: true, lines: [{ basicDue: 900, advanceDeduction: 200 }] }];
    const { rerender } = render(<FinancialSummaryPage />); openCosts();
    expect(screen.getByTestId('statement-detail-amount').textContent).toBe(formatCurrency(1000));
    expect(screen.getByText('رواتب مستحقة غير مُرحّلة')).toBeTruthy();
    state.payrollLoading = true; rerender(<FinancialSummaryPage />);
    expect(screen.queryByTestId('statement-detail-amount')).toBeNull();
    expect(screen.queryByRole('button', { name: /عرض تفاصيل:/ })).toBeNull();
    state.payrollLoading = false; state.payrollError = new Error('Payroll source unavailable'); rerender(<FinancialSummaryPage />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /عرض تفاصيل:/ })).toBeNull();
    expect(screen.getByText('Payroll source unavailable')).toBeTruthy();
  });
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
