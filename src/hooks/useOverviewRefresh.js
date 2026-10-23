import { useEffect, useRef } from 'react';
import { peekCached, refreshAllReads } from '../lib/readCache';
import { OVERVIEW_SETTINGS } from '../config/overviewSettings';

/** Refresh the visible overview on return, not in a polling loop or other pages. */
export function useOverviewRefresh(periodKey, enabled) {
  const attempted = useRef(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const key = `sweater_metric_snapshots:${periodKey}`;
    attempted.current = peekCached(key)?.at ?? Date.now();
    const refreshIfStale = () => {
      if (document.visibilityState === 'hidden') return;
      const lastRead = Math.max(peekCached(key)?.at ?? 0, attempted.current);
      if (Date.now() - lastRead < OVERVIEW_SETTINGS.refreshOnReturnAfterMs) return;
      attempted.current = Date.now();
      // Use the existing shared refresh so washes and source metrics agree;
      // never compare a newly read SSP total with stale cached internal washes.
      refreshAllReads();
    };
    refreshIfStale();
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => {
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [periodKey, enabled]);
}
