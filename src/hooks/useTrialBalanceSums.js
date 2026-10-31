import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchPostedLineSums } from '../lib/accounting/ledgerSums';
import { previousDay } from '../lib/trialBalanceView';

/**
 * Per-account sums for the trial balance, added up in the database: the
 * opening (everything before «من») and the period's movement. Tagged with the
 * journal collections, so a posting re-reads them like any ledger reader.
 */
export function useTrialBalanceSums({ from, to, enabled = true }) {
  return useFirestoreQuery(async () => {
    const [opening, movement] = await Promise.all([
      from ? fetchPostedLineSums({ to: previousDay(from) }) : [],
      fetchPostedLineSums({ from: from || null, to: to || null }),
    ]);
    return { opening, movement };
  }, {
    cacheKey: 'journal_entries:trial-balance-sums', queryKey: `${from || ''}..${to || ''}`,
    cacheTags: ['journal_entries', 'journal_lines'], enabled, preserveResult: true, fallback: null,
  });
}
