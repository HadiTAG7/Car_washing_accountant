import { useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, where } from '../lib/firestoreCrud';
import {
  mapStartupCostEntry, mapAnnualExpenseEntry, mapMonthlyExpense,
} from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * Read-only feed of every record flagged as a tax invoice, across all three
 * sources: startup_cost_entries, annual_expense_entries and monthly_expenses.
 * Powers the "الضريبة المستردة" report — the VAT portion is derived on the
 * page, never stored.
 *
 * Each row is normalised to the ledger-entry shape the report expects
 * ({ description, amount, spentDate, invoiceUrl, … }) and tagged with a
 * `source` plus a unified `parentId`. Three single-field queries, merged and
 * sorted client-side, so no composite index is needed.
 *
 * Monthly expenses are not ledger entries, so two things are mapped across:
 *   • `amount`    ← total_monthly_cost (the VAT-inclusive figure)
 *   • `spentDate` ← logged_date for one-off rows; a RECURRING row has no
 *     single date, so it carries `recurring: true` and an empty date. The
 *     report treats those as claimable in whichever period is selected,
 *     which is what a monthly VAT return actually does.
 */
export function useTaxInvoices() {
  const startupQ = useFirestoreQuery(
    () => fetchRows('startup_cost_entries', [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapStartupCostEntry, fallback: [] },
  );

  const annualQ = useFirestoreQuery(
    () => fetchRows('annual_expense_entries', [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapAnnualExpenseEntry, fallback: [] },
  );

  const monthlyQ = useFirestoreQuery(
    () => fetchRows('monthly_expenses', [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapMonthlyExpense, fallback: [] },
  );

  const invoices = useMemo(() => {
    const startup = (startupQ.data || []).map((e) => ({
      ...e, source: 'startup', parentId: e.startupCostId,
    }));
    const annual = (annualQ.data || []).map((e) => ({
      ...e, source: 'annual', parentId: e.annualExpenseId,
    }));
    const monthly = (monthlyQ.data || []).map((m) => ({
      id:          m.id,
      description: m.expenseName,
      amount:      m.totalMonthlyCost,
      spentDate:   m.recurrence === 'one_time' ? (m.loggedDate || '') : '',
      notes:       '',
      invoiceUrl:  m.invoiceUrl,
      isTaxInvoice: true,
      createdAt:   m.loggedDate || '',
      source:      'monthly',
      parentId:    m.id,
      recurring:   m.recurrence !== 'one_time',
    }));
    return [...startup, ...annual, ...monthly].sort((a, b) => {
      const byDate = String(b.spentDate).localeCompare(String(a.spentDate));
      return byDate !== 0 ? byDate : String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }, [startupQ.data, annualQ.data, monthlyQ.data]);

  const loading = startupQ.loading || annualQ.loading || monthlyQ.loading;
  // Page-level error only when EVERY source failed; a single failed source
  // gets a compact per-source note while the healthy ones keep rendering.
  const error = (startupQ.error && annualQ.error && monthlyQ.error) ? startupQ.error : null;
  const sourceErrors = {
    startup: startupQ.error || null,
    annual:  annualQ.error  || null,
    monthly: monthlyQ.error || null,
  };
  const refetch = () => { startupQ.refetch(); annualQ.refetch(); monthlyQ.refetch(); };

  return { invoices, loading, error, sourceErrors, refetch };
}
