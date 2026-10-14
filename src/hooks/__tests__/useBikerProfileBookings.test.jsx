// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: { id: 'admin-a' }, fetch: vi.fn() }));
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/firestoreCrud', () => ({ fetchRows: (...args) => mocks.fetch(...args), where: (...args) => args }));
import { useBikerProfileBookings } from '../useBikerProfileBookings';
beforeEach(() => { mocks.user = { id: 'admin-a' }; mocks.fetch.mockReset(); });
afterEach(cleanup);

it('reads only the existing monthly source and distinguishes empty success from unavailable', async () => {
  mocks.fetch.mockResolvedValue([]);
  const { result } = renderHook(() => useBikerProfileBookings('worker-a', '2026-10'));
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(mocks.fetch).toHaveBeenCalledWith('sweater_bookings', [['periodKey', '==', '2026-10']]);
  expect(result.current.bookings).toEqual([]);
});
it('hides previous month immediately and ignores a late result from the old period', async () => {
  let resolveOld;
  mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce([{ id: 'new-month' }]);
  const view = renderHook(({ month }) => useBikerProfileBookings('worker-a', month), { initialProps: { month: '2026-10' } });
  view.rerender({ month: '2026-09' });
  expect(view.result.current.available).toBe(false);
  expect(view.result.current.bookings).toEqual([]);
  await waitFor(() => expect(view.result.current.available).toBe(true));
  await act(async () => resolveOld([{ id: 'old-month' }]));
  expect(view.result.current.bookings).toEqual([{ id: 'new-month' }]);
});
it('hides results immediately when the authenticated identity disappears', async () => {
  mocks.fetch.mockResolvedValue([{ id: 'previous-user' }]);
  const view = renderHook(() => useBikerProfileBookings('worker-a', '2026-10'));
  await waitFor(() => expect(view.result.current.available).toBe(true));
  mocks.user = null;
  view.rerender();
  expect(view.result.current.available).toBe(false);
  expect(view.result.current.bookings).toEqual([]);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it('reports read failure as unavailable, never as verified zero', async () => {
  mocks.fetch.mockRejectedValue(new Error('synthetic read denied'));
  const { result } = renderHook(() => useBikerProfileBookings('worker-a', '2026-10'));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.available).toBe(false);
});
