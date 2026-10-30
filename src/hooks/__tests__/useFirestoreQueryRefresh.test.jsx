// @vitest-environment jsdom
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFirestoreQuery } from '../useFirestoreQuery';
import { refreshCollections, __resetReadCache } from '../../lib/readCache';

beforeEach(() => __resetReadCache());
afterEach(() => { cleanup(); __resetReadCache(); });

describe('a ledger reader on screen after a posting', () => {
  it('re-reads the journal in place, once for every reader of the same key, and leaves other readers alone', async () => {
    let journal = [{ id: 'je400' }];
    const readJournal = vi.fn(async () => journal), readBikers = vi.fn(async () => [{ id: 'b1' }]);
    const a = renderHook(() => useFirestoreQuery(readJournal, { cacheKey: 'journal_entries', fallback: [] }));
    const b = renderHook(() => useFirestoreQuery(readJournal, { cacheKey: 'journal_entries', fallback: [] }));
    const bikers = renderHook(() => useFirestoreQuery(readBikers, { cacheKey: 'bikers', fallback: [] }));
    await waitFor(() => expect(a.result.current.data).toEqual([{ id: 'je400' }]));
    await waitFor(() => expect(b.result.current.data).toEqual([{ id: 'je400' }]));
    await waitFor(() => expect(bikers.result.current.data).toEqual([{ id: 'b1' }]));
    expect(readJournal).toHaveBeenCalledTimes(1);

    journal = [{ id: 'je400' }, { id: 'je401' }];
    act(() => refreshCollections(['journal_entries', 'journal_lines', 'posting_locks'], { broadcast: false }));
    await waitFor(() => expect(a.result.current.data).toEqual([{ id: 'je400' }, { id: 'je401' }]));
    await waitFor(() => expect(b.result.current.data).toEqual([{ id: 'je400' }, { id: 'je401' }]));
    expect(readJournal).toHaveBeenCalledTimes(2);
    expect(readBikers).toHaveBeenCalledTimes(1);
  });
});
