// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { overviewOperations } from '../../lib/overviewDashboard';
const state = vi.hoisted(() => ({ today: '2026-10-23', overview: null, ledger: null }));
const read = vi.hoisted(() => vi.fn());
vi.mock('../useOverviewDashboard', () => ({ useOverviewDashboard: (...args) => { read(...args); return state.overview; } }));
vi.mock('../useLedger', () => ({ useLedger: () => state.ledger }));
vi.mock('../../lib/washesYesterday', () => ({ riyadhTodayISO: () => state.today }));
const { useExecutiveDailyMetrics, cashAccountBalances } = await import('../useExecutiveDailyMetrics');
afterEach(cleanup);
beforeEach(() => {
  state.today = '2026-10-23'; read.mockClear();
  const washes = [{ id: 'wash', bikerId: 'b', washDate: '2026-10-22', quantity: 7, status: 'مكتملة' }];
  state.overview = { finance: { statement: { netRevenue: 23, totalCosts: 50, netProfit: -27 } }, washes: { items: washes }, workers: { bikers: [] }, operations: overviewOperations({ washes, periodKey: '2026-10', today: state.today }) };
  state.ledger = { accounts: [{ code: '1010', nameArabic: 'الصندوق' }, { code: '1020', nameArabic: 'البنك' }, { code: '1011', parentId: '1010', nameArabic: 'صندوق فرعي' }, { code: '1300', nameArabic: 'عهد' }],
    entries: [{ id: 'posted', status: 'posted', entryDate: '2026-09-01' }, { id: 'draft', status: 'draft', entryDate: '2026-10-01' }],
    lines: [{ entryId: 'posted', accountId: '1010', debit: 0, credit: 123.45 }, { entryId: 'posted', accountId: '1011', debit: 0, credit: 20 },
      { entryId: 'posted', accountId: '1300', debit: 0, credit: 100 }, { entryId: 'draft', accountId: '1010', debit: 999, credit: 0 }], loading: false, error: null };
});
it('reuses the same overview result, current month and Riyadh day without a new financial formula', () => {
  const { result } = renderHook(useExecutiveDailyMetrics);
  expect(read).toHaveBeenCalledWith('2026-10', '2026-10-23');
  expect(result.current.overview).toBe(state.overview);
  expect(result.current.overview.finance.statement.netProfit).toBe(-27);
});
it('uses the cumulative posted ledger including prior-month cash and child accounts, excluding drafts/non-cash', () => {
  expect(cashAccountBalances(state.ledger)).toEqual([
    { code: '1010', name: 'الصندوق', balance: -123.45 }, { code: '1020', name: 'البنك', balance: 0 }, { code: '1011', name: 'صندوق فرعي', balance: -20 },
  ]);
});
it('does not declare a failed, loading or unseeded cash read healthy', () => {
  state.ledger.loading = true;
  const { result, rerender } = renderHook(useExecutiveDailyMetrics); expect(result.current.cash.balances).toBeNull();
  state.ledger.loading = false; state.ledger.error = new Error('read failed'); rerender();
  expect(result.current.cash.error).toBe(state.ledger.error); expect(result.current.cash.balances).toBeNull();
  state.ledger.error = null; state.ledger.accounts = []; rerender(); expect(result.current.cash.error).toBeTruthy();
});
it('uses the same overview wash function across the month boundary, not a zero for yesterday', () => {
  state.today = '2026-11-01';
  const washes = [{ id: 'last', bikerId: 'b', washDate: '2026-10-31', status: 'مكتملة', quantity: 8 }];
  state.overview.washes.items = washes; state.overview.operations = overviewOperations({ washes, periodKey: '2026-11', today: state.today });
  const { result } = renderHook(useExecutiveDailyMetrics);
  expect(result.current.yesterdayOperations.yesterdayQuantity).toBe(8);
  expect(result.current.yesterdayOperations.yesterday).toBe('2026-10-31');
});
