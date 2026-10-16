import { useMemo } from 'react';
import { useWashes } from './useWashes';
import { useBikers } from './useBikers';
import { useLedger } from './useLedger';
import { useIncomeStatementSources } from './useIncomeStatementSources';
import { useIncomePayrollPreviews } from './useIncomePayrollPreviews';
import { useFeeRules } from './useFeeRules';
import { useAccountingSettings } from './useAccountingSettings';
import { liveIncomeStatement } from '../lib/accounting/liveIncomeStatement';
import { taxPolicyAt } from '../lib/accounting/taxPolicy';
import { overviewOperations, overviewWindow } from '../lib/overviewDashboard';

export function useOverviewDashboard(periodKey, today) {
  const washes = useWashes();
  const workers = useBikers();
  const ledger = useLedger();
  const live = useIncomeStatementSources();
  const fees = useFeeRules();
  const tax = useAccountingSettings();
  const { sources, entries, lines } = live;
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
        try { previous = calculate(window.previousKey); } catch { /* Historical gap must not hide this month. */ }
      }
      return { statement, previous };
    } catch (error) { return { statement: null, previous: null, error }; }
  }, [periodKey, today, loading, error, payroll.data, ledger.accounts, entries, lines, fees.rules, sources, tax.settings]);
  const operations = useMemo(() => overviewOperations({ washes: washes.items, bikers: workers.bikers, periodKey, today }),
    [washes.items, workers.bikers, periodKey, today]);
  const dueVouchers = sources.vouchers.filter(v => v.status === 'unpaid' && String(v.dueDate || '').slice(0, 7) === periodKey && v.dueDate <= today);
  return { finance: { ...finance, loading }, operations, dueVouchers,
    washes, workers,
    retry: () => { washes.refetch(); workers.refetch(); ledger.refetch(); live.refetch(); fees.refetch(); tax.refetch(); payroll.refetch(); } };
}
