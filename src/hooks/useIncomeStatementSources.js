import { useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useFirestoreQuery } from './useFirestoreQuery';
import { cachedRead } from '../lib/readCache';
import { loadScopedIncomeSources, nextMonthKey, compareIds } from '../lib/accounting/incomeStatementScope';
import { firestoreScopeExecutor } from '../lib/accounting/firestoreScopeExecutor';

const SOURCE_NAMES = ['washes', 'variables', 'monthlies', 'annualEntries', 'vouchers', 'bookings', 'settlements', 'journalEntries', 'legacyLines'];
const FINANCE_TAGS = ['washes', 'variable_expenses', 'monthly_expenses', 'annual_expense_entries', 'expense_vouchers',
  'sweater_bookings', 'sweater_settlements', 'journal_entries', 'journal_lines', 'bikers'];
const empty = () => Object.fromEntries(SOURCE_NAMES.map(key => [key, []]));
const exec = firestoreScopeExecutor;

/**
 * The income statement's sources for the months a page shows — not the whole
 * history. `statementMonths` are the statements computed; `washMonths` (a
 * superset) the washes the overview needs to deduplicate through today.
 * The reads, and why their result equals the whole collections', are in
 * lib/accounting/incomeStatementScope.js. Results are cached for the session
 * per month, so the overview, the income statement and the washes page share
 * what any of them read; «تحديث» or a write re-reads.
 *
 * Washes and workers load on their own, so a failed finance read cannot hide
 * the verified wash figures (each source keeps its own status).
 */
export function useIncomeStatementSources({ statementMonths = [], washMonths = statementMonths } = {}) {
  const { user } = useAuth(); const { role } = usePartnerView();
  const identity = user?.id || null;
  const enabled = isFirebaseConfigured && Boolean(identity) && role !== 'supervisor' && statementMonths.length > 0;
  const canReadPayroll = ['admin', 'accountant'].includes(role);
  const ms = [...new Set(statementMonths)].sort().join(',');
  const mw = [...new Set([...washMonths, ...statementMonths])].sort().join(',');
  const queryKey = JSON.stringify([identity, role]);
  // Month units are shared between pages, never between accounts.
  const sharedUnits = (key, tags, fn) => cachedRead(`${identity}|${key}`, fn, { tags });

  const washesQ = useFirestoreQuery(() => Promise.all(mw.split(',').filter(Boolean).map(month =>
    sharedUnits(`washes:wash_date:${month}`, ['washes'], () => exec.range('washes', 'wash_date', month, nextMonthKey(month)))))
    // Document-id order, as a whole-collection read returns: duplicates keep the first.
    .then(lists => lists.flat().sort((a, b) => compareIds(a.id, b.id))),
  { enabled, preserveResult: true, cacheKey: `incomeWashes:${mw}`, cacheTags: ['washes'], queryKey, deps: [mw], fallback: [] });
  const bikersQ = useFirestoreQuery(() => sharedUnits('bikers', ['bikers'], () => exec.all('bikers')),
    { enabled: enabled && canReadPayroll, preserveResult: true, cacheKey: 'incomeBikers', cacheTags: ['bikers'], queryKey, fallback: [] });
  const financeQ = useFirestoreQuery(() => loadScopedIncomeSources(exec, {
    statementMonths: ms.split(','), washMonths: mw.split(','), cached: sharedUnits,
  }), { enabled, preserveResult: true, cacheKey: `incomeSources:${ms}|${mw}`, cacheTags: FINANCE_TAGS, queryKey, deps: [ms, mw], fallback: null });

  const sources = useMemo(() => {
    const finance = financeQ.data || empty();
    // The finance load holds the same month washes (plus any out-of-window
    // duplicate it had to check); before it settles, the wash read alone.
    return { ...empty(), ...finance, washes: financeQ.data ? finance.washes : (washesQ.data || []),
      ...(canReadPayroll ? { bikers: bikersQ.data || [] } : {}) };
  }, [financeQ.data, washesQ.data, bikersQ.data, canReadPayroll]);
  const status = q => ({ loading: Boolean(q.loading), error: q.error || null });
  const sourceStatus = Object.fromEntries([
    ...SOURCE_NAMES.map(name => [name, name === 'washes' ? status(washesQ) : status(financeQ)]),
    ...(canReadPayroll ? [['bikers', status(bikersQ)]] : []),
  ]);
  const entries = sources.journalEntries;
  const lines = useMemo(() => entries.flatMap(entry => (entry.lines || []).map((line, i) => ({ ...line, entryId: entry.id, id: `${entry.id}:${i}` })))
    .concat(sources.legacyLines), [entries, sources.legacyLines]);
  const pending = enabled && (washesQ.loading || financeQ.loading || (canReadPayroll && bikersQ.loading));
  return { sources, sourceStatus, entries, lines, loading: Boolean(pending),
    error: financeQ.error || washesQ.error || (canReadPayroll ? bikersQ.error : null) || null,
    refetch: () => { washesQ.refetch(); financeQ.refetch(); if (canReadPayroll) bikersQ.refetch(); } };
}
