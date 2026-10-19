// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOperationsRead } from '../useOperationsRead';
const mocks = vi.hoisted(() => ({ role: { role: 'admin', isPartnerView: false }, session: { user: { id: 'TEST' } }, api: vi.fn() }));
vi.mock('../useAuth', () => ({ useAuth: () => ({ session: mocks.session }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => mocks.role }));
vi.mock('../../lib/operationsApi', () => ({ callOperationsApi: (...a) => mocks.api(...a) }));
afterEach(cleanup);
beforeEach(() => { mocks.role.role = 'admin'; mocks.role.isPartnerView = false; mocks.api.mockReset(); });
describe('admin-only operations reads', () => {
  it.each(['partner', 'supervisor', 'operator', 'accountant'])('never requests reports for %s', role => {
    mocks.role.role = role; const { result } = renderHook(() => useOperationsRead('operations-reports', { action: 'list' }));
    expect(result.current.allowed).toBe(false); expect(mocks.api).not.toHaveBeenCalled();
  });
  it('immediately hides the old data when role changes and does not cache through simulation', async () => {
    mocks.api.mockResolvedValue({ items: ['PRIVATE-TEST'] });
    const { result, rerender } = renderHook(() => useOperationsRead('operations-reports', { action: 'list' }));
    await waitFor(() => expect(result.current.data?.items).toEqual(['PRIVATE-TEST']));
    mocks.role.isPartnerView = true; rerender(); expect(result.current.data).toBeNull(); expect(result.current.allowed).toBe(false);
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });
  it('reports read errors without creating empty/zero success results', async () => {
    mocks.api.mockRejectedValue(new Error('اتصال غير متاح')); const { result } = renderHook(() => useOperationsRead('operations-reports', { action: 'list' }));
    await waitFor(() => expect(result.current.error).toBe('اتصال غير متاح')); expect(result.current.data).toBeNull();
  });
});
