import { isFirebaseConfigured } from '../lib/firebaseClient';
import { getRow } from '../lib/firestoreCrud';
import { useFirestoreQuery } from './useFirestoreQuery';

export function useSweaterWashDetails(bookingIds, open) {
  const queryKey = JSON.stringify([...new Set(bookingIds)].sort()); const ids = JSON.parse(queryKey);
  const result = useFirestoreQuery(
    async () => (await Promise.all(ids.map(id => getRow('sweater_bookings', encodeURIComponent(id)))))
      .filter((row, index) => row?.sspBookingId === ids[index]),
    { enabled: open && ids.length > 0 && isFirebaseConfigured, queryKey, fallback: [] },
  );
  return { bookings: result.data ?? [], loading: result.loading, error: result.error };
}
