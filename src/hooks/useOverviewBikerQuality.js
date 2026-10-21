import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { callBikerQuality } from '../lib/bikerQualityApi';
import { useFirestoreQuery } from './useFirestoreQuery';

// The profile's admin-only read, for every worker of the month in ONE request
// (`readMonth`): the month's washes are read once on the server instead of
// each worker's lifetime washes per request. Cached for the session; a write
// to washes, workers or reports drops it (server reports are tagged `*`).
export function useOverviewBikerQuality(bikers, periodKey, enabled) {
  const { user } = useAuth();
  const { role, isPartnerView } = usePartnerView();
  const idsKey = JSON.stringify([...new Set(bikers.map(biker => biker.id).filter(Boolean))].sort());
  const ids = useMemo(() => JSON.parse(idsKey), [idsKey]);
  const allowed = Boolean(enabled && isFirebaseConfigured && user?.id && role === 'admin' && !isPartnerView);
  const query = useFirestoreQuery(async () => {
    if (!ids.length) return [];
    try {
      const { results } = await callBikerQuality('readMonth', { periodKey, bikerUIDs: ids });
      return results;
    } catch (error) {
      if (['permission-denied', 'unauthenticated'].includes(String(error.code || '').replace('functions/', ''))) throw error;
      // As before, an unreadable report marks the workers, not the page.
      return ids.map(bikerUID => ({ bikerUID, failed: true }));
    }
  }, { enabled: allowed, preserveResult: true, fallback: null, cacheKey: `bikerQualityMonth:${periodKey}:${idsKey}`, cacheTags: ['*'],
    queryKey: JSON.stringify([user?.id, role, isPartnerView, periodKey]), deps: [idsKey, periodKey] });
  return { data: query.data, loading: query.loading, error: query.error,
    available: allowed && !query.loading && !query.error && query.data !== null, refetch: query.refetch };
}
