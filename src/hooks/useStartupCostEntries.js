import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, sortBy, where } from '../lib/firestoreCrud';
import { mapStartupCostEntry } from '../lib/mappers';
import { callServer } from '../lib/ledgerTransport';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * Set of startup_costs ids that have at least one ledger entry — the
 * Startup page locks the inline actual-amount input on these rows so the
 * inline editor and the ledger roll-up never fight over actual_amount.
 */
export function useStartupLedgerParents() {
  const { data, refetch } = useFirestoreQuery(
    () => fetchRows('startup_cost_entries'),
    { enabled: isFirebaseConfigured, fallback: [] },
  );
  const parentIds = useMemo(
    () => new Set((data || []).map((r) => r.startup_cost_id)),
    [data],
  );
  return { parentIds, refetch };
}

/**
 * Sub-ledger for one startup_costs row. Keeps the parent's actual_amount =
 * SUM(entries) and derives its status vs budgeted_amount on every mutation
 * (client-driven roll-up — same pattern the app has always used).
 */
export function useStartupCostEntries(parentId) {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(
      await fetchRows('startup_cost_entries', [where('startup_cost_id', '==', parentId)]),
      [{ key: 'spent_date', dir: 'desc' }, { key: 'created_at', dir: 'desc' }],
    ),
    {
      enabled: isFirebaseConfigured && Boolean(parentId),
      deps:    [parentId],
      map:     mapStartupCostEntry,
      fallback: [],
    },
  );

  // ── الإضافة والحذف على الخادم ──
  // `startup_cost_entries` is denied to every client in the rules, so these
  // go through callables. The roll-up onto the parent used to happen HERE —
  // a re-query, a client-side sum, and a second write — which is three things
  // a rule cannot protect: the total was whatever this code last computed, it
  // was not atomic with the entry it described, and a posted entry could be
  // deleted out from under its journal entry. All three now happen inside one
  // server transaction that reads the siblings transactionally.
  const addEntry = useCallback(async (entry) => {
    if (!isFirebaseConfigured) return null;
    const res = await callServer('startupAddEntry', { parentId, entry });
    await refetch();
    return res;
  }, [refetch, parentId]);

  const deleteEntry = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    const res = await callServer('startupDeleteEntry', { entryId: id });
    await refetch();
    return res;
  }, [refetch]);

  // ── التعديل ──
  // The server decides what may change: notes/invoice/unit always, money and
  // date only before posting, and a description change carries into the
  // journal narration in the same transaction. None of that is re-stated here
  // — a client copy of the rule is a second opinion waiting to drift.
  const updateEntry = useCallback(async (id, patch) => {
    if (!isFirebaseConfigured) return null;
    const res = await callServer('startupUpdateEntry', { entryId: id, patch });
    await refetch();
    return res;
  }, [refetch]);

  // ── إسناد السكنات دفعةً واحدة ──
  // Filing already-recorded spend under the housing unit it belongs to. One
  // call for the whole distribution, because that is how the owner does it —
  // and because a half-applied batch leaves them unable to tell which half.
  // Moves no money: the parent's total is the same entries either way.
  const assignUnits = useCallback(async (parentId, assignments) => {
    if (!isFirebaseConfigured) return null;
    const res = await callServer('startupAssignUnits', { parentId, assignments });
    await refetch();
    return res;
  }, [refetch]);

  const entries = isFirebaseConfigured ? (data ?? []) : (data || []);
  return { entries, loading, error, addEntry, updateEntry, deleteEntry, assignUnits, refetch };
}
