import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import {
  fetchRows, getRow, insertRow, deleteRow, updateRow, sortBy, where,
} from '../lib/firestoreCrud';
import {
  mapAnnualExpenseEntry, toAnnualExpenseEntryInsert, toAnnualExpenseEntryUpdate,
} from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * كل قيود المصاريف السنوية دفعةً — لتقرأها صفحة السكن.
 *
 * Mirror of `useAllStartupEntries`. The housing tab needs rent across ALL
 * annual items at once (it groups by housing unit, not by item), and the
 * per-parent hook below is scoped to one `annualExpenseId`.
 */
export function useAllAnnualEntries() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    () => fetchRows('annual_expense_entries'),
    { enabled: isFirebaseConfigured, map: mapAnnualExpenseEntry, fallback: [] },
  );
  return { entries: data ?? [], loading, error, refetch };
}

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

  // ── التعديل ──
  // Client-side, unlike startup: `startup_cost_entries` is denied to every
  // client so its edits go through a callable, while `annual_expense_entries`
  // is client-writable behind `notPostedExpense('annual', id)`. The roll-up
  // runs after because an amount may have changed; the RULE — not this code —
  // decides whether a posted entry may be touched at all.
  const updateEntry = useCallback(async (id, patch) => {
    if (!isFirebaseConfigured) return null;
    await updateRow('annual_expense_entries', id, toAnnualExpenseEntryUpdate(patch));
    await syncParentTotal();
    await refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, parentId]);

  // ── إسناد السكنات دفعةً واحدة ──
  // Filing already-recorded rent under the housing unit it paid for. No
  // `syncParentTotal`: a tag moves no money, so re-summing would be a write
  // that says nothing — and the rules only let a POSTED entry through when
  // `unit` is the ONLY key that changed, so touching anything else here would
  // turn a working assignment into a permission-denied.
  const assignUnits = useCallback(async (_parentId, assignments = []) => {
    if (!isFirebaseConfigured) return null;
    for (const a of assignments) {
      await updateRow('annual_expense_entries', a.entryId, toAnnualExpenseEntryUpdate({ unit: a.unit }));
    }
    await refetch();
    return { updated: assignments.length };
  }, [refetch]);

  const entries = isFirebaseConfigured ? (data ?? []) : (data || []);
  return { entries, loading, error, addEntry, updateEntry, deleteEntry, assignUnits, refetch };
}
