import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchRows } from '../lib/firestoreCrud';
import { isFirebaseConfigured } from '../lib/firebaseClient';

// Company staff only; mounted by the page after the role/partner-view gate.
export function useBalanceAssetSources() {
  const documents = useFirestoreQuery(() => fetchRows('startup_cost_entries'), {
    enabled: isFirebaseConfigured, cacheKey: 'startup_cost_entries', fallback: [],
  });
  const parents = useFirestoreQuery(() => fetchRows('startup_costs'), {
    enabled: isFirebaseConfigured, cacheKey: 'startup_costs', fallback: [],
  });
  return { startupEntries: documents.data || [], startupItems: parents.data || [],
    assetSourcesReady: !documents.loading && !parents.loading && !documents.error && !parents.error,
    loading: documents.loading || parents.loading, error: documents.error || parents.error,
    refetch: () => { documents.refetch(); parents.refetch(); } };
}
