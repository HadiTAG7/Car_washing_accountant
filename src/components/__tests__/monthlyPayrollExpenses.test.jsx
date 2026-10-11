// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ data: null, loading: false, error: null, role: 'admin', isPartnerView: false, manualSalary: false, payroll: vi.fn(), add: vi.fn(), update: vi.fn() }));
vi.mock('../../hooks/useMonthlyPayrollExpenses', () => ({ useMonthlyPayrollExpenses: (month, options) => { state.payroll(month, options); return { data: state.data, loading: state.loading, error: state.error, refetch: vi.fn() }; } }));
vi.mock('../../hooks/useMonthlyExpenses', () => ({ useMonthlyExpenses: () => ({ items: [
  { id: 'sept', expenseName: 'STC September', totalMonthlyCost: 43, quantity: 1, unitCost: 43, recurrence: 'one_time', loggedDate: '2026-09-23' },
  { id: 'oct', expenseName: 'STC October', totalMonthlyCost: 43.58, quantity: 1, unitCost: 43.58, recurrence: 'one_time', loggedDate: '2026-10-07' },
  ...(state.manualSalary ? [{ id: 'legacy-salary', expenseName: 'راتب يدوي', totalMonthlyCost: 900, quantity: 1, unitCost: 900, recurrence: 'one_time', loggedDate: '2026-10-01' }] : []),
], loading: false, addItem: state.add, updateItem: state.update }) }));
vi.mock('../../hooks/useMonthlyExpenseCategories', () => ({ useMonthlyExpenseCategories: () => ({ categories: [], getCategoryLabel: () => 'اتصالات' }) }));
vi.mock('../../hooks/useAccountingSettings', () => ({ useAccountingSettings: () => ({ settings: {} }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: state.role, isPartnerView: state.isPartnerView, scalingFactor: 1, canMutate: !state.isPartnerView }) }));
vi.mock('../../hooks/useBikers', () => ({ useBikers: () => ({ bikers: [] }) }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../AddMonthlyExpenseModal', () => ({ default: () => null }));
import MonthlyExpensesPage from '../MonthlyExpensesPage';
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-11T12:00:00Z')); state.role = 'admin'; state.isPartnerView = false; state.manualSalary = false;
  state.data = { periodKey: '2026-10', total: 1350, paid: 450, pending: 900, rows: [{ bikerId: 'a', bikerName: 'Worker A', amount: 900, basic: 900, bonus: 0, deduction: 0, paid: false }, { bikerId: 'b', bikerName: 'Worker B', amount: 450, basic: 450, bonus: 0, deduction: 0, paid: true, payDate: '2026-11-01' }] };
  state.loading = false; state.error = null; state.payroll.mockClear(); state.add.mockClear(); state.update.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const card = label => screen.getByText(label, { selector: '.sw-stat-label' }).parentElement.querySelector('.sw-stat-value').textContent;
it('includes pending server payroll in monthly costs before payment, without saving records', () => {
  render(<MonthlyExpensesPage />);
  expect(screen.getByText('رواتب البايكر')).toBeTruthy();
  expect(card('إجمالي المصاريف الشهرية')).toMatch(/1,393.58/);
  expect(card('مصاريف مدفوعة')).toMatch(/450.00/); expect(card('مصاريف معلقة')).toMatch(/943.58/);
  expect(screen.queryByText('STC September')).toBeNull();
  expect(state.add).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});
it('does not double count a manual salary record that may overlap the payroll', () => {
  state.manualSalary = true; render(<MonthlyExpensesPage />);
  expect(card('إجمالي المصاريف الشهرية')).toBe('غير متاح');
  expect(screen.getByRole('alert').textContent).toContain('حتى لا نحتسب الرواتب مرتين');
  expect(screen.queryByText('رواتب البايكر')).toBeNull(); expect(screen.getByText('راتب يدوي')).toBeTruthy();
});
it('keeps loading payroll unavailable rather than assuming zero salaries', () => {
  state.data = null; state.loading = true; render(<MonthlyExpensesPage />);
  expect(card('إجمالي المصاريف الشهرية')).toBe('غير متاح');
  expect(screen.getByText('نحمّل مصروف الرواتب...')).toBeTruthy();
});
it('shows unavailable rather than a partial total when payroll read fails or loads', () => {
  state.data = null; state.error = new Error('unavailable'); render(<MonthlyExpensesPage />);
  expect(card('إجمالي المصاريف الشهرية')).toBe('غير متاح'); expect(screen.getByText('تعذّر تحميل مصروف الرواتب')).toBeTruthy();
});
it.each(['partner', 'operator', 'supervisor'])('does not request or expose raw payroll for role %s', role => {
  state.role = role; state.isPartnerView = role === 'partner'; render(<MonthlyExpensesPage />);
  expect(state.payroll.mock.calls.every(([, options]) => options.enabled === false)).toBe(true);
  expect(screen.queryByText('رواتب البايكر')).toBeNull();
});
it('re-requests the selected month without marking an expense paid', async () => {
  render(<MonthlyExpensesPage />);
  fireEvent.change(screen.getByLabelText('شهر المصاريف'), { target: { value: '2026-09' } });
  await waitFor(() => expect(state.payroll).toHaveBeenLastCalledWith('2026-09', { enabled: true }));
  expect(state.add).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});
