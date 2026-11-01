import { isFirebaseConfigured } from '../lib/firebaseClient';
import { callServer } from '../lib/ledgerTransport';
import { useFirestoreQuery } from './useFirestoreQuery';
import { useAuth } from './useAuth';

// Existing server calculation, strictly read-only. Never call the saved
// calculation path to populate a screen, and never reuse another month's result.
export function useSettlementPreview(periodKey, enabled, savedCut) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  return useFirestoreQuery(
    async () => ({ ...await callServer('sweaterCalculateSettlement', { periodKey, dryRun: true }), readAtIso: new Date().toISOString() }),
    { enabled: isFirebaseConfigured && enabled && Boolean(periodKey && userId), deps: [periodKey, savedCut],
      cacheKey: `sweater_settlement_preview:${periodKey}:${savedCut || 'draft'}`,
      cacheTags: ['sweater_bookings', 'sweater_price_list', 'sweater_recognition_policy', 'sweater_adjustments', 'sweater_booking_links', 'sweater_settlements'],
      queryKey: `${userId}:${periodKey}:${savedCut || 'draft'}`, preserveResult: true, fallback: null },
  );
}
