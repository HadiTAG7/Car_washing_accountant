import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import {
  mapBudget,
  toBudgetInsert,
  toBudgetUpdate,
} from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

export function useBudgets() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('category_budgets'), [{ key: 'category_label' }]),
    {
      enabled: isFirebaseConfigured,
      map:     mapBudget,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('category_budgets', toBudgetInsert(item));
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates) => {
    if (!isFirebaseConfigured) return null;
    const payload = toBudgetUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    await updateRow('category_budgets', id, payload);
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('category_budgets', id);
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, deleteItem, refetch };
}
