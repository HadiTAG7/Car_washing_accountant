import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import { mapStartupCost, toStartupCostInsert, toStartupCostUpdate } from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

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

  const updateItem = useCallback(async (id, updates) => {
    if (!isFirebaseConfigured) return null;
    const payload = toStartupCostUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    await updateRow('startup_costs', id, payload);
    await refetch();
  }, [refetch]);

  // Inline edit of the actual-amount column. When called with a
  // plannedAmount the hook ALSO derives the row's status atomically and
  // writes both fields — so the badge flips the moment the input commits.
  const updateActual = useCallback(async (id, actualAmount, plannedAmount) => {
    if (!isFirebaseConfigured) return null;
    const actual  = Math.max(0, parseFloat(actualAmount) || 0);
    const payload = { actual_amount: actual };
    if (plannedAmount !== undefined) {
      const planned = Math.max(0, parseFloat(plannedAmount) || 0);
      payload.status = actual >= planned ? 'completed' : 'in_progress';
    }
    await updateRow('startup_costs', id, payload);
    await refetch();
  }, [refetch]);

  const updateStatus = useCallback(async (id, status) => {
    if (!isFirebaseConfigured) return null;
    const safe = status === 'completed' ? 'completed' : 'in_progress';
    await updateRow('startup_costs', id, { status: safe });
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('startup_costs', id);
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return {
    items, loading, error,
    addItem, updateItem, updateActual, updateStatus, deleteItem,
    refetch,
  };
}
