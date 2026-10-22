import { useMemo } from 'react';
import { mapWash, mapBiker } from '../lib/mappers';
import { sortBy } from '../lib/firestoreCrud';
import { useLedger } from './useLedger';
import { useIncomeStatementSources } from './useIncomeStatementSources';
import { useIncomePayrollPreviews } from './useIncomePayrollPreviews';
import { useFeeRules } from './useFeeRules';
import { useAccountingSettings } from './useAccountingSettings';
import { liveIncomeStatement } from '../lib/accounting/liveIncomeStatement';
import { taxPolicyAt } from '../lib/accounting/taxPolicy';
import { overviewOperations, overviewWindow } from '../lib/overviewDashboard';
import { monthsBetween } from '../lib/accounting/incomeStatementScope';
import { useSweaterAdjustments } from './useSweater';

/**
 * The months this page needs: the statement for the month (and the previous
 * one once the month is complete — the comparison), and washes from the
 * previous month through today, because duplicates and conflicts are judged
 * over that span. Nothing older is read.
 */
export function overviewMonths(periodKey, today) {
  const window = overviewWindow(periodKey, today);
  const previous = window?.previousKey || periodKey;
  const statementMonths = window?.completeMonth ? [previous, periodKey] : [periodKey];
  const todayMonth = String(today || '').slice(0, 7);
  const last = todayMonth > periodKey ? todayMonth : periodKey;
  return { statementMonths, washMonths: monthsBetween(previous, last) };
}

export function useOverviewDashboard(periodKey, today) {
  const months = useMemo(() => overviewMonths(periodKey, today), [periodKey, today]);
  const live = useIncomeStatementSources(months);
  const ledger = useLedger({ liveSources: live });
  const fees = useFeeRules();
  const tax = useAccountingSettings();
  // The only additional collection read: month-scoped adjustments. Bookings,
  // settlements, workers and washes reuse the statement's live snapshots.
  const adjustments = useSweaterAdjustments(periodKey);
  const { sources, entries, lines } = live;
  // The overview already has live washes and workers for its statement.
  // Reuse those snapshots, retaining each source's loading/error state, so a
  // failed salary query cannot hide otherwise verified operational results.
  const washes = { items: useMemo(() => sortBy(sources.washes, [{ key: 'wash_date', dir: 'desc' }]).map(row => ({ ...mapWash(row),
    // Do not let the legacy form mapper default a missing status/quantity
    // into a completed wash. These overrides are overview-only.
    status: row.status, quantity: Math.max(0, Number(row.quantity) || 0),
  })), [sources.washes]),
    ...(live.sourceStatus?.washes || { loading: live.loading, error: live.error }), refetch: live.refetch };
  const workers = { bikers: useMemo(() => sortBy(sources.bikers || [], [{ key: 'name' }]).map(mapBiker), [sources.bikers]),
    ...(live.sourceStatus?.bikers || { loading: live.loading, error: live.error }), refetch: live.refetch };
  // The salary previews for exactly the statement months, read once and kept
  // for the session; a payroll or wash write drops them, «تحديث» re-reads.
  const payroll = useIncomePayrollPreviews(periodKey, { enabled: !live.loading && !live.error, months: months.statementMonths });
  const loading = live.loading || ledger.loading || fees.loading || tax.loading || payroll.loading;
  const error = live.error || ledger.error || fees.error || tax.error || payroll.error;
  const finance = useMemo(() => {
    if (loading || error) return { statement: null, previous: null, error };
    try {
      const window = overviewWindow(periodKey, today);
      if (!window || !payroll.data?.some(p => p.periodKey === periodKey && !p.unavailable)) return { statement: null, previous: null };
      // Exactly the existing P&L engine and authoritative salary previews.
      // Do not reinterpret capital receipts as sales or prorate monthly wages.
      const calculate = month => liveIncomeStatement({ accounts: ledger.accounts, entries, lines, periodKey: month,
        feeRules: fees.rules, scalingFactor: 1, sources: { ...sources, payrollPreviews: payroll.data },
        policyAt: date => taxPolicyAt(date, tax.settings) });
      const statement = calculate(periodKey);
      let previous = null;
      if (window.completeMonth && payroll.data.some(p => p.periodKey === window.previousKey && !p.unavailable)) {
        try { const candidate = calculate(window.previousKey); previous = candidate.hasActivity ? candidate : null; } catch { /* Historical gap must not hide this month. */ }
      }
      return { statement, previous };
    } catch (error) { return { statement: null, previous: null, error }; }
  }, [periodKey, today, loading, error, payroll.data, ledger.accounts, entries, lines, fees.rules, sources, tax.settings]);
  const operations = useMemo(() => overviewOperations({ washes: washes.items, bikers: workers.bikers, periodKey, today }),
    [washes.items, workers.bikers, periodKey, today]);
  const dueVouchers = sources.vouchers.filter(v => v.status === 'unpaid' && String(v.dueDate || '').slice(0, 7) === periodKey && v.dueDate <= today);
  return { finance: { ...finance, loading }, operations, dueVouchers,
    washes, workers,
    bookings: { items: sources.bookings || [], ...(live.sourceStatus?.bookings || { loading: live.loading, error: live.error }) },
    settlements: { items: sources.settlements || [], ...(live.sourceStatus?.settlements || { loading: live.loading, error: live.error }) },
    adjustments: { items: adjustments.adjustments, loading: adjustments.loading, error: adjustments.error },
    retry: () => { live.refetch(); ledger.refetch(); fees.refetch(); tax.refetch(); payroll.refetch(); adjustments.refetch(); } };
}
