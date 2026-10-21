import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';

// Firestore's `in` takes at most 30 values.
const CHUNK = 30;

/**
 * The Sweater booking behind each wash shown. One query per 30 tickets
 * (document-id `in`) instead of one request per ticket, and kept for the
 * session: the reads are the same, the requests — each one also costing the
 * security rules a lookup — drop from one per row to one per thirty.
 */
export function useSweaterWashDetails(bookingIds, open) {
  const queryKey = JSON.stringify([...new Set(bookingIds)].sort()); const ids = JSON.parse(queryKey);
  const result = useFirestoreQuery(
    async () => {
      const byDocId = new Map();
      for (let i = 0; i < ids.length; i += CHUNK) {
        const docIds = ids.slice(i, i + CHUNK).map(id => encodeURIComponent(id));
        const snap = await getDocs(query(collection(db, 'sweater_bookings'), where(documentId(), 'in', docIds)));
        for (const doc of snap.docs) byDocId.set(doc.id, { id: doc.id, ...doc.data() });
      }
      return ids.map(id => byDocId.get(encodeURIComponent(id))).filter((row, index) => row?.sspBookingId === ids[index]);
    },
    { enabled: open && ids.length > 0 && isFirebaseConfigured, queryKey, fallback: [],
      cacheKey: 'sweaterWashDetails', cacheTags: ['sweater_bookings'] },
  );
  return { bookings: result.data ?? [], loading: result.loading, error: result.error };
}
