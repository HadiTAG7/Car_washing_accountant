import { fetchRows, where } from '../lib/firestoreCrud';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { cancellationSourceIds } from '../lib/sweater/cancellationDetails';
import { useFirestoreQuery } from './useFirestoreQuery';

// Existing staff-only raw observations; read on opening one booking, never a
// second import, source extraction, schema change or update of its saved state.
export function useSweaterBookingSource(id) {
  return useFirestoreQuery(() => fetchRows('sweater_raw_payloads', [where('sspBookingId', 'in', cancellationSourceIds(id))]), {
    enabled: isFirebaseConfigured && Boolean(id), queryKey: id, cacheKey: `sweater_raw_payloads:booking:${id}`,
    deps: [id], fallback: [],
  });
}
