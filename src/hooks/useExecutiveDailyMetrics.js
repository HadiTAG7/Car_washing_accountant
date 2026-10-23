import { useMemo } from 'react';
import { useOverviewDashboard } from './useOverviewDashboard';
import { useLedger } from './useLedger';
import { generalLedger } from '../lib/accounting/reports';
import { ACC } from '../lib/accounting/chartOfAccounts';
import { riyadhTodayISO } from '../lib/washesYesterday';
import { overviewOperations } from '../lib/overviewDashboard';

export function cashAccountBalances(ledger) {
  const roots = new Set([ACC.CASH, ACC.BANK]);
  // Include named sub-accounts, without treating every current asset as cash.
  let added;
  do {
    added = false;
    for (const account of ledger.accounts) if (roots.has(String(account.parentId)) && !roots.has(String(account.code))) {
      roots.add(String(account.code)); added = true;
    }
  } while (added);
  return ledger.accounts.filter(account => roots.has(String(account.code))).map(account => ({
    code: account.code, name: account.nameArabic || 'حساب نقدي',
    balance: generalLedger(account.code, ledger.entries, ledger.lines).closing,
  }));
}

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
