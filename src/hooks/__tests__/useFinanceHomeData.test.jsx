// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFinanceHomeData } from '../useFinanceHomeData';
import { financeLedgerSnapshot } from '../../lib/financeHome';
const state = vi.hoisted(() => ({ overview: null, ledger: null, tax: null, settings: null, feeds: {}, raw: {}, overviewRead: vi.fn() }));
vi.mock('../useOverviewDashboard', () => ({ useOverviewDashboard: (...args) => { state.overviewRead(...args); return state.overview; } }));
vi.mock('../useLedger', () => ({ useLedger: () => state.ledger }));
vi.mock('../useTaxInvoices', () => ({ useTaxInvoices: () => state.tax }));
vi.mock('../useAccountingSettings', () => ({ useAccountingSettings: () => state.settings }));
vi.mock('../useWashes', () => ({ useWashes: () => state.feeds.washes }));
vi.mock('../useBudgets', () => ({ useBudgets: () => state.feeds.budgets }));
vi.mock('../useMonthlyExpenses', () => ({ useMonthlyExpenses: () => state.feeds.monthly }));
vi.mock('../useMonthlyExpenseCategories', () => ({ useMonthlyExpenseCategories: () => state.feeds.monthlyCats }));
vi.mock('../useAnnualExpenses', () => ({ useAnnualExpenses: () => state.feeds.annual }));
vi.mock('../useAnnualExpenseCategories', () => ({ useAnnualExpenseCategories: () => state.feeds.annualCats }));
vi.mock('../useVariableExpenses', () => ({ useVariableExpenses: () => state.feeds.variable }));
vi.mock('../useVariableExpenseCategories', () => ({ useVariableExpenseCategories: () => state.feeds.variableCats }));
vi.mock('../useFirestoreQuery', () => ({ useFirestoreQuery: (_fetcher, options) => state.raw[options.cacheKey] }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/firestoreCrud', () => ({ fetchRows: vi.fn(() => { throw new Error('No network in this test'); }) }));
const feed = () => ({ items: [], categories: [], data: [], loading: false, error: null, refetch: vi.fn(),
  addItem: vi.fn(() => { throw new Error('No write'); }), updateItem: vi.fn(() => { throw new Error('No write'); }) });
afterEach(cleanup);
beforeEach(() => {
  state.overviewRead.mockClear();
  state.overview = { finance: { statement: { netRevenue: 120, totalCosts: 70, netProfit: 50 }, loading: false },
    settlements: { items: [{ periodKey: '2026-10', status: 'calculated', figures: { netDue: 0 } }, { periodKey: '2026-09', status: 'approved', figures: { netDue: 21 } }], loading: false }, retry: vi.fn() };
  state.ledger = { accounts: [{ code: '1010', accountType: 'asset' }, { code: '1020', accountType: 'asset' }, { code: '3000-A', parentId: '3000', accountType: 'equity' }],
    entries: [{ id: 'X', status: 'posted', entryDate: '2026-09-01' }], lines: [{ entryId: 'X', accountId: '1010', debit: 0, credit: 20 }, { entryId: 'X', accountId: '1020', debit: 120, credit: 0 },
      { entryId: 'X', accountId: '3000-A', debit: 0, credit: 100 }], periods: [], loading: false, error: null, refetch: vi.fn() };
  state.tax = { ...feed(), invoices: [], coverage: { loading: false, error: null } };
  state.settings = { ...feed(), settings: { vatRegistered: false, taxPolicyHistory: [] } };
  state.feeds = Object.fromEntries(['washes', 'budgets', 'monthly', 'monthlyCats', 'annual', 'annualCats', 'variable', 'variableCats'].map(key => [key, feed()]));
  state.raw = Object.fromEntries(['variable_expenses', 'monthly_expenses', 'annual_expense_entries', 'startup_cost_entries', 'posting_locks'].map(key => [key, feed()]));
});
it('reads automatically on mount, reuses the exact operational result and ledger functions without writing', () => {
  const { result } = renderHook(() => useFinanceHomeData('2026-10'));
  expect(state.overviewRead).toHaveBeenCalledWith('2026-10', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  expect(result.current.statement).toBe(state.overview.finance.statement);
  expect(result.current.ledger).toEqual(financeLedgerSnapshot(state.ledger, '2026-10', [
    { code: '1010', name: 'حساب نقدي', balance: -20 }, { code: '1020', name: 'حساب نقدي', balance: 120 }]));
  expect(result.current.settlement.figures.netDue).toBe(0);
  expect(result.current.workbench.pending.count).toBe(0); expect(result.current.problems).toEqual([]);
  for (const source of Object.values(state.feeds)) { expect(source.refetch).not.toHaveBeenCalled(); expect(source.addItem).not.toHaveBeenCalled(); expect(source.updateItem).not.toHaveBeenCalled(); }
});
it('changes the statement and settlement month without carrying the other month or inventing missing figures', () => {
  const { result, rerender } = renderHook(({ month }) => useFinanceHomeData(month), { initialProps: { month: '2026-10' } });
  rerender({ month: '2026-09' }); expect(state.overviewRead).toHaveBeenLastCalledWith('2026-09', expect.any(String));
  expect(result.current.settlement.figures.netDue).toBe(21);
  rerender({ month: '2026-08' }); expect(result.current.settlement).toBeNull(); expect(result.current.settlementReady).toBe(true);
});
it('does not turn partial tax, budget, documents or ledger failures into zero/complete coverage', () => {
  state.tax.coverage.error = new Error('voucher feed failed'); state.feeds.monthlyCats.error = new Error('categories failed');
  state.raw.startup_cost_entries.error = new Error('document feed failed');
  const { result, rerender } = renderHook(() => useFinanceHomeData('2026-10'));
  expect(result.current.vat).toBeNull(); expect(result.current.budget).toBeNull(); expect(result.current.workbench).toBeNull();
  expect(result.current.problems).toEqual(['الضريبة', 'الميزانيات', 'صندوق العمل']);
  state.ledger.loading = true; rerender(); expect(result.current.ledger).toBeNull(); expect(result.current.loading).toBe(true);
});
it('manual refresh refreshes all relevant sources once per cache unit, without invoking any mutation or page reload', () => {
  const { result } = renderHook(() => useFinanceHomeData('2026-10'));
  act(() => result.current.refresh());
  expect(state.overview.retry).toHaveBeenCalledTimes(1); expect(state.ledger.refetch).toHaveBeenCalledTimes(1);
  expect(state.tax.refetch).toHaveBeenCalledTimes(1); expect(state.settings.refetch).toHaveBeenCalledTimes(1);
  for (const source of Object.values(state.feeds)) { expect(source.refetch).toHaveBeenCalledTimes(1); expect(source.addItem).not.toHaveBeenCalled(); }
  for (const key of ['annual_expense_entries', 'startup_cost_entries', 'posting_locks']) expect(state.raw[key].refetch).toHaveBeenCalledTimes(1);
  expect(state.raw.monthly_expenses.refetch).not.toHaveBeenCalled(); expect(state.raw.variable_expenses.refetch).not.toHaveBeenCalled();
});
