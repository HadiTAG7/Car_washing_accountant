// @vitest-environment jsdom
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invalidateCollections } from '../../lib/readCache';
const state = vi.hoisted(() => ({ user: { id: 'admin-a' }, loading: false, call: vi.fn() }));
vi.mock('../useAuth', () => ({ useAuth: () => state }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, callPayroll: state.call }));
import { incomePayrollMonths, useIncomePayrollPreviews } from '../useIncomePayrollPreviews';
const months = (_, p) => p.periodKeys.map(periodKey => ({ periodKey, lines: [{ basicDue: 900 }] }));
beforeEach(() => { state.user = { id: 'admin-a' }; state.loading = false; state.call.mockReset();
  state.call.mockImplementation(async (...args) => months(...args)); });
afterEach(cleanup);
it('six earned periods including year boundaries, in ONE read-only server call', async () => {
  expect(incomePayrollMonths('2026-02')).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  const hook = renderHook(() => useIncomePayrollPreviews('2026-10', { enabled: true }));
  await waitFor(() => expect(hook.result.current.data?.length).toBe(6));
  expect(state.call).toHaveBeenCalledTimes(1);
  expect(state.call).toHaveBeenCalledWith('payrollPreviews', { periodKeys: incomePayrollMonths('2026-10') });
  expect(hook.result.current.data.at(-1).periodKey).toBe('2026-10');
});
it('asks only for the months a page uses', async () => {
  const hook = renderHook(() => useIncomePayrollPreviews('2026-10', { enabled: true, months: ['2026-09', '2026-10'] }));
  await waitFor(() => expect(hook.result.current.data?.length).toBe(2));
  expect(state.call).toHaveBeenCalledWith('payrollPreviews', { periodKeys: ['2026-09', '2026-10'] });
});
it('does not fetch while disabled or auth is unresolved, and hides data when changing identity or role', async () => {
  state.loading = true;
  const hook = renderHook(({ enabled }) => useIncomePayrollPreviews('2026-10', { enabled }), { initialProps: { enabled: true } });
  expect(state.call).not.toHaveBeenCalled(); state.loading = false; hook.rerender({ enabled: true });
  await waitFor(() => expect(hook.result.current.data?.length).toBe(6));
  state.user = { id: 'new-user' }; hook.rerender({ enabled: false });
  expect(hook.result.current.data).toEqual([]); expect(state.call).toHaveBeenCalledTimes(1);
});
it('never shows an old month response; coming back is free until a write drops the cache', async () => {
  let oldResolve;
  state.call.mockImplementationOnce((_, p) => new Promise(resolve => { oldResolve = () => resolve(months(_, { periodKeys: p.periodKeys.map(() => '2026-04') })); }));
  const hook = renderHook(({ month }) => useIncomePayrollPreviews(month, { enabled: true }), { initialProps: { month: '2026-09' } });
  hook.rerender({ month: '2026-10' });
  await waitFor(() => expect(hook.result.current.data.at(-1)?.periodKey).toBe('2026-10'));
  await act(async () => oldResolve());
  expect(hook.result.current.data.at(-1).periodKey).toBe('2026-10');
  hook.unmount();
  const calls = state.call.mock.calls.length;
  const again = renderHook(() => useIncomePayrollPreviews('2026-10', { enabled: true }));
  expect(again.result.current.data.at(-1).periodKey).toBe('2026-10');
  expect(state.call).toHaveBeenCalledTimes(calls);
  again.unmount();
  // A wash or payroll write drops server reports (tag `*`): the next mount reads.
  invalidateCollections(['washes']);
  const fresh = renderHook(() => useIncomePayrollPreviews('2026-10', { enabled: true }));
  await waitFor(() => expect(fresh.result.current.data?.length).toBe(6));
  expect(state.call).toHaveBeenCalledTimes(calls + 1);
});
it('fails closed for an unavailable or mismatched required salary source, never substituting a zero', async () => {
  state.call.mockResolvedValue([{ periodKey: '2020-01', lines: [] }]);
  const hook = renderHook(() => useIncomePayrollPreviews('2026-10', { enabled: true }));
  await waitFor(() => expect(hook.result.current.error).toBeTruthy());
  expect(hook.result.current.data).toBeNull();
});
it('the selected month failing on the server is an error with its reason', async () => {
  state.call.mockImplementation(async (_, p) => p.periodKeys.map(periodKey => periodKey === '2026-10'
    ? { periodKey, error: { message: 'غسلة مكررة', code: 'invalid-argument' } } : { periodKey, lines: [] }));
  const hook = renderHook(() => useIncomePayrollPreviews('2026-10', { enabled: true }));
  await waitFor(() => expect(hook.result.current.error?.message).toBe('غسلة مكررة'));
  expect(hook.result.current.error.code).toBe('invalid-argument');
});
it('keeps an older missing preview explicitly unavailable without hiding the verified current month', async () => {
  state.call.mockImplementation(async (_, p) => p.periodKeys.map(periodKey => periodKey === '2026-09'
    ? { periodKey, error: { message: 'Old payroll unavailable', code: 'internal' } } : { periodKey, lines: [{ basicDue: 900 }] }));
  const hook = renderHook(() => useIncomePayrollPreviews('2026-10', { enabled: true }));
  await waitFor(() => expect(hook.result.current.data?.length).toBe(6));
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.data.find(p => p.periodKey === '2026-09')).toEqual({ periodKey: '2026-09', unavailable: true });
  expect(hook.result.current.data.at(-1).lines[0].basicDue).toBe(900);
});
