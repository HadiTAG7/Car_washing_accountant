// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const scope = vi.hoisted(() => ({ role: 'admin', isPartnerView: false, uid: 'admin-a' }));
vi.mock('../useAuth', () => ({ useAuth: () => ({ session: { user: { id: scope.uid } } }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => scope }));
vi.mock('../../lib/firebaseClient', () => ({ auth: { currentUser: { getIdToken: async () => 'synthetic-test-token' } } }));
import { useGrowthPerformance } from '../useGrowthPerformance';
const response = (result, to = '2026-10-17') => ({ ok: true, json: async () => ({ result: { from:'2026-10-10', to,
  version:2, workers:[], warnings:[], registerTotal:0, exclusions:[], gaps:[], readAt:'2026-10-18T18:00:00Z', roster:{at:'2026-10-18T18:12:10Z'}, ...result } }) });
beforeEach(() => { scope.role = 'admin'; scope.isPartnerView = false; scope.uid = 'admin-a'; vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('growth request lifecycle', () => {
  it.each([{ role: 'partner', isPartnerView: true }, { role: 'admin', isPartnerView: true }, { role: 'operator', isPartnerView: false }])('does not read when out of the real admin view: %j', async value => {
    Object.assign(scope, value);
    const { result } = renderHook(() => useGrowthPerformance('2026-10-10', '2026-10-17'));
    expect(result.current.allowed).toBe(false); expect(result.current.data).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('ignores an old response after a period change, and aborts its request', async () => {
    const pending = [];
    fetch.mockImplementation((_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal })));
    const { result, rerender } = renderHook(({ to }) => useGrowthPerformance('2026-10-10', to), { initialProps: { to: '2026-10-17' } });
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ to: '2026-10-16' });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].signal.aborted).toBe(true);
    await act(async () => pending[1].resolve(response({ marker: 'new' }, '2026-10-16')));
    await waitFor(() => expect(result.current.data?.marker).toBe('new'));
    await act(async () => pending[0].resolve(response({ marker: 'old' })));
    expect(result.current.data.marker).toBe('new');
    scope.isPartnerView = true; rerender({ to: '2026-10-16' });
    expect(result.current.data).toBeNull(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('offers an explicit retry without polling or document refresh', async () => {
    fetch.mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Test read failure' } }) });
    const { result } = renderHook(() => useGrowthPerformance('2026-10-10', '2026-10-17'));
    await waitFor(() => expect(result.current.error).toBe('Test read failure'));
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => result.current.retry());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
  it('renders an error instead of mounting a malformed successful DTO', async () => {
    fetch.mockResolvedValue(response({ workers: null }));
    const { result } = renderHook(() => useGrowthPerformance('2026-10-10', '2026-10-17'));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull(); expect(result.current.loading).toBe(false);
  });
});
