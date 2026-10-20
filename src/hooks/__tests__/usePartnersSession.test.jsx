// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: { user: null, loading: true }, fetchRows: vi.fn(), callPartnerProfile: vi.fn() }));
vi.mock('../useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, callPartnerProfile: mocks.callPartnerProfile }));
vi.mock('../../lib/firestoreCrud', () => ({
  fetchRows: mocks.fetchRows, sortBy: rows => rows,
  insertRow: vi.fn(), updateRow: vi.fn(), deleteRow: vi.fn(),
}));
import { usePartners } from '../usePartners';
import { PartnerViewProvider, usePartnerView } from '../../contexts/PartnerViewContext';

const wrapper = ({ children }) => <PartnerViewProvider role="partner">{children}</PartnerViewProvider>;

const row = uid => ({ id: `p-${uid}`, user_id: uid, partner_name: uid, workers_count: 1 });
// The server's projection of the caller's own row: no user_id, no ratio.
const profile = uid => ({ id: `p-${uid}`, partnerName: uid, workersCount: 1, status: 'active' });
const unlinked = () => Object.assign(new Error('حسابك غير مربوط بسجل شريك بعد'), { code: 'failed-precondition' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
beforeEach(() => {
  mocks.auth.user = null; mocks.auth.loading = true;
  mocks.fetchRows.mockReset(); mocks.callPartnerProfile.mockReset();
});
afterEach(cleanup);

describe('partner link reads follow the signed-in session', () => {
  it('waits for authentication, then loads the saved link without an admin write', async () => {
    mocks.fetchRows.mockResolvedValue([row('a')]);
    const { result, rerender } = renderHook(() => usePartners());
    expect(mocks.fetchRows).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    mocks.auth.user = { id: 'a' }; mocks.auth.loading = false;
    rerender();
    await waitFor(() => expect(result.current.partners[0]?.userId).toBe('a'));
    expect(mocks.fetchRows).toHaveBeenCalledTimes(1);
  });

  it('reloads the saved link after logout and another login, without keeping the old list', async () => {
    mocks.auth.user = { id: 'a' }; mocks.auth.loading = false;
    mocks.fetchRows.mockResolvedValue([row('a')]);
    const { result, rerender } = renderHook(() => usePartners());
    await waitFor(() => expect(result.current.partners).toHaveLength(1));
    mocks.auth.user = null; rerender();
    expect(result.current.partners).toEqual([]);
    expect(mocks.fetchRows).toHaveBeenCalledTimes(1);
    mocks.auth.user = { id: 'a' }; rerender();
    await waitFor(() => expect(mocks.fetchRows).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.partners[0]?.userId).toBe('a'));
  });

  it('does not let a slow previous account overwrite the new account result', async () => {
    const old = deferred();
    mocks.auth.user = { id: 'a' }; mocks.auth.loading = false;
    mocks.fetchRows.mockReturnValueOnce(old.promise).mockResolvedValueOnce([row('b')]);
    const { result, rerender } = renderHook(() => usePartners());
    mocks.auth.user = { id: 'b' }; rerender();
    await waitFor(() => expect(result.current.partners[0]?.userId).toBe('b'));
    await act(async () => old.resolve([row('a')]));
    expect(result.current.partners[0]?.userId).toBe('b');
  });

  it('ignores a previous account failure after the new account loads', async () => {
    const old = deferred();
    mocks.auth.user = { id: 'a' }; mocks.auth.loading = false;
    mocks.fetchRows.mockReturnValueOnce(old.promise).mockResolvedValueOnce([row('b')]);
    const { result, rerender } = renderHook(() => usePartners());
    mocks.auth.user = { id: 'b' }; rerender();
    await waitFor(() => expect(result.current.partners[0]?.userId).toBe('b'));
    await act(async () => old.reject(new Error('old session failed')));
    expect(result.current.error).toBeNull();
    expect(result.current.partners[0]?.userId).toBe('b');
  });

  it('can retry a read failure without changing the saved partner link', async () => {
    mocks.auth.user = { id: 'a' }; mocks.auth.loading = false;
    const error = new Error('connection failed');
    mocks.fetchRows.mockRejectedValueOnce(error).mockResolvedValueOnce([row('a')]);
    const { result } = renderHook(() => usePartners());
    await waitFor(() => expect(result.current.error).toBe(error));
    await act(async () => { await result.current.refetch(); });
    expect(result.current.error).toBeNull();
    expect(result.current.partners[0]?.userId).toBe('a');
  });

  it('restores the partner portal after auth restoration, even for an inactive linked partner', async () => {
    mocks.callPartnerProfile.mockResolvedValue({ ...profile('a'), status: 'inactive' });
    const { result, rerender } = renderHook(() => usePartnerView(), { wrapper });
    expect(result.current.partnerLinkLoading).toBe(true);
    expect(result.current.investorLinkMissing).toBe(false);
    expect(result.current.canMutate).toBe(false);
    mocks.auth.user = { id: 'a' }; mocks.auth.loading = false;
    rerender();
    await waitFor(() => expect(result.current.myPartner?.id).toBe('p-a'));
    expect(result.current.investorLinkMissing).toBe(false);
    expect(result.current.partnerLinkLoading).toBe(false);
    expect(result.current.canMutate).toBe(false);
    // The share is a server figure; the investor's browser never derives it.
    expect(result.current.scalingFactor).toBe(0);
  });

  it('an investor account never reads the partners collection', async () => {
    mocks.auth.user = { id: 'a' }; mocks.auth.loading = false;
    mocks.callPartnerProfile.mockResolvedValue(profile('a'));
    mocks.fetchRows.mockResolvedValue([row('a'), row('b')]);
    const { result } = renderHook(() => usePartnerView(), { wrapper });
    await waitFor(() => expect(result.current.myPartner?.id).toBe('p-a'));
    expect(mocks.fetchRows).not.toHaveBeenCalled();
    expect(result.current.myPartner.userId).toBe('a');
  });

  it('reads nothing before the role is known', async () => {
    mocks.auth.user = { id: 'a' }; mocks.auth.loading = false;
    renderHook(() => usePartnerView(), {
      wrapper: ({ children }) => <PartnerViewProvider role={null}>{children}</PartnerViewProvider>,
    });
    await act(async () => {});
    expect(mocks.fetchRows).not.toHaveBeenCalled();
    expect(mocks.callPartnerProfile).not.toHaveBeenCalled();
  });

  it('keeps a read error separate from an absent link, and recovers by rereading only', async () => {
    mocks.auth.user = { id: 'a' }; mocks.auth.loading = false;
    const error = new Error('unavailable');
    mocks.callPartnerProfile.mockRejectedValueOnce(error).mockResolvedValueOnce(profile('a'));
    const { result } = renderHook(() => usePartnerView(), { wrapper });
    await waitFor(() => expect(result.current.partnerLinkError).toBe(error));
    expect(result.current.investorLinkMissing).toBe(false);
    expect(result.current.isPartnerView).toBe(true);
    expect(result.current.canMutate).toBe(false);
    expect(result.current.scalingFactor).toBe(0);
    await act(async () => { await result.current.recheckPartnerLink(); });
    expect(result.current.myPartner?.userId).toBe('a');
    expect(result.current.partnerLinkError).toBeNull();
  });

  it('still fails closed when a successful read confirms there really is no link', async () => {
    mocks.auth.user = { id: 'a' }; mocks.auth.loading = false;
    mocks.callPartnerProfile.mockRejectedValue(unlinked());
    const { result } = renderHook(() => usePartnerView(), { wrapper });
    await waitFor(() => expect(result.current.investorLinkMissing).toBe(true));
    expect(result.current.myPartner).toBeNull();
    expect(result.current.canMutate).toBe(false);
    expect(result.current.scalingFactor).toBe(0);
  });
});
