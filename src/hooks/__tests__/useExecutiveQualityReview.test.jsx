// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
const state = vi.hoisted(() => ({ query: { available: true, loading: false, error: null, data: [] }, read: vi.fn() }));
vi.mock('../useOverviewBikerQuality', () => ({ useOverviewBikerQuality: (...args) => { state.read(...args); return state.query; } }));
import { useExecutiveQualityReview } from '../useExecutiveQualityReview';
afterEach(() => { cleanup(); state.read.mockClear(); state.query = { available: true, loading: false, error: null, data: [] }; });
it('reuses the existing scoped month reader, not another API or writer', () => {
  const workers = { bikers: [{ id: 'A' }], loading: false, error: null };
  state.query.data = [{ bikerUID: 'A', data: { reports: [] } }];
  const { result } = renderHook(() => useExecutiveQualityReview(workers, '2026-10', '2026-10-26'));
  expect(state.read).toHaveBeenCalledWith(workers.bikers, '2026-10', true);
  expect(result.current.review).toMatchObject({ requested: 1, missing: 1, published: 0, hasIssues: true });
});
it('does not project cached reports when the worker registry is loading or denied', () => {
  const { result, rerender } = renderHook(({ workers }) => useExecutiveQualityReview(workers, '2026-10', '2026-10-26'), {
    initialProps: { workers: { bikers: [{ id: 'A' }], loading: true } },
  });
  expect(result.current).toMatchObject({ review: null, loading: true, error: null });
  expect(state.read.mock.calls.at(-1)[2]).toBe(false);
  rerender({ workers: { bikers: [{ id: 'A' }], error: 'denied' } });
  expect(result.current.review).toBeNull(); expect(result.current.error).toContain('تعذرت قراءة');
});
it.each([{ available: false, data: null }, { available: false, error: 'permission-denied' }])('does not claim zero/complete quality when the existing reader is unavailable %#', query => {
  state.query = { loading: false, ...query };
  const { result } = renderHook(() => useExecutiveQualityReview({ bikers: [{ id: 'A' }] }, '2026-10', '2026-10-26'));
  expect(result.current.review).toBeNull(); expect(result.current.error).toContain('لا يمكن تأكيد');
});
