import { useMemo } from 'react';
import { documentId } from 'firebase/firestore';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { fetchRows, where } from '../lib/firestoreCrud';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { ledgerSourcePlan } from '../lib/ledgerPresentation';
import { useFirestoreQuery } from './useFirestoreQuery';

// Bounded, cached document reads for the chosen account/window, never writes.
export function useLedgerSourceDocuments(entries, entryIndex) {
  const { role, isPartnerView, isInvestorAccount } = usePartnerView();
  const plan = useMemo(() => {
    const documents = ledgerSourcePlan(entries, entryIndex);
    const creators = [...new Set(entries.map((entry) => entry.createdBy).filter((id) => id && !id.includes('@')))].sort();
    return documents.concat(Array.from({ length: Math.ceil(creators.length / 10) }, (_, i) => ({ collection: 'users', ids: creators.slice(i * 10, i * 10 + 10) })));
  }, [entries, entryIndex]);
  const identity = JSON.stringify(plan);
  const enabled = isFirebaseConfigured && role === 'admin' && !isPartnerView && !isInvestorAccount && plan.length > 0;
  const result = useFirestoreQuery(async () => {
    const batches = await Promise.all(plan.map(async ({ collection, ids }) => {
      const rows = await fetchRows(collection, [where(documentId(), 'in', ids)]);
      return rows.map((data) => ({ key: `${collection}/${data.id}`, data }));
    }));
    return batches.flat();
  }, {
    enabled, queryKey: identity, cacheKey: 'ledger-source-documents',
    cacheTags: [...new Set(plan.map((item) => item.collection))], fallback: [],
  });
  const documents = useMemo(() => new Map((result.data || []).map((row) => [row.key, row.data])), [result.data]);
  return { ...result, documents };
}
