import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchRows } from '../lib/firestoreCrud';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { operationFreshness } from '../lib/sweaterFreshness';
import { onReadRefresh } from '../lib/readCache';

export function useFreshnessRefresh(refetch) {
  useEffect(() => onReadRefresh(refetch), [refetch]);
}

export function useFreshnessClock() {
  const [now, setNow] = useState(Date.now);
  // Local colour changes only: this timer does not fetch, import or reload.
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  return now;
}

export function useSweaterFreshness() {
  const { user } = useAuth();
  const now = useFreshnessClock();
  const state = useFirestoreQuery(() => fetchRows('sweater_integration_state'), {
    enabled: isFirebaseConfigured && Boolean(user?.id), queryKey: user?.id,
    // One small current-state read on each page mount, never a session-long cached timestamp.
    cacheTags: ['sweater_integration_state'], fallback: [],
  });
  useFreshnessRefresh(state.refetch);
  return { ...state, value: operationFreshness(state.error || state.loading ? null : state.data?.find(s => s.id === 'current'), now) };
}
