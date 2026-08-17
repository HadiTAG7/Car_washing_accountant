import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import { mapBiker, toBikerInsert, toBikerUpdate } from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

export function useBikers() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('bikers'), [{ key: 'name' }]),
    {
      enabled: isFirebaseConfigured,
      map:     mapBiker,
      fallback: [],
    },
  );

  const addBiker = useCallback(async (biker) => {
    if (!isFirebaseConfigured) return null;
    const id = await insertRow('bikers', toBikerInsert(biker));
    await refetch();
    return id;
  }, [refetch]);

  const updateBiker = useCallback(async (id, patch) => {
    if (!isFirebaseConfigured) return null;
    await updateRow('bikers', id, toBikerUpdate(patch));
    await refetch();
  }, [refetch]);

  const deleteBiker = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('bikers', id);
    await refetch();
  }, [refetch]);

  const bikers = isFirebaseConfigured ? (data ?? []) : (data || []);
  return { bikers, loading, error, addBiker, updateBiker, deleteBiker, refetch };
}
