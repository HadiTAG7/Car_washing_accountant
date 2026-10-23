import { useMemo } from 'react';
import { useTemporaryExpenses } from './useTemporaryExpenses';
import { usePartners } from './usePartners';
import { useTaxInvoices } from './useTaxInvoices';
import { useAccountingSettings } from './useAccountingSettings';
import { useFeeRules } from './useFeeRules';
import { useIncomeStatementSources } from './useIncomeStatementSources';
import { useIncomePayrollPreviews } from './useIncomePayrollPreviews';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchRows } from '../lib/firestoreCrud';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { taxPolicyAt } from '../lib/accounting/taxPolicy';
import { reconciliationMonths, subledgerReconciliation } from '../lib/subledgerReconciliation';

// Mounted only in staff's company view. All calls below are existing reads /
// payroll previews; no approval, recovery, posting or saving path is invoked.
export function useTrialReconciliation(ledger, today) {
  const months = useMemo(() => reconciliationMonths(today), [today]);
  const temp = useTemporaryExpenses(), partner = usePartners(), vat = useTaxInvoices();
  const settings = useAccountingSettings(), fees = useFeeRules();
  const assets = useFirestoreQuery(() => fetchRows('fixed_assets'), {
    cacheKey: 'fixed_assets', enabled: isFirebaseConfigured, fallback: [],
  });
  const live = useIncomeStatementSources({ statementMonths: months });
  const payroll = useIncomePayrollPreviews(today.slice(0, 7), { enabled: !live.loading && !live.error, months });
  const model = useMemo(() => subledgerReconciliation({ ...ledger, today, temporaries: temp.expenses,
    partners: partner.partners, assets: assets.data, invoices: vat.invoices,
    sources: { ...live.sources, payrollPreviews: payroll.data }, feeRules: fees.rules,
    policyAt: date => taxPolicyAt(date, settings.settings),
    status: {
      advances: temp, capital: partner, assets,
      vat: { loading: vat.coverage.loading || settings.loading, error: vat.coverage.error || settings.error },
      income: { loading: live.loading || payroll.loading || settings.loading || fees.loading,
        error: live.error || payroll.error || settings.error || fees.error },
    } }), [ledger, today, temp, partner, assets, vat, live, payroll, settings, fees]);
  return { ...model, refetch: () => {
    ledger.refetch(); temp.refetch(); partner.refetch(); assets.refetch(); vat.refetch();
    live.refetch(); payroll.refetch(); settings.refetch(); fees.refetch();
  } };
}
