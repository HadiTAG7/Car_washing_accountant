import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import { mapWash, toWashInsert, toWashUpdate } from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

export function useWashes() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('washes'), [{ key: 'wash_date', dir: 'desc' }]),
    {
      enabled: isFirebaseConfigured,
      map:     mapWash,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('washes', toWashInsert(item));
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates) => {
    if (!isFirebaseConfigured) return null;
    const payload = toWashUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    await updateRow('washes', id, payload);
    await refetch();
  }, [refetch]);

  const updateStatus = useCallback(async (id, status) => {
    if (!isFirebaseConfigured) return null;
    const safe = status === 'قيد التنفيذ' ? 'قيد التنفيذ' : 'مكتملة';
    await updateRow('washes', id, { status: safe });
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('washes', id);
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, updateStatus, deleteItem, refetch };
}
