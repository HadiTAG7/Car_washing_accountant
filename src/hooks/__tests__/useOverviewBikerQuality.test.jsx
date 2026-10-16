// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
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
it('uses only the existing read contract and keeps a failed worker separate', async () => {
  read.mockImplementation((_op, input) => input.bikerUID === 'b' ? Promise.reject(new Error('failed')) : Promise.resolve({ reports: [] }));
  const { result } = renderHook(() => useOverviewBikerQuality([{ id: 'a' }, { id: 'b' }], '2026-10', true));
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(read).toHaveBeenCalledWith('read', { bikerUID: 'a', periodKey: '2026-10', rulesVersion: 'all-approved', includeSource: true });
  expect(result.current.data.find(r => r.bikerUID === 'b').failed).toBe(true);
});
it('hides stale periods immediately and cancels unstarted reads on identity/period changes', async () => {
  const pending = [];
  read.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const bikers = Array.from({ length: 7 }, (_, i) => ({ id: `worker-${i}` }));
  const { result, rerender } = renderHook(({ month }) => useOverviewBikerQuality(bikers, month, true), { initialProps: { month: '2026-10' } });
  expect(read).toHaveBeenCalledTimes(3);
  rerender({ month: '2026-09' }); expect(result.current.data).toBeNull();
  await act(async () => { pending.slice(0, 3).forEach(resolve => resolve({ reports: [] })); });
  expect(read.mock.calls.filter(([, data]) => data.periodKey === '2026-10')).toHaveLength(3);
  state.partner = true; rerender({ month: '2026-09' });
  expect(result.current.available).toBe(false); expect(result.current.data).toBeNull();
});
