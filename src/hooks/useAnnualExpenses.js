import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, sortBy } from '../lib/firestoreCrud';
import { callServer } from '../lib/ledgerTransport';
import {
  mapAnnualExpense,
  toAnnualExpenseInsert,
  toAnnualExpenseUpdate,
} from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

export function useAnnualExpenses() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('annual_expenses'), [
      { key: 'payment_month' }, { key: 'payment_day' },
    ]),
    {
      cacheKey: 'annual_expenses',
      enabled: isFirebaseConfigured,
      map:     mapAnnualExpense,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('annual_expenses', toAnnualExpenseInsert(item));
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates, confirmation = {}) => {
    if (!isFirebaseConfigured) return null;
    const payload = toAnnualExpenseUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    await callServer('annualPlanAction', { ...confirmation, action: 'update', parentId: id, patch: payload });
    await refetch();
  }, [refetch]);

  const updateStatus = useCallback(async (id, paymentStatus, confirmation = {}) => {
    if (!isFirebaseConfigured) return null;
    const safe = paymentStatus === 'paid' ? 'paid' : 'pending';
    await callServer('annualPlanAction', { ...confirmation, action: 'update', parentId: id, patch: { payment_status: safe } });
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id, confirmation = {}) => {
    if (!isFirebaseConfigured) return null;
    await callServer('annualPlanAction', { ...confirmation, action: 'delete', parentId: id });
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, updateStatus, deleteItem, refetch };
}
