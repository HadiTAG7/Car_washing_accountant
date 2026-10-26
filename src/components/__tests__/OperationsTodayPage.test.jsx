// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
