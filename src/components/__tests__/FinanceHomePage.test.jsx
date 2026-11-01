// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FinanceHomePage from '../FinanceHomePage';
import { financeFixture } from '../../../server/__tests__/financeFixtures';
const state = vi.hoisted(() => ({ data: null, reports: { teams: [], loading: false, error: false, refresh: vi.fn() } }));
vi.mock('../../hooks/useLatestFinanceOwnerReports', () => ({ useLatestFinanceOwnerReports: () => state.reports }));
vi.mock('../../hooks/useFinanceHomeData', () => ({ useFinanceHomeData: () => state.data }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: 'admin', isPartnerView: false }) }));
vi.mock('../TopBar', () => ({ default: ({ title }) => <h1>{title}</h1> }));
afterEach(cleanup);
beforeEach(() => {
  state.reports = { teams: [], loading: false, error: false, refresh: vi.fn() };
  state.data = { today: '2026-10-23', month: '2026-10', loading: false, problems: [], refresh: vi.fn(),
    statement: { netRevenue: 7640, totalCosts: 30036.57, netProfit: -22396.57 },
    ledger: { postedRevenue: 0, postedCosts: 20839.83, bank: 663937.12, cash: -422957.12,
      availableCash: 240980, capital: 856857.65, negativeAccounts: [{ code: '1010', name: 'الصندوق', balance: -422957.12 }] },
    settlementReady: true, settlement: { status: 'calculated', figures: { netDue: 0, counts: { eligible: 0, imported: 113 } } },
    vat: { netTax: 902.92, unpostedEligible: Array(8).fill({}), unpostedInputTax: 243.08 },
    workbench: { unknownPayment: { count: 4, amount: 410 }, pending: { count: 3, amount: 300 } },
    budget: { month: '2026-10', cards: [{ budget: { amount: 5000 }, spent: 92263.64 }], totals: { remaining: -87263.64 } } };
});
it('does not describe unbudgeted expenditure as a budget overrun', () => {
  state.data.budget = { month: '2026-10', cards: [{ budget: { amount: 0 }, spent: 87263.64 }], totals: { remaining: 0 } };
  render(<FinanceHomePage onNavigate={vi.fn()} />);
  expect(screen.queryByText('ميزانيات متجاوزة')).toBeNull();
  expect(screen.getByRole('region', { name: 'يحتاج إجراء' }).querySelectorAll('li')).toHaveLength(3);
});
it('preserves source-backed amounts and visible actions without exposing the internal workbench', () => {
  const navigate = vi.fn(); render(<FinanceHomePage onNavigate={navigate} />);
  const monthly = screen.getByRole('region', { name: 'نتيجة الشهر' });
  expect(monthly.querySelectorAll('.fm-card')).toHaveLength(4);
  ['7,640.00', '30,036.57', '-22,396.57', '0.00'].forEach(value => expect(monthly.textContent).toContain(value));
  expect(within(monthly).getByText('المرحل في الدفتر: 0.00 ر.س')).toBeTruthy();
  expect(within(monthly).getByText('المرحل: 20,839.83 ر.س')).toBeTruthy();
  expect(monthly.querySelector('.fm-card--loss').textContent).toContain('-22,396.57');
  const money = screen.getByRole('region', { name: 'الفلوس' });
  ['240,980.00', '663,937.12', '-422,957.12', '856,857.65', '902.92'].forEach(value => expect(money.textContent).toContain(value));
  expect(money.querySelector('.fm-negative').textContent).toContain('-422,957.12');
  const actions = screen.getByRole('region', { name: 'يحتاج إجراء' });
  expect(actions.querySelectorAll('li')).toHaveLength(4);
  ['243.08', '0 خدمات مؤهلة من 113 حجز', '-87,263.64'].forEach(value => expect(actions.textContent).toContain(value));
  expect(screen.queryByText('مستندات السداد غير مثبت')).toBeNull();
  expect(screen.queryByText('مستندات بانتظار المراجعة أو الاعتماد أو الترحيل')).toBeNull();
  within(actions).getAllByRole('button').forEach(button => fireEvent.click(button));
  expect(navigate.mock.calls.flat()).toEqual(['vat', 'sweater_settlements', 'budgets']);
  expect(screen.getByText('تفاصيل الأرصدة المبسطة').closest('details').open).toBe(true);
});
it('opens simple balances from the cash card and negative warning without navigating to hidden books', () => {
  const navigate = vi.fn(); render(<FinanceHomePage onNavigate={navigate} />);
  const details = screen.getByText('تفاصيل الأرصدة المبسطة');
  fireEvent.click(screen.getByRole('button', { name: /^النقد المتاح/ }));
  expect(details.closest('details').open).toBe(true); expect(document.activeElement).toBe(details);
  expect(details.closest('details').textContent).toContain('-422,957.12');
  expect(navigate).not.toHaveBeenCalled();
});
it('keeps archived report figures separate from the selected month and refreshes both read sources', () => {
  const report = financeFixture({ metrics: [{ id: 'revenue', value: 999999, unit: 'ر.س', basis: 'operational', asOf: '2026-10-19T09:55:00+03:00' }] });
  state.reports.teams = [{ report, sourceRole: 1 }];
  render(<FinanceHomePage onNavigate={vi.fn()} />);
  const monthly = screen.getByRole('region', { name: 'نتيجة الشهر' });
  expect(monthly.textContent).toContain('7,640.00'); expect(monthly.textContent).not.toContain('999');
  expect(screen.getByRole('region', { name: 'خلاصة فريق المالية' }).textContent).toContain('2026-10-19');
  fireEvent.click(screen.getByRole('button', { name: 'تحديث البيانات' }));
  expect(state.data.refresh).toHaveBeenCalledOnce(); expect(state.reports.refresh).toHaveBeenCalledOnce();
});
it('only declares an empty queue after every source was verified, preserving real zero and green profit', () => {
  Object.assign(state.data, { ledger: { postedRevenue: 0, postedCosts: 0, cash: 0, bank: 0, availableCash: 0, capital: 0, negativeAccounts: [] },
    statement: { netRevenue: 5, totalCosts: 0, netProfit: 5 }, settlement: { status: 'approved', figures: { netDue: 0 } },
    vat: { netTax: 0, unpostedEligible: [], unpostedInputTax: 0 }, workbench: { unknownPayment: { count: 0 }, pending: { count: 0 } },
    budget: { cards: [], totals: { remaining: 0 } } });
  render(<FinanceHomePage onNavigate={vi.fn()} />);
  expect(screen.getByText('ما فيه شي يحتاج إجراء')).toBeTruthy(); expect(document.querySelector('.fm-card--profit')).toBeTruthy();
  expect(screen.queryByText('غير متاح')).toBeNull(); expect(document.querySelectorAll('.fm-actions li')).toHaveLength(0);
});
it('keeps missing settlement distinct from a calculated zero, reports only verified issues on a partial failure', () => {
  Object.assign(state.data, { settlement: null, settlementReady: false, workbench: null, vat: null, budget: null,
    problems: ['صندوق العمل', 'الضريبة'] });
  render(<FinanceHomePage onNavigate={vi.fn()} />);
  expect(screen.getByRole('button', { name: /^المتوقع من سويتر/ }).textContent).toContain('غير متاح');
  expect(document.querySelectorAll('.fm-actions li')).toHaveLength(1);
  expect(screen.queryByText('ما فيه شي يحتاج إجراء')).toBeNull(); expect(document.querySelector('.fm-read-error').textContent).toContain('صندوق العمل');
});
