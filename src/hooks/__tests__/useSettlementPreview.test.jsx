// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { __resetReadCache, invalidateCollections } from '../../lib/readCache';
const { callServer, identity } = vi.hoisted(() => ({ callServer: vi.fn(), identity: { id: 'TEST-A' } }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/ledgerTransport', () => ({ callServer }));
vi.mock('../useAuth', () => ({ useAuth: () => ({ session: { user: identity } }) }));
import { useSettlementPreview } from '../useSettlementPreview';
beforeEach(() => {
  __resetReadCache(); identity.id = 'TEST-A';
  callServer.mockReset().mockImplementation(async (_, payload) => ({ periodKey: payload.periodKey, dryRun: true, figures: { netDue: 20 } }));
});
afterEach(cleanup);
it('shares the read on remount and explicitly refreshes without saving calculation', async () => {
  let view = renderHook(() => useSettlementPreview('2026-11', true, null));
  await waitFor(() => expect(view.result.current.data?.periodKey).toBe('2026-11'));
  const firstRead = view.result.current.data.readAtIso;
  expect(callServer).toHaveBeenLastCalledWith('sweaterCalculateSettlement', { periodKey: '2026-11', dryRun: true });
  view.unmount(); view = renderHook(() => useSettlementPreview('2026-11', true, null));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(callServer).toHaveBeenCalledTimes(1);
  expect(view.result.current.data.readAtIso).toBe(firstRead);
  await act(() => view.result.current.refetch());
  expect(callServer).toHaveBeenCalledTimes(2);
});
it('hides previous month/account and rereads invalidated sources and changed saved cut', async () => {
  const view = renderHook(({ period, cut }) => useSettlementPreview(period, true, cut), { initialProps: { period: '2026-11', cut: null } });
  await waitFor(() => expect(view.result.current.data?.periodKey).toBe('2026-11'));
  view.rerender({ period: '2026-10', cut: null }); expect(view.result.current.data).toBeNull();
  await waitFor(() => expect(view.result.current.data?.periodKey).toBe('2026-10'));
  identity.id = 'TEST-B'; view.rerender({ period: '2026-10', cut: null }); expect(view.result.current.data).toBeNull();
  await waitFor(() => expect(view.result.current.loading).toBe(false)); expect(callServer).toHaveBeenCalledTimes(3);
  view.unmount(); invalidateCollections(['sweater_recognition_policy']);
  const second = renderHook(() => useSettlementPreview('2026-10', true, null));
  await waitFor(() => expect(second.result.current.data).toBeTruthy()); expect(callServer).toHaveBeenCalledTimes(4);
  second.unmount();
  const third = renderHook(() => useSettlementPreview('2026-10', true, 'new-cut'));
  await waitFor(() => expect(third.result.current.data).toBeTruthy()); expect(callServer).toHaveBeenCalledTimes(5);
});
it('does not read when disabled', () => {
  const view = renderHook(() => useSettlementPreview('2026-11', false));
  expect(view.result.current.data).toBeNull(); expect(callServer).not.toHaveBeenCalled();
});
