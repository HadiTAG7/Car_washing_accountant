import { useAuth } from './useAuth';
import { useFirestoreQuery } from './useFirestoreQuery';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { callBikerQuality } from '../lib/bikerQualityApi';

export function useBikerQualityReports(bikerUID, periodKey) {
  const { user } = useAuth();
  const enabled = isFirebaseConfigured && Boolean(user?.id && bikerUID && periodKey);
  const query = useFirestoreQuery(() => callBikerQuality('read', { bikerUID, periodKey, rulesVersion: 'cqo-20261014-v1' }),
    { enabled, preserveResult: true, deps: [periodKey], queryKey: `${user?.id || ''}:${bikerUID}:${periodKey}`, fallback: null });
  return { ...query, available: enabled && !query.loading && !query.error && query.data !== null };
}
