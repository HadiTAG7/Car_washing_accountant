import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import {
  mapMonthlyExpense,
  toMonthlyExpenseInsert,
  toMonthlyExpenseUpdate,
} from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

export function useMonthlyExpenses() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('monthly_expenses'), [{ key: 'payment_day' }]),
    {
      enabled: isFirebaseConfigured,
      map:     mapMonthlyExpense,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('monthly_expenses', toMonthlyExpenseInsert(item));
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates) => {
    if (!isFirebaseConfigured) return null;
    const payload = toMonthlyExpenseUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    await updateRow('monthly_expenses', id, payload);
    await refetch();
  }, [refetch]);

  const updateStatus = useCallback(async (id, paymentStatus) => {
    if (!isFirebaseConfigured) return null;
    const safe = paymentStatus === 'paid' ? 'paid' : 'pending';
    await updateRow('monthly_expenses', id, { payment_status: safe });
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('monthly_expenses', id);
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, updateStatus, deleteItem, refetch };
}
