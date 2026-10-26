import { useMemo } from 'react';
import { useOverviewDashboard } from './useOverviewDashboard';
import { useLedger } from './useLedger';
import { cashAccountBalances } from '../lib/accounting/cashBalances';
export { cashAccountBalances } from '../lib/accounting/cashBalances';
import { riyadhTodayISO } from '../lib/washesYesterday';
import { overviewOperations } from '../lib/overviewDashboard';

export function useExecutiveDailyMetrics() {
  const today = riyadhTodayISO(), periodKey = today.slice(0, 7);
  const overview = useOverviewDashboard(periodKey, today);
  // A cumulative cash balance needs the whole posted ledger, not the overview's month scope.
  // useLedger shares cached chart/journal reads with the finance pages; it never writes.
  const { accounts, entries, lines, loading, error, needsSeeding } = useLedger();
  const balances = useMemo(() => loading || error || needsSeeding || !accounts.length
    ? null : cashAccountBalances({ accounts, entries, lines }), [loading, error, needsSeeding, accounts, entries, lines]);
  const yesterdayOperations = useMemo(() => overview.operations?.yesterdayInPeriod ? overview.operations
    : overview.operations && overviewOperations({ washes: overview.washes.items, bikers: overview.workers.bikers,
      periodKey: overview.operations.yesterday.slice(0, 7), today }), [overview.operations, overview.washes.items, overview.workers.bikers, today]);
  return { today, periodKey, overview, yesterdayOperations, cash: { balances, loading,
    error: error || (!loading && !balances ? 'الدفتر غير متاح' : null) } };
}
