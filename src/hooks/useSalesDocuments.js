import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchDocuments, fetchSellerProfile, sequenceGaps } from '../lib/accounting/firestoreInvoicing';
import { documentSign } from '../lib/accounting/invoicing';

/**
 * المستندات الضريبية — issued invoices and their notes, plus the seller
 * identity printed on them.
 *
 * The totals are netted by document SIGN: a credit note subtracts, so the
 * output tax shown here is what the period actually owes rather than the sum
 * of everything ever printed.
 */
export function useSalesDocuments() {
  const docsQ = useFirestoreQuery(fetchDocuments, { enabled: isFirebaseConfigured, fallback: [] });
  const sellerQ = useFirestoreQuery(fetchSellerProfile, { enabled: isFirebaseConfigured, fallback: null });

  const documents = useMemo(() => {
    const rows = docsQ.data || [];
    return [...rows].sort((a, b) => String(b.issueDate || '').localeCompare(String(a.issueDate || ''))
      || String(b.documentNumber || '').localeCompare(String(a.documentNumber || '')));
  }, [docsQ.data]);

  const totals = useMemo(() => {
    let net = 0, vat = 0, gross = 0;
    for (const d of documents) {
      if (d.status === 'cancelled') continue;   // a voided document owes nothing
      const s = documentSign(d.type);
      net += (Number(d.net) || 0) * s;
      vat += (Number(d.vat) || 0) * s;
      gross += (Number(d.gross) || 0) * s;
    }
    return { net, vat, gross, count: documents.length };
  }, [documents]);

  const gaps = useMemo(() => sequenceGaps(documents), [documents]);

  const refetch = useCallback(() => {
    docsQ.refetch(); sellerQ.refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    documents,
    seller: sellerQ.data,
    totals,
    gaps,
    // A gap or a duplicate in a tax series is a finding, not a detail.
    integrityProblems: gaps.filter((g) => g.missing.length || g.duplicates.length),
    loading: docsQ.loading || sellerQ.loading,
    error: docsQ.error || sellerQ.error || null,
    refetch,
  };
}
