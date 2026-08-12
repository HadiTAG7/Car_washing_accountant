import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, sortBy } from '../lib/firestoreCrud';
import { mapStartupCost, toStartupCostInsert } from '../lib/mappers';
import { callServer } from '../lib/ledgerTransport';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * بنود رسوم التأسيس — خطة يكتبها العميل، وكل ما عداها يكتبه الخادم.
 *
 * Only CREATE is still a client write, and the rules confine it to the plan
 * columns with `actual_amount == 0`, no invoice, and `status == 'in_progress'`.
 * Everything else goes through a callable:
 *
 *   • `actual_amount` is SUM(startup_cost_entries) — a fold, which rules
 *     cannot express, so a client write would leave it as whatever it last
 *     claimed;
 *   • `status` is a FUNCTION of that sum and the budget, so changing the
 *     budget has to re-derive it in the same transaction — which is why
 *     `updateItem` is a callable and `updateStatus` no longer exists at all;
 *   • deleting a plan has to prove nothing hangs off it, and must never
 *     cascade into spend documents or their journal entries.
 */
export function useStartupCosts() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('startup_costs'), [{ key: 'created_at' }]),
    {
      enabled: isFirebaseConfigured,
      map:     mapStartupCost,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('startup_costs', toStartupCostInsert(item));
    await refetch();
  }, [refetch]);

  /**
   * Edits the plan. `status` is not among the fields it will carry — the
   * server re-derives it from the entries and the new budget, so a name change
   * leaves the total alone and a budget change moves the badge by itself.
   */
  const updateItem = useCallback(async (id, updates) => {
    if (!isFirebaseConfigured) return null;
    const patch = {};
    for (const key of ['category', 'itemName', 'quantity', 'plannedAmount']) {
      if (updates[key] !== undefined) patch[key] = updates[key];
    }
    if (Object.keys(patch).length === 0) return null;
    const res = await callServer('startupUpdatePlan', { parentId: id, patch });
    await refetch();
    return res;
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    const res = await callServer('startupDeletePlan', { parentId: id });
    await refetch();
    return res;
  }, [refetch]);

  const items = data ?? [];
  return {
    items, loading, error,
    addItem, updateItem, deleteItem,
    refetch,
  };
}
