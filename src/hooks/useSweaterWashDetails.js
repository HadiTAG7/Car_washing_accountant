import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';
import { ownerBookingIdentity } from '../lib/sweater/bookingIdentity';

// Firestore's `in` takes at most 30 values.
const CHUNK = 30;
/** The booking number a ticket is filed under, when it is one (B-123 → 123). */
const numberOf = id => { const number = ownerBookingIdentity(id); return /^\d+$/.test(number) && number !== id ? number : null; };

/**
 * The Sweater booking behind each wash shown. One query per 30 tickets
 * (document-id `in`) instead of one request per ticket, and kept for the
 * session: the reads are the same, the requests — each one also costing the
 * security rules a lookup — drop from one per row to one per thirty.
 *
 * A booking is kept under its number and shows Sweater's latest reading, so a
 * wash recorded as B-123 finds booking 123 even once it reads S-123. Until the
 * identity cleanup runs it may still sit under its prefixed id. Each booking
 * returned carries `requestedId`: the ticket it was asked for.
 */
export function useSweaterWashDetails(bookingIds, open) {
  const queryKey = JSON.stringify([...new Set(bookingIds)].sort()); const ids = JSON.parse(queryKey);
  const result = useFirestoreQuery(
    async () => {
      const byDocId = new Map();
      const docIds = [...new Set(ids.flatMap(id => [numberOf(id), encodeURIComponent(id)].filter(Boolean)))];
      for (let i = 0; i < docIds.length; i += CHUNK) {
        const snap = await getDocs(query(collection(db, 'sweater_bookings'), where(documentId(), 'in', docIds.slice(i, i + CHUNK))));
        for (const doc of snap.docs) byDocId.set(doc.id, { id: doc.id, ...doc.data() });
      }
      return ids.map(id => {
        const numbered = numberOf(id) && byDocId.get(numberOf(id)), prefixed = byDocId.get(encodeURIComponent(id));
        const row = numbered && ownerBookingIdentity(numbered.sspBookingId) === ownerBookingIdentity(id) ? numbered
          : prefixed?.sspBookingId === id ? prefixed : null;
        return row && { ...row, requestedId: id };
      }).filter(Boolean);
    },
    { enabled: open && ids.length > 0 && isFirebaseConfigured, queryKey, fallback: [],
      cacheKey: 'sweaterWashDetails', cacheTags: ['sweater_bookings'] },
  );
  return { bookings: result.data ?? [], loading: result.loading, error: result.error };
}
