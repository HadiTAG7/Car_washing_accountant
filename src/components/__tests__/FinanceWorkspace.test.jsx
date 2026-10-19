// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceReportsPage from '../FinanceReportsPage';
import FinanceHomePage from '../FinanceHomePage';
import FinanceWorkbenchPage from '../FinanceWorkbenchPage';
import { financeFixture } from '../../../server/__tests__/financeFixtures';
import { LanguageContext } from '../../i18n/LanguageContext';

const mock = vi.hoisted(() => ({ read: vi.fn(), api: vi.fn(), ledger: vi.fn(), role: { role: 'admin', isPartnerView: false } }));
vi.mock('../../hooks/useFinanceRead', () => ({ useFinanceRead: (...args) => mock.read(...args) }));
vi.mock('../../lib/financeApi', () => ({ callFinanceApi: (...args) => mock.api(...args) }));
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => mock.ledger() }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => mock.role }));
vi.mock('../TopBar', () => ({ default: ({ title }) => <h1>{title}</h1> }));
afterEach(cleanup);
beforeEach(() => {
  mock.role.role = 'admin'; mock.role.isPartnerView = false; mock.read.mockReset(); mock.api.mockReset(); mock.ledger.mockReset();
});
const base = data => ({ allowed: true, loading: false, error: null, refresh: vi.fn(), data });
function reports(report = financeFixture()) {
  mock.read.mockImplementation((_endpoint, request) => request.action === 'list'
    ? base({ items: [report] }) : base({ report, currentRevision: 1, history: [{ revision: 1, reason: 'الإصدار الأول' }] }));
}
describe('finance report UI and access boundaries', () => {
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
    expect(mock.ledger).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeTruthy();
  });
  it('keeps missing ledger data unavailable and all six destinations linked to original screens', () => {
    const navigate = vi.fn(); mock.ledger.mockReturnValue({ accounts: [], entries: [], lines: [], error: 'offline', loading: false, needsSeeding: true });
    render(<FinanceHomePage onNavigate={navigate} />);
    expect(screen.getAllByText('غير متاح')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'المتغيرة' })); expect(navigate).toHaveBeenCalledWith('variable');
    fireEvent.click(screen.getByRole('button', { name: 'عرض التقارير والأرشيف' })); expect(navigate).toHaveBeenCalledWith('finance_reports');
    expect(screen.getByRole('heading', { name: 'الرواتب ماليًا' })).toBeTruthy();
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
