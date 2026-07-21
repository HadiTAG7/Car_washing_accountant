import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import {
  fetchRows, getRow, insertRow, deleteRow, updateRow, sortBy, where,
} from '../lib/firestoreCrud';
import { mapStartupCostEntry, toStartupCostEntryInsert } from '../lib/mappers';
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

  // Recompute SUM(amount) across all entries and push it onto the parent's
  // actual_amount + derived status. Re-queries rather than trusting the
  // local snapshot (one render behind the mutation).
  async function syncParentTotal() {
    if (!isFirebaseConfigured || !parentId) return;
    const [rows, parent] = await Promise.all([
      fetchRows('startup_cost_entries', [where('startup_cost_id', '==', parentId)]),
      getRow('startup_costs', parentId),
    ]);
    const total   = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const planned = Number(parent?.budgeted_amount) || 0;
    await updateRow('startup_costs', parentId, {
      actual_amount: total,
      status:        planned > 0 && total >= planned ? 'completed' : 'in_progress',
    });
  }

  const addEntry = useCallback(async (entry) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('startup_cost_entries', toStartupCostEntryInsert({ ...entry, startupCostId: parentId }));
    await syncParentTotal();
    await refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, parentId]);

  const deleteEntry = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('startup_cost_entries', id);
    await syncParentTotal();
    await refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, parentId]);

  const entries = isFirebaseConfigured ? (data ?? []) : (data || []);
  return { entries, loading, error, addEntry, deleteEntry, refetch };
}
