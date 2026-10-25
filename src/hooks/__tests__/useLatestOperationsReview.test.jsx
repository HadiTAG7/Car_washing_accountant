// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { operationsFixture } from '../../../server/__tests__/operationsFixture';
import { useLatestOperationsReview } from '../useLatestOperationsReview';
import { refreshAllReads } from '../../lib/readCache';
const state = vi.hoisted(() => ({ session: { user: { id: 'A' } }, view: { role: 'admin', isPartnerView: false }, api: vi.fn() }));
vi.mock('../useAuth', () => ({ useAuth: () => ({ session: state.session }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => state.view }));
vi.mock('../../lib/operationsApi', () => ({ callOperationsApi: (...args) => state.api(...args) }));
afterEach(cleanup);
beforeEach(() => { state.api.mockReset(); state.session = { user: { id: 'A' } }; state.view = { role: 'admin', isPartnerView: false }; });
it('loads through the existing read-only endpoint and rereads on the shared manual refresh', async () => {
  const report = operationsFixture();
  state.api.mockImplementation((endpoint, input) => Promise.resolve(input.action === 'list' ? { items: [report] } : { report }));
  const { result } = renderHook(() => useLatestOperationsReview('2026-10-18'));
  await waitFor(() => expect(result.current.report?.reportId).toBe(report.reportId));
  act(() => refreshAllReads());
  expect(result.current.report).toBeNull();
  await waitFor(() => expect(result.current.report?.reportId).toBe(report.reportId));
  expect(state.api).toHaveBeenCalledTimes(4);
  expect(state.api.mock.calls.every(c => c[0] === 'operations-reports' && ['read', 'list'].includes(c[1].action))).toBe(true);
});
it.each(['partner', 'supervisor', 'accountant'])('does not load operations for %s', role => {
  state.view.role = role;
  const { result } = renderHook(() => useLatestOperationsReview('2026-10-18'));
  expect(result.current.report).toBeNull(); expect(state.api).not.toHaveBeenCalled();
});
it('hides data immediately on identity/simulation changes and discards a late old read', async () => {
  const report = operationsFixture();
  let finish;
  state.api.mockResolvedValueOnce({ items: [report] }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(() => useLatestOperationsReview('2026-10-18'));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  state.view.isPartnerView = true; rerender();
  await act(async () => finish({ report }));
  expect(result.current.report).toBeNull(); expect(state.api).toHaveBeenCalledTimes(2);
  state.view.isPartnerView = false; state.session = null; rerender();
  expect(result.current.report).toBeNull(); expect(state.api).toHaveBeenCalledTimes(2);
});
it('shows unavailable on failure, never an empty verified report', async () => {
  state.api.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useLatestOperationsReview('2026-10-18'));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.report).toBeNull(); expect(result.current.loading).toBe(false);
});
