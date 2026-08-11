import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchAccounts, fetchEntries, fetchLines, fetchPeriods } from '../lib/accounting/firestoreLedger';
import { indexAccounts } from '../lib/accounting/chartOfAccounts';
import { indexPeriods } from '../lib/accounting/periods';

/**
 * One hook feeding every accounting report: the chart, the journal, its lines
 * and the period register. Four independent reads so a missing collection
 * (before the first seed) degrades to an empty report instead of a page-wide
 * error.
 *
 * Reports are computed from this bundle by the pure functions in
 * lib/accounting/reports.js — nothing here does arithmetic.
 */
export function useLedger() {
  const accountsQ = useFirestoreQuery(fetchAccounts, { enabled: isFirebaseConfigured, fallback: [] });
  const entriesQ  = useFirestoreQuery(fetchEntries,  { enabled: isFirebaseConfigured, fallback: [] });
  const linesQ    = useFirestoreQuery(fetchLines,    { enabled: isFirebaseConfigured, fallback: [] });
  const periodsQ  = useFirestoreQuery(fetchPeriods,  { enabled: isFirebaseConfigured, fallback: [] });

  const accounts = useMemo(() => accountsQ.data || [], [accountsQ.data]);
  const entries  = useMemo(() => entriesQ.data  || [], [entriesQ.data]);
  const lines    = useMemo(() => linesQ.data    || [], [linesQ.data]);
  const periods  = useMemo(() => periodsQ.data  || [], [periodsQ.data]);

  const accountIndex = useMemo(() => indexAccounts(accounts), [accounts]);
  const periodIndex  = useMemo(() => indexPeriods(periods),  [periods]);

  // Lines grouped by entry — the period preflight and the entry detail view
  // both need this shape.
  const linesByEntry = useMemo(() => {
    const m = new Map();
    for (const l of lines) {
      if (!m.has(l.entryId)) m.set(l.entryId, []);
      m.get(l.entryId).push(l);
    }
    return m;
  }, [lines]);

  const refetch = useCallback(() => {
    accountsQ.refetch(); entriesQ.refetch(); linesQ.refetch(); periodsQ.refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    accounts, entries, lines, periods,
    accountIndex, periodIndex, linesByEntry,
    // The chart being empty is the actionable state: it means "not seeded yet".
    needsSeeding: isFirebaseConfigured && !accountsQ.loading && accounts.length === 0,
    loading: accountsQ.loading || entriesQ.loading || linesQ.loading || periodsQ.loading,
    error: accountsQ.error || entriesQ.error || linesQ.error || periodsQ.error || null,
    refetch,
  };
}
