// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOverviewRefresh } from '../useOverviewRefresh';
import { cachedRead, onReadRefresh, __resetReadCache } from '../../lib/readCache';
import { OVERVIEW_SETTINGS } from '../../config/overviewSettings';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T06:00:00Z')); __resetReadCache(); });
afterEach(() => { cleanup(); vi.useRealTimers(); __resetReadCache(); });
const focus = () => act(() => window.dispatchEvent(new Event('focus')));

it('refreshes a stale overview once on return, not on an interval or repeated focus/visibility events', async () => {
  await cachedRead('sweater_metric_snapshots:2026-10', () => Promise.resolve([{ metrics: { completedWashes: 10 } }]));
  const refreshed = vi.fn(); onReadRefresh(refreshed);
  renderHook(() => useOverviewRefresh('2026-10', true));
  expect(refreshed).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(OVERVIEW_SETTINGS.refreshOnReturnAfterMs));
  expect(refreshed).not.toHaveBeenCalled(); // No background polling.
  focus(); focus(); act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(refreshed).toHaveBeenCalledTimes(1);
});

it('re-reads stale existing cache on mount, but does not duplicate the first page load or refresh other pages after unmount', async () => {
  const refreshed = vi.fn(); onReadRefresh(refreshed);
  const initial = renderHook(() => useOverviewRefresh('2026-10', true));
  focus(); expect(refreshed).not.toHaveBeenCalled(); initial.unmount();
  await cachedRead('sweater_metric_snapshots:2026-10', () => Promise.resolve([]));
  act(() => vi.advanceTimersByTime(OVERVIEW_SETTINGS.refreshOnReturnAfterMs));
  const remount = renderHook(() => useOverviewRefresh('2026-10', true));
  expect(refreshed).toHaveBeenCalledTimes(1);
  remount.unmount(); act(() => vi.advanceTimersByTime(OVERVIEW_SETTINGS.refreshOnReturnAfterMs));
  focus(); expect(refreshed).toHaveBeenCalledTimes(1);
});

it('does not refresh disabled pages or hidden tabs', () => {
  const refreshed = vi.fn(); onReadRefresh(refreshed);
  const { rerender } = renderHook(({ enabled }) => useOverviewRefresh('2026-10', enabled), { initialProps: { enabled: false } });
  act(() => vi.advanceTimersByTime(OVERVIEW_SETTINGS.refreshOnReturnAfterMs)); focus(); expect(refreshed).not.toHaveBeenCalled();
  rerender({ enabled: true });
  act(() => vi.advanceTimersByTime(OVERVIEW_SETTINGS.refreshOnReturnAfterMs));
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  focus(); expect(refreshed).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible'); focus(); expect(refreshed).toHaveBeenCalledTimes(1); visibility.mockRestore();
});
