// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../lib/accounting/chartOfAccounts';
const state = vi.hoisted(() => ({ live: null, payroll: null, fees: null, tax: null, washRead: vi.fn(), bikerRead: vi.fn() }));
vi.mock('../useWashes', () => ({ useWashes: state.washRead }));
vi.mock('../useBikers', () => ({ useBikers: state.bikerRead }));
vi.mock('../useSweater', () => ({ useSweaterBookings: () => ({ bookings: [], loading: false, error: null, refetch: vi.fn() }) }));
vi.mock('../useLedger', () => ({ useLedger: () => ({ accounts: DEFAULT_CHART_OF_ACCOUNTS, loading: false, error: null, refetch: vi.fn() }) }));
vi.mock('../useIncomeStatementSources', () => ({ useIncomeStatementSources: () => state.live }));
vi.mock('../useIncomePayrollPreviews', () => ({ useIncomePayrollPreviews: () => state.payroll }));
vi.mock('../useFeeRules', () => ({ useFeeRules: () => state.fees }));
vi.mock('../useAccountingSettings', () => ({ useAccountingSettings: () => state.tax }));
const { useOverviewDashboard } = await import('../useOverviewDashboard');
beforeEach(() => {
  vi.clearAllMocks();
  state.live = { sources: { washes: [], vouchers: [], monthlies: [], bikers: [] }, entries: [], lines: [], loading: false, error: null };
  state.payroll = { data: [{ periodKey: '2026-10', lines: [{ basicDue: 900 }] }, { periodKey: '2026-09', lines: [{ basicDue: 800 }] }], loading: false, error: null };
  state.fees = { rules: [{ key: 'none', rate: 0 }], loading: false, error: null };
  state.tax = { settings: {}, loading: false, error: null };
});
afterEach(cleanup);
it('maps live operational rows without fetching washes or bikers again', () => {
  state.live = { ...state.live,
    sources: { ...state.live.sources, washes: [{ id: 'w1', quantity: 1, wash_date: '2026-10-16', price: 20, biker_id: 'b1', status: 'مكتملة' }],
      bikers: [{ id: 'b1', name: 'Test biker' }] },
    sourceStatus: { washes: { loading: false, error: null }, bikers: { loading: false, error: null } } };
  const { result, rerender } = renderHook(() => useOverviewDashboard('2026-10', '2026-10-16'));
  expect(result.current.washes.items[0]).toMatchObject({ id: 'w1', washDate: '2026-10-16' });
  expect(result.current.workers.bikers[0]).toMatchObject({ id: 'b1', name: 'Test biker' });
  expect(state.washRead).not.toHaveBeenCalled(); expect(state.bikerRead).not.toHaveBeenCalled();
  expect(result.current.washes.loading).toBe(false);
  expect(result.current.operations.quantity).toBe(1);
  state.live = { ...state.live, error: new Error('payroll source unavailable') };
  rerender();
  expect(result.current.finance.statement).toBeNull();
  expect(result.current.operations.quantity).toBe(1);
  expect(result.current.washes.error).toBeNull();
});
it('uses authoritative unpaid salary once and replaces it with its posting after payment', () => {
  const { result, rerender } = renderHook(() => useOverviewDashboard('2026-10', '2026-10-16'));
  expect(result.current.finance.statement.totalCosts).toBe(900);
  const entry = { id: 'pay', status: 'posted', sourceType: 'payroll', sourceId: '2026-10__r1', entryDate: '2026-11-01', payrollSnapshot: { periodKey: '2026-10' } };
  state.live = { ...state.live, entries: [entry], lines: [{ entryId: 'pay', accountId: '5010', debit: 900 }, { entryId: 'pay', accountId: '1020', credit: 900 }] };
  rerender(); expect(result.current.finance.statement.totalCosts).toBe(900); expect(result.current.finance.statement.salaryAccrual.unposted).toBe(0);
});
it('does not show a partial-month financial comparison, but compares complete historical months', () => {
  const { result, rerender } = renderHook(({ today }) => useOverviewDashboard('2026-10', today), { initialProps: { today: '2026-10-16' } });
  expect(result.current.finance.previous).toBeNull();
  rerender({ today: '2026-11-01' }); expect(result.current.finance.previous.totalCosts).toBe(800);
});
it.each(['payroll', 'fees', 'tax', 'live'])('does not display unconfirmed finance when %s fails, preserving independent operations', source => {
  state[source] = { ...state[source], error: new Error('synthetic') };
  const { result } = renderHook(() => useOverviewDashboard('2026-10', '2026-10-16'));
  expect(result.current.finance.statement).toBeNull(); expect(result.current.finance.error).toBeTruthy();
  expect(result.current.operations.quantity).toBe(0); expect(result.current.quality).toBeUndefined();
});
it('does not turn missing salary previews or legacy duplicate salaries into zero costs', () => {
  state.payroll.data = [];
  const { result, rerender } = renderHook(() => useOverviewDashboard('2026-10', '2026-10-16'));
  expect(result.current.finance.statement).toBeNull();
  state.payroll.data = [{ periodKey: '2026-10', lines: [{ basicDue: 900 }] }];
  state.live = { ...state.live, sources: { ...state.live.sources, monthlies: [{ id: 'legacy', expense_name: 'راتب عامل', recurrence: 'one_time', logged_date: '2026-10-01', total_monthly_cost: 900 }] } };
  rerender(); expect(result.current.finance.statement).toBeNull(); expect(result.current.finance.error).toBeTruthy();
});
