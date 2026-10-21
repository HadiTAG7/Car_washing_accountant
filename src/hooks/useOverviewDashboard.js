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
import { useSweaterAdjustments } from './useSweater';

export function useOverviewDashboard(periodKey, today) {
  const live = useIncomeStatementSources();
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
  const payroll = useIncomePayrollPreviews(periodKey, { enabled: !live.loading && !live.error,
    revision: JSON.stringify([sources.payrollRuns,
      (sources.bikers || []).map(b => [b.id, b.salary, b.name, b.start_date || b.startDate, b.end_date || b.endDate]),
      entries.map(e => [e.id, e.status]),
      sources.washes.map(w => [w.id, w.quantity, w.wash_date, w.status, w.biker_id, w.biker_name, w.ssp_booking_id])]) });
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
    retry: () => { ledger.refetch(); fees.refetch(); tax.refetch(); payroll.refetch(); adjustments.refetch(); } };
}
