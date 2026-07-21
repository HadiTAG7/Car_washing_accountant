import { useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, where } from '../lib/firestoreCrud';
import { mapStartupCostEntry, mapAnnualExpenseEntry } from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * Read-only feed of every ledger entry flagged as a tax invoice, across
 * BOTH sources: startup_cost_entries and annual_expense_entries. Powers the
 * "الضريبة المستردة" report — the VAT portion is derived on the page.
 *
 * Each row is tagged with `source` + a unified `parentId`. Two queries
 * merged + sorted client-side (single-field where, no composite index).
 */
export function useTaxInvoices() {
  const startupQ = useFirestoreQuery(
    () => fetchRows('startup_cost_entries', [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapStartupCostEntry, fallback: [] },
  );

  const annualQ = useFirestoreQuery(
    () => fetchRows('annual_expense_entries', [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapAnnualExpenseEntry, fallback: [] },
  );

  const invoices = useMemo(() => {
    const startup = (startupQ.data || []).map((e) => ({
      ...e, source: 'startup', parentId: e.startupCostId,
    }));
    const annual = (annualQ.data || []).map((e) => ({
      ...e, source: 'annual', parentId: e.annualExpenseId,
    }));
    return [...startup, ...annual].sort((a, b) => {
      const byDate = String(b.spentDate).localeCompare(String(a.spentDate));
      return byDate !== 0 ? byDate : String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }, [startupQ.data, annualQ.data]);

  const loading = startupQ.loading || annualQ.loading;
  const error   = (startupQ.error && annualQ.error) ? startupQ.error : null;
  const sourceErrors = {
    startup: startupQ.error || null,
    annual:  annualQ.error  || null,
  };
  const refetch = () => { startupQ.refetch(); annualQ.refetch(); };

  return { invoices, loading, error, sourceErrors, refetch };
}
