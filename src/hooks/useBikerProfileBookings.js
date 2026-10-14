import { useAuth } from './useAuth';
import { useFirestoreQuery } from './useFirestoreQuery';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, where } from '../lib/firestoreCrud';

// Mounted only inside the admin profile. Reuse the existing single-field
// monthly source query; no new collection, index, permission or write path.
export function useBikerProfileBookings(bikerId, periodKey) {
  const { user } = useAuth();
  const enabled = isFirebaseConfigured && Boolean(user?.id && bikerId && periodKey);
  const query = useFirestoreQuery(
    () => fetchRows('sweater_bookings', [where('periodKey', '==', periodKey)]),
    { enabled, deps: [periodKey], queryKey: `${user?.id || ''}:${bikerId}:${periodKey}`, fallback: [] },
  );
  return { bookings: query.data ?? [], loading: query.loading, error: query.error,
    available: enabled && !query.loading && !query.error && query.data !== null };
}
