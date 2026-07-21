import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import { mapPartner, toPartnerInsert, toPartnerUpdate } from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

export function usePartners() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('partners'), [{ key: 'partner_name' }]),
    {
      enabled: isFirebaseConfigured,
      map:     mapPartner,
      fallback: [],
    },
  );

  const addPartner = useCallback(async (partner) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('partners', toPartnerInsert(partner));
    await refetch();
  }, [refetch]);

  const updatePartner = useCallback(async (id, patch) => {
    if (!isFirebaseConfigured) return null;
    await updateRow('partners', id, toPartnerUpdate(patch));
    await refetch();
  }, [refetch]);

  const deletePartner = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('partners', id);
    await refetch();
  }, [refetch]);

  const partners = isFirebaseConfigured ? (data ?? []) : (data || []);
  return { partners, loading, error, addPartner, updatePartner, deletePartner, refetch };
}
