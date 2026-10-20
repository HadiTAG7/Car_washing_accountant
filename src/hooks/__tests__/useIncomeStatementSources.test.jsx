// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: { id: 'a' }, role: 'admin', listeners: [] }));
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: mocks.role }) }));
vi.mock('../../lib/firebaseClient', () => ({ db: {}, isFirebaseConfigured: true }));
vi.mock('firebase/firestore', () => ({ collection: (_db, name) => name, onSnapshot: (name, next, error) => {
  const stop = vi.fn(); mocks.listeners.push({ name, next, error, stop }); return stop;
} }));
import { useIncomeStatementSources } from '../useIncomeStatementSources';
beforeEach(() => { mocks.user = { id: 'a' }; mocks.role = 'admin'; mocks.listeners = []; });
afterEach(cleanup);
const emit = (listener, rows) => act(() => listener.next({ docs: rows.map(row => ({ id: row.id, data: () => row })) }));
it('reflects saved changes and journal lines immediately without a refresh', () => {
  const { result } = renderHook(useIncomeStatementSources);
  expect(result.current.loading).toBe(true);
  for (const listener of mocks.listeners) emit(listener, []);
  expect(result.current.loading).toBe(false);
  const washes = mocks.listeners.find(row => row.name === 'washes');
  emit(washes, [{ id: 'w', price: 20 }]);
  expect(result.current.sources.washes[0].price).toBe(20);
  emit(washes, [{ id: 'w', price: 23 }]);
  expect(result.current.sources.washes).toHaveLength(1);
  expect(result.current.sources.washes[0].price).toBe(23);
  emit(mocks.listeners.find(row => row.name === 'journal_entries'), [{ id: 'j', lines: [{ accountId: '4000', credit: 20 }] }]);
  expect(result.current.lines[0]).toMatchObject({ entryId: 'j', credit: 20 });
});
it('keeps source errors separate so verified washes remain usable when payroll fails', () => {
  const { result } = renderHook(useIncomeStatementSources);
  for (const listener of mocks.listeners) if (listener.name !== 'payroll_runs') emit(listener, []);
  const failure = new Error('payroll unavailable');
  act(() => mocks.listeners.find(l => l.name === 'payroll_runs').error(failure));
  expect(result.current.error).toBe(failure);
  expect(result.current.sourceStatus.washes).toEqual({ loading: false, error: null });
  expect(result.current.sourceStatus.payrollRuns).toEqual({ loading: false, error: failure });
});
it('clears previous-account records and ignores late callbacks after changing identity', () => {
  const { result, rerender } = renderHook(useIncomeStatementSources);
  const previous = [...mocks.listeners]; emit(previous[0], [{ id: 'private-a' }]);
  mocks.user = { id: 'b' }; rerender();
  expect(result.current.sources.washes).toEqual([]);
  expect(previous.every(row => row.stop.mock.calls.length === 1)).toBe(true);
  emit(previous[0], [{ id: 'late-a' }]);
  expect(result.current.sources.washes).toEqual([]);
  emit(mocks.listeners.slice(previous.length).find(row => row.name === 'washes'), [{ id: 'b' }]);
  expect(result.current.sources.washes[0].id).toBe('b');
});
it('does not subscribe as a supervisor and unsubscribes when access ends', () => {
  mocks.role = 'supervisor'; const { result, rerender } = renderHook(useIncomeStatementSources);
  expect(mocks.listeners).toHaveLength(0); expect(result.current.loading).toBe(false);
  mocks.role = 'admin'; rerender(); expect(mocks.listeners).toHaveLength(11);
  expect(mocks.listeners.map(l => l.name)).toEqual(expect.arrayContaining(['payroll_runs', 'bikers']));
  mocks.user = null; rerender();
  expect(mocks.listeners.every(row => row.stop.mock.calls.length === 1)).toBe(true);
  expect(result.current.sources.washes).toEqual([]);
});
it('clears salary sources on a role change and never subscribes to payroll runs as a real partner', () => {
  const { result, rerender } = renderHook(useIncomeStatementSources);
  const previous = [...mocks.listeners];
  emit(previous.find(l => l.name === 'payroll_runs'), [{ id: 'private-run', totals: { basic: 900 } }]);
  mocks.role = 'partner'; rerender();
  expect(result.current.sources.payrollRuns).toBeUndefined();
  expect(mocks.listeners.slice(previous.length).map(l => l.name)).not.toContain('payroll_runs');
  emit(previous.find(l => l.name === 'payroll_runs'), [{ id: 'late-private-run' }]);
  expect(result.current.sources.payrollRuns).toBeUndefined();
});
