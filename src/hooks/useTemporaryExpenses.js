import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import {
  mapTemporaryExpense,
  toTemporaryExpenseInsert,
  toTemporaryExpenseUpdate,
} from '../lib/mappers';
import { todayISO } from '../data/initialData';
import { useFirestoreQuery } from './useFirestoreQuery';

export function useTemporaryExpenses() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('temporary_expenses'), [
      { key: 'spent_date', dir: 'desc' }, { key: 'created_at', dir: 'desc' },
    ]),
    {
      enabled: isFirebaseConfigured,
      map:     mapTemporaryExpense,
      fallback: [],
    },
  );

  const addTemporaryExpense = useCallback(async (expense) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('temporary_expenses', toTemporaryExpenseInsert(expense));
    await refetch();
  }, [refetch]);

  // Flip pending ↔ recovered. status + recovered_date always travel
  // together (the app-side mapper keeps them consistent).
  const toggleRecoveryStatus = useCallback(async (id, currentStatus) => {
    if (!isFirebaseConfigured) return null;
    const nextStatus = currentStatus === 'recovered' ? 'pending' : 'recovered';
    const payload = toTemporaryExpenseUpdate({
      status:        nextStatus,
      recoveredDate: nextStatus === 'recovered' ? todayISO() : null,
    });
    await updateRow('temporary_expenses', id, payload);
    await refetch();
  }, [refetch]);

  const deleteTemporaryExpense = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('temporary_expenses', id);
    await refetch();
  }, [refetch]);

  const expenses = isFirebaseConfigured ? (data ?? []) : (data || []);
  return {
    expenses,
    loading,
    error,
    addTemporaryExpense,
    toggleRecoveryStatus,
    deleteTemporaryExpense,
    refetch,
  };
}
