import { fetchRows } from '../lib/firestoreCrud';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';

/** Tracking only. No submission, payment, registration or ledger write path. */
export function useVatDeclarations() {
  const query = useFirestoreQuery(() => fetchRows('vat_declarations'), {
    cacheKey: 'vat_declarations', enabled: isFirebaseConfigured, fallback: [],
  });
  return { declarations: query.data || [], loading: query.loading, error: query.error, refetch: query.refetch };
}
