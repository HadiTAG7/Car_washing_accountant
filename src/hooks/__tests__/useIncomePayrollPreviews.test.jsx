// @vitest-environment jsdom
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: { id: 'admin-a' }, loading: false, call: vi.fn() }));
vi.mock('../useAuth', () => ({ useAuth: () => state }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, callPayroll: state.call }));
import { incomePayrollMonths, useIncomePayrollPreviews } from '../useIncomePayrollPreviews';
beforeEach(() => { state.user = { id: 'admin-a' }; state.loading = false; state.call.mockReset();
  state.call.mockImplementation(async (_, p) => ({ periodKey: p.periodKey, lines: [{ basicDue: 900 }] })); });
afterEach(cleanup);
it('uses six earned periods including year boundaries, only the read-only server preview and no mutation', async () => {
  expect(incomePayrollMonths('2026-02')).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  const hook = renderHook(() => useIncomePayrollPreviews('2026-10', { enabled: true }));
  await waitFor(() => expect(hook.result.current.data?.length).toBe(6));
  expect(state.call.mock.calls.map(c => c[0])).toEqual(Array(6).fill('payrollPreview'));
  expect(hook.result.current.data.at(-1).periodKey).toBe('2026-10');
});
it('does not fetch while disabled or auth is unresolved, and hides data when changing identity or role', async () => {
  state.loading = true;
  const hook = renderHook(({ enabled }) => useIncomePayrollPreviews('2026-10', { enabled }), { initialProps: { enabled: true } });
  expect(state.call).not.toHaveBeenCalled(); state.loading = false; hook.rerender({ enabled: true });
  await waitFor(() => expect(hook.result.current.data?.length).toBe(6));
  state.user = { id: 'new-user' }; hook.rerender({ enabled: false });
  expect(hook.result.current.data).toEqual([]); expect(state.call).toHaveBeenCalledTimes(6);
});
it('invalidates payroll on a payment/run revision and never shows an old month response', async () => {
  let oldResolve;
  state.call.mockImplementationOnce(() => new Promise(resolve => { oldResolve = resolve; }));
  const hook = renderHook(({ month, revision }) => useIncomePayrollPreviews(month, { enabled: true, revision }), { initialProps: { month: '2026-09', revision: 'draft' } });
  hook.rerender({ month: '2026-10', revision: 'paid' });
  await waitFor(() => expect(hook.result.current.data.at(-1)?.periodKey).toBe('2026-10'));
  await act(async () => oldResolve({ periodKey: '2026-04', lines: [] }));
  expect(hook.result.current.data.at(-1).periodKey).toBe('2026-10');
  hook.rerender({ month: '2026-10', revision: 'new-partial-payment' });
  expect(hook.result.current.loading).toBe(true); expect(hook.result.current.data).toBeNull();
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
});
it('fails closed for an unavailable or mismatched required salary source, never substituting a zero', async () => {
  state.call.mockResolvedValue({ periodKey: '2020-01', lines: [] });
  const hook = renderHook(() => useIncomePayrollPreviews('2026-10', { enabled: true }));
  await waitFor(() => expect(hook.result.current.error).toBeTruthy());
  expect(hook.result.current.data).toBeNull();
});
it('keeps an older missing preview explicitly unavailable without hiding the verified current month', async () => {
  state.call.mockImplementation(async (_, p) => {
    if (p.periodKey === '2026-09') throw new Error('Old payroll unavailable');
    return { periodKey: p.periodKey, lines: [{ basicDue: 900 }] };
  });
  const hook = renderHook(() => useIncomePayrollPreviews('2026-10', { enabled: true }));
  await waitFor(() => expect(hook.result.current.data?.length).toBe(6));
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.data.find(p => p.periodKey === '2026-09')).toEqual({ periodKey: '2026-09', unavailable: true });
  expect(hook.result.current.data.at(-1).lines[0].basicDue).toBe(900);
});
