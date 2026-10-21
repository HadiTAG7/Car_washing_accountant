import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchAccounts, fetchEntries, fetchPeriods, embeddedLinesOf, COL } from '../lib/accounting/firestoreLedger';
import { fetchRows } from '../lib/firestoreCrud';
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
export function useLedger({ liveSources = null } = {}) {
  const readJournal = isFirebaseConfigured && !liveSources;
  const accountsQ = useFirestoreQuery(fetchAccounts, { cacheKey: 'chart_of_accounts', enabled: isFirebaseConfigured, fallback: [] });
  const entriesQ  = useFirestoreQuery(fetchEntries, { cacheKey: 'journal_entries', enabled: readJournal, fallback: [] });
  // fetchLines also reads journal_entries. Reuse the entries already fetched
  // above instead; only the frozen legacy collection needs a separate read.
  const linesQ = useFirestoreQuery(() => fetchRows(COL.LINES), { cacheKey: COL.LINES, enabled: readJournal, fallback: [] });
  const periodsQ  = useFirestoreQuery(fetchPeriods,  { cacheKey: 'accounting_periods', enabled: isFirebaseConfigured, fallback: [] });

  const accounts = useMemo(() => accountsQ.data || [], [accountsQ.data]);
  const entries = useMemo(() => liveSources ? liveSources.entries : entriesQ.data || [], [liveSources, entriesQ.data]);
  const lines = useMemo(() => liveSources ? liveSources.lines
    : entries.flatMap(embeddedLinesOf).concat(linesQ.data || []), [liveSources, entries, linesQ.data]);
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

  const { refetch: refreshAccounts } = accountsQ;
  const { refetch: refreshPeriods } = periodsQ;
  const { refetch: refreshEntries } = entriesQ;
  const { refetch: refreshLegacyLines } = linesQ;
  const refetch = useCallback(() => {
    refreshAccounts(); refreshPeriods();
    if (liveSources) liveSources.refetch();
    else { refreshEntries(); refreshLegacyLines(); }
  }, [refreshAccounts, refreshPeriods, refreshEntries, refreshLegacyLines, liveSources]);

  return {
    accounts, entries, lines, periods,
    accountIndex, periodIndex, linesByEntry,
    // The chart being empty is the actionable state: it means "not seeded yet".
    needsSeeding: isFirebaseConfigured && !accountsQ.loading && accounts.length === 0,
    loading: accountsQ.loading || periodsQ.loading || (liveSources ? liveSources.loading : entriesQ.loading || linesQ.loading),
    error: accountsQ.error || periodsQ.error || (liveSources ? liveSources.error : entriesQ.error || linesQ.error) || null,
    refetch,
  };
}
