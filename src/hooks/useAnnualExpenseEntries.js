import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import {
  fetchRows, getRow, insertRow, deleteRow, updateRow, sortBy, where,
} from '../lib/firestoreCrud';
import { mapAnnualExpenseEntry, toAnnualExpenseEntryInsert } from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * Sub-ledger for one annual_expenses row — mirror of useStartupCostEntries.
 * Keeps actual_amount = SUM(entries) and payment_status ('paid' once the
 * sum covers annual_cost) synced on every mutation.
 */
export function useAnnualExpenseEntries(parentId) {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(
      await fetchRows('annual_expense_entries', [where('annual_expense_id', '==', parentId)]),
      [{ key: 'spent_date', dir: 'desc' }, { key: 'created_at', dir: 'desc' }],
    ),
    {
      enabled: isFirebaseConfigured && Boolean(parentId),
      deps:    [parentId],
      map:     mapAnnualExpenseEntry,
      fallback: [],
    },
  );

  async function syncParentTotal() {
    if (!isFirebaseConfigured || !parentId) return;
    const [rows, parent] = await Promise.all([
      fetchRows('annual_expense_entries', [where('annual_expense_id', '==', parentId)]),
      getRow('annual_expenses', parentId),
    ]);
    const total      = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const annualCost = Number(parent?.annual_cost) || 0;
    await updateRow('annual_expenses', parentId, {
      actual_amount:  total,
      payment_status: annualCost > 0 && total >= annualCost ? 'paid' : 'pending',
    });
  }

  const addEntry = useCallback(async (entry) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('annual_expense_entries', toAnnualExpenseEntryInsert({ ...entry, annualExpenseId: parentId }));
    await syncParentTotal();
    await refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, parentId]);

  const deleteEntry = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('annual_expense_entries', id);
    await syncParentTotal();
    await refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, parentId]);

  const entries = isFirebaseConfigured ? (data ?? []) : (data || []);
  return { entries, loading, error, addEntry, deleteEntry, refetch };
}
