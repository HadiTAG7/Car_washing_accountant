// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({ role: 'admin', partner: false, user: { id: 'admin-a' } }));
const read = vi.hoisted(() => vi.fn());
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: state.role, isPartnerView: state.partner }) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/bikerQualityApi', () => ({ callBikerQuality: (...args) => read(...args) }));
const { useOverviewBikerQuality } = await import('../useOverviewBikerQuality');
beforeEach(() => { state.role = 'admin'; state.partner = false; state.user = { id: 'admin-a' }; read.mockReset(); read.mockResolvedValue({ reports: [], manual: null }); });
afterEach(cleanup);
it.each(['accountant', 'partner', 'supervisor'])('does not issue quality reads for %s', async role => {
  state.role = role; const { result } = renderHook(() => useOverviewBikerQuality([{ id: 'a' }], '2026-10', true));
  expect(result.current.available).toBe(false); expect(read).not.toHaveBeenCalled();
});
it('reads the whole month in one request and keeps a failed worker separate', async () => {
  read.mockResolvedValue({ results: [{ bikerUID: 'a', data: { reports: [] } }, { bikerUID: 'b', failed: true }] });
  const { result } = renderHook(() => useOverviewBikerQuality([{ id: 'b' }, { id: 'a' }], '2026-10', true));
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith('readMonth', { periodKey: '2026-10', bikerUIDs: ['a', 'b'] });
  expect(result.current.data.find(r => r.bikerUID === 'b').failed).toBe(true);
});
it('an unreadable month marks every worker failed, but a denied one is an error', async () => {
  read.mockRejectedValueOnce(new Error('unavailable'));
  const { result } = renderHook(() => useOverviewBikerQuality([{ id: 'a' }], '2026-10', true));
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(result.current.data).toEqual([{ bikerUID: 'a', failed: true }]);
  read.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
  const denied = renderHook(() => useOverviewBikerQuality([{ id: 'a' }], '2026-09', true));
  await waitFor(() => expect(denied.result.current.error?.code).toBe('permission-denied'));
});
it('hides stale periods immediately, and returning to a month costs no request', async () => {
  read.mockImplementation((_op, input) => Promise.resolve({ results: input.bikerUIDs.map(bikerUID => ({ bikerUID, data: { reports: [] } })) }));
  const bikers = Array.from({ length: 7 }, (_, i) => ({ id: `worker-${i}` }));
  const { result, rerender } = renderHook(({ month }) => useOverviewBikerQuality(bikers, month, true), { initialProps: { month: '2026-10' } });
  await waitFor(() => expect(result.current.available).toBe(true));
  rerender({ month: '2026-09' }); expect(result.current.data).toBeNull();
  await waitFor(() => expect(result.current.available).toBe(true));
  rerender({ month: '2026-10' });
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(read).toHaveBeenCalledTimes(2);
  state.partner = true; rerender({ month: '2026-09' });
  expect(result.current.available).toBe(false); expect(result.current.data).toBeNull();
});
