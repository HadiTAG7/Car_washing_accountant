import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import {
  mapVariableExpense,
  toVariableExpenseInsert,
  toVariableExpenseUpdate,
} from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

export function useVariableExpenses() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('variable_expenses'), [{ key: 'logged_date', dir: 'desc' }]),
    {
      enabled: isFirebaseConfigured,
      map:     mapVariableExpense,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('variable_expenses', toVariableExpenseInsert(item));
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates) => {
    if (!isFirebaseConfigured) return null;
    const payload = toVariableExpenseUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    await updateRow('variable_expenses', id, payload);
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('variable_expenses', id);
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, deleteItem, refetch };
}
