import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { callBikerQuality } from '../lib/bikerQualityApi';

// Same admin-only read used by each profile. Keep the fan-out bounded and stop
// unstarted requests when the account, period or mounted view changes.
export function useOverviewBikerQuality(bikers, periodKey, enabled) {
  const { user } = useAuth();
  const { role, isPartnerView } = usePartnerView();
  const idsKey = JSON.stringify([...new Set(bikers.map(biker => biker.id).filter(Boolean))].sort());
  const ids = useMemo(() => JSON.parse(idsKey), [idsKey]);
  const allowed = Boolean(enabled && isFirebaseConfigured && user?.id && role === 'admin' && !isPartnerView);
  const scope = JSON.stringify([user?.id, role, isPartnerView, periodKey, ids]);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState({ scope: null, data: null, loading: false, error: null });
  useEffect(() => {
    if (!allowed) return;
    let active = true; let denied = false; let next = 0;
    const results = [];
    setState({ scope, data: null, loading: true, error: null });
    async function worker() {
      while (active && !denied && next < ids.length) {
        const bikerUID = ids[next++];
        try {
          const data = await callBikerQuality('read', { bikerUID, periodKey, rulesVersion: 'all-approved', includeSource: true });
          if (active) results.push({ bikerUID, data });
        } catch (error) {
          if (['permission-denied', 'unauthenticated'].includes(String(error.code || '').replace('functions/', ''))) {
            denied = true; throw error;
          }
          if (active) results.push({ bikerUID, failed: true });
        }
      }
    }
    Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker)).then(() => {
      if (active) setState({ scope, data: results, loading: false, error: null });
    }).catch(error => { if (active) setState({ scope, data: null, loading: false, error }); });
    return () => { active = false; };
  }, [allowed, scope, periodKey, ids, refresh]);
  const current = allowed && state.scope === scope ? state : { data: null, loading: allowed, error: null };
  return { ...current, available: allowed && !current.loading && !current.error && current.data !== null,
    refetch: useCallback(() => setRefresh(value => value + 1), []) };
}
