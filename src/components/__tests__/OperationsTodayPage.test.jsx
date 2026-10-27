// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ view: { role: 'admin', isPartnerView: false }, hook: vi.fn() }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => mocks.view }));
vi.mock('../../hooks/useOperationsToday', () => ({ useOperationsToday: (...args) => mocks.hook(...args) }));
vi.mock('../../lib/bikerProfile', () => ({ riyadhToday: () => '2026-10-26' }));
vi.mock('../TopBar', () => ({ default: () => null }));
import OperationsTodayPage from '../OperationsTodayPage';
import { operationsToday } from '../../lib/operationsToday';
const value = () => operationsToday({ day: '2026-10-26', today: '2026-10-26', now: Date.parse('2026-10-26T18:00:00Z'),
  bikers: [{ id: 'b', name: 'بايكر اختبار', startDate: '2026-10-01' }], payrollLines: [{ bikerId: 'b', basicDue: 900, daysEntitled: 31, eligibleStart: '2026-10-01', eligibleEnd: '2026-10-31' }], statement: { totalCosts: 30036.57 } });
beforeEach(() => { mocks.view = { role: 'admin', isPartnerView: false }; mocks.hook.mockReturnValue({ value: value(), loading: false, retry: vi.fn() }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('renders idle zero coverage and one cancellation waiting notice in the column header, not every row', () => {
  render(<OperationsTodayPage />);
  const table=screen.getByRole('table',{name:'تشغيل البايكرية'});
  expect(within(table).getByText('0%')).toBeTruthy();
  expect(within(table).getAllByText('بانتظار تفاصيل سويتر')).toHaveLength(1);
  expect(within(table).getByText('بانتظار تفاصيل سويتر').closest('th')).toBeTruthy();
  const row=within(table).getByText('بايكر اختبار').closest('tr');
  expect(row.cells[5].textContent).toBe('—');
  expect(row.textContent).not.toContain('غير متاح');
});
it('explains an unknown snapshot difference without asserting an exact same-time total', () => {
  const v=value(); v.reconciliation={sweater:615,registered:628,unknownAtCutoff:3,difference:null,extractedAt:'2026-10-26T09:00:00+03:00'};
  mocks.hook.mockReturnValue({value:v,loading:false,retry:vi.fn()}); render(<OperationsTodayPage />);
  expect(screen.getByText(/عدد سويتر وقت اللقطة/)).toBeTruthy();
  expect(screen.getByText(/غسلات بلا وقت انتهاء؛ لذلك ما نقدر نحسب الفرق بدقة/)).toBeTruthy();
  expect(screen.queryByText(/المسجل عندنا لنفس الوقت/)).toBeNull();
  expect(screen.queryByText(/مطابقة سويتر تحتاج توقيت/)).toBeNull();
});
it('never mounts company reads for partner preview or unauthorized roles', () => {
  mocks.view.role = 'operator'; const p = render(<OperationsTodayPage />); expect(mocks.hook).not.toHaveBeenCalled();
  mocks.view = { role: 'admin', isPartnerView: true }; p.rerender(<OperationsTodayPage />); expect(mocks.hook).not.toHaveBeenCalled();
});
it('renders stored data and missing-source notices with no editing or financial action', () => {
  render(<OperationsTodayPage />);
  expect(screen.getByRole('table', { name: 'تشغيل البايكرية' })).toBeTruthy();
  expect(screen.getByText('بايكر اختبار')).toBeTruthy(); expect(screen.getAllByText('حسب آخر استيراد').length).toBeGreaterThan(6);
  expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('button', { name: /احفظ|ترحيل|اعتمد|استيراد/ })).toBeNull();
  expect(screen.getByText(/وقت الاستيراد غير متاح/)).toBeTruthy();
});
it('links idle alerts to the existing idle tab', () => {
  const nav = vi.fn(); render(<OperationsTodayPage onNavigate={nav} />);
  fireEvent.click(screen.getByRole('button', { name: /بايكر يومين مكتملين/ }));
  expect(nav).toHaveBeenCalledWith('bikers'); expect(new URLSearchParams(location.search).get('bikerTab')).toBe('idle');
});
it('does not display fake zero totals on loading/failure/conflicting data', () => {
  mocks.hook.mockReturnValue({ value: null, error: new Error('failed'), loading: false, retry: vi.fn() }); render(<OperationsTodayPage />);
  expect(screen.getByRole('alert').textContent).toMatch(/تعذّر تأكيد أرقام التشغيل/); expect(screen.queryByRole('table')).toBeNull();
});
