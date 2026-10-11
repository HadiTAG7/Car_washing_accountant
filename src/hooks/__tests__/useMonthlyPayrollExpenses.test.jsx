// @vitest-environment jsdom
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: { id: 'admin-a' }, loading: false, call: vi.fn() }));
vi.mock('../useAuth', () => ({ useAuth: () => state }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, callPayroll: state.call }));
import { useMonthlyPayrollExpenses } from '../useMonthlyPayrollExpenses';
const preview = periodKey => ({ periodKey, lines: [{ bikerId: 'a', basicDue: 900 }] });
beforeEach(() => { state.user = { id: 'admin-a' }; state.loading = false; state.call.mockReset(); state.call.mockImplementation(async (_, p) => preview(p.periodKey)); });
afterEach(cleanup);
it('only calls the existing read-only server preview, after authentication and enablement', async () => {
  state.loading = true;
  const hook = renderHook(({ enabled }) => useMonthlyPayrollExpenses('2026-10', { enabled }), { initialProps: { enabled: true } });
  expect(state.call).not.toHaveBeenCalled(); state.loading = false; hook.rerender({ enabled: true });
  await waitFor(() => expect(hook.result.current.data?.total).toBe(900));
  expect(state.call).toHaveBeenCalledExactlyOnceWith('payrollPreview', { periodKey: '2026-10', automaticAdvanceDeduction: true });
  hook.rerender({ enabled: false }); expect(hook.result.current.data).toBeNull();
});
it('does not let an old month response overwrite the selected month', async () => {
  let resolveOld; state.call.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const hook = renderHook(({ month }) => useMonthlyPayrollExpenses(month, { enabled: true }), { initialProps: { month: '2026-09' } });
  hook.rerender({ month: '2026-10' });
  await waitFor(() => expect(hook.result.current.data?.periodKey).toBe('2026-10'));
  await act(async () => resolveOld(preview('2026-09')));
  expect(hook.result.current.data.periodKey).toBe('2026-10');
});
it('reports failure and hides the previous caller data on identity changes', async () => {
  const hook = renderHook(() => useMonthlyPayrollExpenses('2026-10', { enabled: true }));
  await waitFor(() => expect(hook.result.current.data?.total).toBe(900));
  state.user = { id: 'admin-b' }; state.call.mockRejectedValue(new Error('unavailable')); hook.rerender();
  expect(hook.result.current.data).toBeNull();
  await waitFor(() => expect(hook.result.current.error?.message).toBe('unavailable'));
  expect(hook.result.current.data).toBeNull();
});
