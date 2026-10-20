// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ entries: [], legacy: [], fetchEntries: vi.fn(), fetchRows: vi.fn() }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/firestoreCrud', () => ({ fetchRows: mock.fetchRows }));
vi.mock('../../lib/accounting/firestoreLedger', () => ({
  COL: { LINES: 'journal_lines' },
  fetchAccounts: async () => [], fetchPeriods: async () => [], fetchEntries: mock.fetchEntries,
  embeddedLinesOf: e => (e.lines || []).map((l, i) => ({ ...l, entryId: e.id, id: `${e.id}:${i}` })),
}));
import { useLedger } from '../useLedger';
beforeEach(() => {
  vi.clearAllMocks(); mock.entries = [{ id: 'j1', lines: [{ debit: 23 }, { credit: 23 }] }];
  mock.legacy = [{ id: 'legacy', entryId: 'old', debit: 15 }];
  mock.fetchEntries.mockImplementation(async () => mock.entries);
  mock.fetchRows.mockImplementation(async () => mock.legacy);
});
afterEach(cleanup);
it('loads journal entries once, retaining embedded and legacy lines and fresh refetches', async () => {
  const { result } = renderHook(() => useLedger());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mock.fetchEntries).toHaveBeenCalledTimes(1);
  expect(mock.fetchRows).toHaveBeenCalledExactlyOnceWith('journal_lines');
  expect(result.current.lines).toEqual([{ debit: 23, entryId: 'j1', id: 'j1:0' },
    { credit: 23, entryId: 'j1', id: 'j1:1' }, mock.legacy[0]]);
  mock.entries = [{ id: 'j2', lines: [{ debit: 99 }] }];
  await act(async () => result.current.refetch());
  await waitFor(() => expect(result.current.entries[0].id).toBe('j2'));
  expect(mock.fetchEntries).toHaveBeenCalledTimes(2);
  expect(result.current.lines[0]).toMatchObject({ debit: 99, entryId: 'j2' });
});
it('reuses live journal without any duplicate journal reads, including refresh', async () => {
  const live = { entries: mock.entries, lines: mock.legacy, loading: false, error: null, refetch: vi.fn() };
  const { result, rerender } = renderHook(({ source }) => useLedger({ liveSources: source }), { initialProps: { source: live } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.entries).toBe(live.entries);
  expect(result.current.lines).toBe(live.lines);
  await act(async () => result.current.refetch());
  expect(live.refetch).toHaveBeenCalledTimes(1);
  expect(mock.fetchEntries).not.toHaveBeenCalled(); expect(mock.fetchRows).not.toHaveBeenCalled();
  const failed = new Error('quota');
  rerender({ source: { ...live, entries: [], lines: [], loading: true, error: failed } });
  expect(result.current.entries).toEqual([]); expect(result.current.lines).toEqual([]);
  expect(result.current.loading).toBe(true); expect(result.current.error).toBe(failed);
});
