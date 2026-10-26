import { useAuth } from './useAuth';
import { useBikers } from './useBikers';
import { useSweaterMetrics } from './useSweater';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchRows, getRow, where } from '../lib/firestoreCrud';
import { callServer } from '../lib/ledgerTransport';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { invalidateCollections } from '../lib/readCache';
import { previousQualityMonth } from '../lib/qualityViolations';
export function useQualityViolations(month) {
  const { user } = useAuth();
  const current = useSweaterMetrics(month), previous = useSweaterMetrics(previousQualityMonth(month)), workers = useBikers();
  const enabled = isFirebaseConfigured && Boolean(user?.id);
  const objections = useFirestoreQuery(() => fetchRows('quality_objections', [where('periodKey', '==', month)]),
    { enabled, cacheKey: `quality_objections:${month}`, cacheTags: ['quality_objections'], queryKey: user?.id, deps: [month], fallback: [] });
  const settings = useFirestoreQuery(() => getRow('app_settings', 'quality-objections'),
    { enabled, preserveResult: true, cacheKey: 'quality-objections-settings', cacheTags: ['app_settings'], queryKey: user?.id, fallback: null });
  const refresh = () => { current.refetch(); previous.refetch(); workers.refetch(); objections.refetch(); settings.refetch(); };
  return { current, previous, workers, objections, settings, refresh,
    save: async input => { const result = await callServer('qualityObjectionSave', input); invalidateCollections(['quality_objections', 'audit_logs']); await objections.refetch(); return result; },
    saveSettings: async input => { const result = await callServer('qualityObjectionSettingsSave', input); invalidateCollections(['app_settings', 'audit_logs']); await settings.refetch(); return result; } };
}
