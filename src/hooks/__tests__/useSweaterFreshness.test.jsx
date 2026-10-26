// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'isolated-staff' } }) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/firestoreCrud', () => ({ fetchRows: api.fetch }));
import { useSweaterFreshness } from '../useSweaterFreshness';
import { refreshAllReads } from '../../lib/readCache';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
it('refreshes the current timestamp on mount and on the existing refresh button, without timer polling', async () => {
  const old = new Date(Date.now() - 4 * 36e5).toISOString();
  const latest = new Date(Date.now() - 36e5).toISOString();
  api.fetch.mockResolvedValue([{ id: 'current', lastSuccessAtIso: old }]);
  const page = renderHook(() => useSweaterFreshness());
  await waitFor(() => expect(page.result.current.loading).toBe(false));
  expect(page.result.current.value.savedAt).toBe(old);
  api.fetch.mockResolvedValue([{ id: 'current', lastSuccessAtIso: latest }]);
  await act(async () => { refreshAllReads(); });
  await waitFor(() => expect(page.result.current.value.savedAt).toBe(latest));
  const calls = api.fetch.mock.calls.length;
  vi.useFakeTimers(); await act(async () => { vi.advanceTimersByTime(60000); });
  expect(api.fetch).toHaveBeenCalledTimes(calls);
  vi.useRealTimers(); page.unmount();
  renderHook(() => useSweaterFreshness());
  await waitFor(() => expect(api.fetch.mock.calls.length).toBe(calls + 1));
  expect(api.fetch.mock.calls.every(([name]) => name === 'sweater_integration_state')).toBe(true);
});
