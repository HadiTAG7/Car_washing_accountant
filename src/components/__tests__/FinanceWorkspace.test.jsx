// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceReportsPage from '../FinanceReportsPage';
import FinanceHomePage from '../FinanceHomePage';
import FinanceWorkbenchPage from '../FinanceWorkbenchPage';
import { financeFixture } from '../../../server/__tests__/financeFixtures';
import { LanguageContext } from '../../i18n/LanguageContext';

const mock = vi.hoisted(() => ({ read: vi.fn(), api: vi.fn(), ledger: vi.fn(), home: vi.fn(), role: { role: 'admin', isPartnerView: false } }));
vi.mock('../../hooks/useFinanceRead', () => ({ useFinanceRead: (...args) => mock.read(...args) }));
vi.mock('../../lib/financeApi', () => ({ callFinanceApi: (...args) => mock.api(...args) }));
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => mock.ledger() }));
vi.mock('../../hooks/useFinanceHomeData', () => ({ useFinanceHomeData: (...args) => mock.home(...args) }));
vi.mock('../../hooks/useOverviewDashboard', () => ({ useOverviewDashboard: () => ({ finance: { loading: false, error: null, statement: { netRevenue: 500, totalCosts: 300 } } }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => mock.role }));
vi.mock('../TopBar', () => ({ default: ({ title }) => <h1>{title}</h1> }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  mock.role.role = 'admin'; mock.role.isPartnerView = false; mock.read.mockReset(); mock.api.mockReset(); mock.ledger.mockReset(); mock.home.mockReset();
});
const base = data => ({ allowed: true, loading: false, error: null, refresh: vi.fn(), data });
function reports(report = financeFixture()) {
  mock.read.mockImplementation((_endpoint, request) => request.action === 'list'
    ? base({ items: [report] }) : base({ report, currentRevision: 1, history: [{ revision: 1, reason: 'الإصدار الأول' }] }));
}
describe('finance report UI and access boundaries', () => {
  it('clearly labels an old revision and returns to the latest without restating historical content', () => {
    const first = financeFixture(), latest = financeFixture({ revision: 2, summary: 'ملخص النسخة الثانية', correctionReason: 'تصحيح اختباري' });
    mock.read.mockImplementation((_e, r) => r.action === 'list' ? base({ items: [latest] })
      : base({ report: r.revision === 1 ? first : latest, currentRevision: 2, history: [{ revision: 2, reason: 'تصحيح' }, { revision: 1, reason: 'أول' }] }));
    render(<FinanceReportsPage />); expect(screen.getByText('ملخص النسخة الثانية')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('نسخة التقرير'), { target: { value: '1' } });
    expect(screen.getByText(/نسخة تاريخية معروضة/)).toBeTruthy(); expect(screen.getByText('النسخة المعروضة: 1')).toBeTruthy();
    expect(screen.getByText(first.summary)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'عرض أحدث نسخة' }));
    expect(screen.queryByText(/نسخة تاريخية معروضة/)).toBeNull(); expect(screen.getByText('النسخة المعروضة: 2')).toBeTruthy();
    expect(screen.getByText('ملخص النسخة الثانية')).toBeTruthy();
  });
  it('shows a zero-match filter state without claiming cases were closed and restores all cases', () => {
    reports(); render(<FinanceReportsPage />); fireEvent.click(screen.getByRole('tab', { name: 'المتابعات' }));
    fireEvent.change(screen.getByLabelText('حالة المتابعة'), { target: { value: 'verified_closed' } });
    expect(screen.getByRole('status').textContent).toContain('0 / 1');
    expect(screen.getByText(/لا حالات تطابق التصفية الحالية/)).toBeTruthy(); expect(screen.queryByText('TEST-CASE')).toBeNull();
    fireEvent.change(screen.getByLabelText('حالة المتابعة'), { target: { value: 'all' } });
    expect(screen.getByText('TEST-CASE')).toBeTruthy(); expect(screen.getByRole('status').textContent).toContain('1 / 1');
  });
  it('renders reviewed Arabic verbatim, missing metrics as unavailable, warnings outside tabs, with keyboard interaction', () => {
    reports(); render(<LanguageContext.Provider value={{ language: 'en' }}><FinanceReportsPage /></LanguageContext.Provider>);
    expect(screen.getByText(financeFixture().summary)).toBeTruthy();
    expect(screen.getAllByText('غير متاح').length).toBeGreaterThan(0);
    const first = screen.getByRole('tab', { name: 'الملخص' }); first.focus(); fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'المتابعات' }));
    expect(screen.getByRole('tabpanel').id).toBe('finance-report-cases');
    expect(screen.getByText(financeFixture().visibleWarnings[0].text)).toBeTruthy();
    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(screen.getByRole('tabpanel').id).toBe('finance-report-evidence');
    expect(screen.getByText('المصادر وحدود التغطية')).toBeTruthy();
  });
  it('does not show reports or zero cards on connection failure', () => {
    mock.read.mockReturnValue({ ...base(null), error: 'انقطاع اختبار' }); render(<FinanceReportsPage />);
    expect(screen.getByRole('alert').textContent).toContain('انقطاع اختبار');
    expect(screen.queryByRole('tab')).toBeNull();
  });
  it('denies the direct report/workbench components outside admin', () => {
    mock.read.mockReturnValue({ allowed: false }); const view = render(<FinanceReportsPage />);
    expect(screen.getByText('تقارير المالية التفصيلية للإدارة فقط.')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull(); view.rerender(<FinanceWorkbenchPage />);
    expect(screen.queryByText('تسجيل مستند جديد غير مرحّل')).toBeNull();
  });
  it('hides malformed saved reports instead of improvising a compatible snapshot', () => {
    reports({ ...financeFixture(), reportId: 'invalid' }); render(<FinanceReportsPage />);
    expect(screen.getByRole('alert').textContent).toContain('تعذر التحقق'); expect(screen.queryByRole('tab')).toBeNull();
  });
  it('does not even mount ledger queries for a partner simulation', () => {
    mock.role.isPartnerView = true; render(<FinanceHomePage onNavigate={vi.fn()} />);
    expect(mock.ledger).not.toHaveBeenCalled(); expect(mock.home).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeTruthy();
  });
  it('keeps incomplete sources unavailable, removes duplicate panels, and never claims there are no issues', () => {
    const navigate = vi.fn(); mock.home.mockReturnValue({ today: '2026-10-23', month: '2026-10', problems: ['الدفتر'], loading: false, settlementReady: false });
    render(<FinanceHomePage onNavigate={navigate} />);
    expect(screen.getAllByText('غير متاح')).toHaveLength(7);
    expect(screen.queryByText('صورة واضحة. خطوة موثقة.')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'الرواتب ماليًا' })).toBeNull();
    expect(screen.queryByText('ما فيه شي يحتاج إجراء')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('الدفتر');
    expect(screen.getByRole('status').textContent).toContain('لم يكتمل فحص');
    fireEvent.click(screen.getByRole('button', { name: /^النقد المتاح/ })); expect(navigate).toHaveBeenCalledWith('ledger');
    fireEvent.click(screen.getByRole('button', { name: /^رأس المال المدفوع/ })); expect(navigate).toHaveBeenCalledWith('balance');
    fireEvent.click(screen.getByRole('button', { name: /^الضريبة المستحقة/ })); expect(navigate).toHaveBeenCalledWith('vat');
  });
  it('uses the branded English calendar and filters posted revenue without refetching or writing', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T07:00:00Z'));
    const refetch = vi.fn();
    mock.home.mockImplementation(month => ({ today: '2026-10-19', month, problems: [], loading: false,
      ledger: { postedRevenue: month === '2026-10' ? 120 : 80, negativeAccounts: [] }, refresh: refetch, settlementReady: false }));
    render(<LanguageContext.Provider value={{ language: 'ar' }}><FinanceHomePage onNavigate={vi.fn()} /></LanguageContext.Provider>);
    const trigger = screen.getByRole('button', { name: 'Month' });
    const revenue = () => screen.getByRole('button', { name: /^الإيراد / }).textContent;
    expect(trigger.textContent).toContain('October 2026'); expect(revenue()).toContain('120.00');
    expect(document.querySelector('input[type="month"]')).toBeNull();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Choose month' });
    expect(dialog.parentElement.dir).toBe('ltr'); expect(dialog.textContent).not.toMatch(/[٠-٩]/);
    expect(screen.getByRole('button', { name: 'November 2026' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'September 2026' }));
    expect(trigger.textContent).toContain('September 2026'); expect(revenue()).toContain('80.00');
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
    expect(mock.home).toHaveBeenLastCalledWith('2026-09');
    fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(trigger.textContent).toContain('September 2026'); expect(document.activeElement).toBe(trigger);
    expect(refetch).not.toHaveBeenCalled(); expect(mock.api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تحديث البيانات' })); expect(refetch).toHaveBeenCalledTimes(1);
  });
  it('keeps long record titles and metadata separate and selects a record without a write', () => {
    const title = `مصروف طويل — مستند Q4 — ${'REFERENCE'.repeat(20)}`;
    const items = Array.from({ length: 20 }, (_, i) => ({ sourceId: `TEST-${i}`, title: `${title} ${i}`, amount: 57.34, date: '2026-10-19', paymentStatus: 'unpaid' }));
    mock.read.mockImplementation((_e, r) => base(r.action === 'list' ? { items } : r.action === 'options' ? { items: [] } : null));
    render(<FinanceWorkbenchPage />);
    const list = screen.getByLabelText('سجلات المصروفات');
    expect(list.querySelectorAll('button')).toHaveLength(20);
    const last = list.querySelectorAll('button')[19];
    expect(last.querySelector('strong').textContent).toBe(`${title} 19`);
    expect(last.querySelector('span').textContent).toBe('57.34 ر.س · 2026-10-19');
    expect(last.querySelector('small').textContent).toContain('غير مسدد');
    last.focus(); fireEvent.click(last);
    expect(document.activeElement).toBe(last);
    expect(last.className).toBe('fw-selected');
    expect(mock.read).toHaveBeenLastCalledWith('finance-workbench', { action: 'options', kind: 'variable' });
    expect(mock.read).toHaveBeenCalledWith('finance-workbench', { action: 'read', kind: 'variable', sourceId: 'TEST-19' }, true);
    expect(mock.api).not.toHaveBeenCalled();
  });
  it('requires separate confirmation for approval and disables posting after a form edit', async () => {
    const detail = { sourceId: 'SYNTHETIC', sourceHash: 'a'.repeat(64), stage: 'approved', approved: true,
      row: { expense_name: 'مصروف اختبار', total_variable_cost: 100, quantity: 2, logged_date: '2026-10-19' },
      postingPreview: { ready: true, lines: [] }, issues: [], journalIds: [] };
    mock.read.mockImplementation((_e, r) => base(r.action === 'list' ? { items: [{ sourceId: 'SYNTHETIC', title: 'اختبار' }] }
      : r.action === 'options' ? { items: [] } : detail)); render(<FinanceWorkbenchPage />);
    const post = screen.getByRole('button', { name: 'ترحيل المصروف المعتمد' }); expect(post.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox')); expect(post.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('وصف المصروف'), { target: { value: 'تغيير قيد المراجعة' } });
    expect(post.disabled).toBe(true); expect(mock.api).not.toHaveBeenCalled();
  });
  it('never offers mutation controls for posted sources', () => {
    mock.read.mockImplementation((_e, r) => base(r.action === 'list' ? { items: [{ sourceId: 'TEST', title: 'اختبار' }] } : r.action === 'options' ? { items: [] }
      : { sourceId: 'TEST', sourceHash: 'a'.repeat(64), row: {}, stage: 'protected', protectedSource: true, journalIds: ['ENTRY'], postingPreview: { lines: [] } }));
    render(<FinanceWorkbenchPage />); expect(screen.queryByText('حفظ المصدر غير المرحّل')).toBeNull();
    expect(screen.getByLabelText('وصف المصروف').disabled).toBe(true);
  });
});
