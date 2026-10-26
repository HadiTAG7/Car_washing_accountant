import { composeTaxInvoices } from '../lib/taxInvoiceFeed';
import { useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, where } from '../lib/firestoreCrud';
import {
  mapStartupCostEntry, mapAnnualExpenseEntry, mapMonthlyExpense, mapVariableExpense,
  mapStartupCost,
} from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * Read-only feed of every record flagged as a tax invoice, across all four
 * sources: startup_cost_entries, annual_expense_entries, monthly_expenses and
 * variable_expenses.
 * Powers the "الضريبة المستردة" report — the VAT portion is derived on the
 * page, never stored.
 *
 * Each row is normalised to the ledger-entry shape the report expects
 * ({ description, amount, spentDate, invoiceUrl, … }) and tagged with a
 * `source` plus a unified `parentId`. Four single-field queries, merged and
 * sorted client-side, so no composite index is needed.
 *
 * Startup costs contribute from BOTH levels, but never for the same item:
 * a sub-ledger entry carries its own flag, while an item whose spend was
 * typed in directly carries the flag itself. Items that have entries are
 * excluded from the item-level pass so the VAT is not reclaimed twice.
 *
 * Monthly expenses are not ledger entries, so two things are mapped across:
 *   • `amount`    ← total_monthly_cost (the VAT-inclusive figure)
 *   • `spentDate` ← logged_date for one-off rows; a RECURRING row has no
 *     single date, so it carries `recurring: true` and an empty date.
 *
 * A dateless recurring row is NOT claimable. It used to be counted once per
 * month of the return period, which invented invoices nobody had received;
 * the report now rejects it and says which fields are missing. Deduction
 * needs a document — see `inputInvoiceEligibility` in vatReturn.js.
 *
 * Every source therefore also carries the invoice identity: invoiceNumber,
 * invoiceDate, supplier and vatDeductible.
 *
 * Once a recurring template has generated dated VOUCHERS, those vouchers are
 * the documents and the template drops out — same double-count guard as the
 * startup one, for the same reason: a real dated document and a ×N estimate
 * of the same cost must never both be claimed.
 */
export function useTaxInvoices({ includeNonTax = false } = {}) {
  const startupQ = useFirestoreQuery(
    () => fetchRows('startup_cost_entries', includeNonTax ? [] : [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapStartupCostEntry, fallback: [] },
  );

  const annualQ = useFirestoreQuery(
    () => fetchRows('annual_expense_entries', includeNonTax ? [] : [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapAnnualExpenseEntry, fallback: [] },
  );

  // Startup ITEMS flagged as tax invoices — for items whose spend was typed
  // in directly. Items that have sub-ledger entries are filtered out below.
  const startupItemsQ = useFirestoreQuery(
    () => fetchRows('startup_costs', includeNonTax ? [] : [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapStartupCost, fallback: [] },
  );

  // Every entry's parent id — identifies which items are ledger-managed.
  const ledgerParentsQ = useFirestoreQuery(
    () => fetchRows('startup_cost_entries'),
    { enabled: isFirebaseConfigured, fallback: [] },
  );

  const variableQ = useFirestoreQuery(
    () => fetchRows('variable_expenses', includeNonTax ? [] : [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapVariableExpense, fallback: [] },
  );

  const monthlyQ = useFirestoreQuery(
    () => fetchRows('monthly_expenses', includeNonTax ? [] : [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapMonthlyExpense, fallback: [] },
  );

  // Dated vouchers generated from the recurring templates. Once a template
  // has vouchers, they are the documents — see the double-count guard below.
  const vouchersQ = useFirestoreQuery(
    () => fetchRows('expense_vouchers'),
    { enabled: isFirebaseConfigured, fallback: [] },
  );

  const invoices = useMemo(() => {
    return composeTaxInvoices({ startupEntries: startupQ.data, annualEntries: annualQ.data, monthlyExpenses: monthlyQ.data,
      variableExpenses: variableQ.data, voucherItems: vouchersQ.data, ledgerParents: ledgerParentsQ.data, parentItems: startupItemsQ.data, includeNonTax });
  }, [startupQ.data, startupItemsQ.data, ledgerParentsQ.data, annualQ.data,
    monthlyQ.data, vouchersQ.data, variableQ.data, includeNonTax]);

  const loading = startupQ.loading || startupItemsQ.loading || annualQ.loading
    || monthlyQ.loading || vouchersQ.loading || variableQ.loading;
  // Page-level error only when EVERY source failed; a single failed source
  // gets a compact per-source note while the healthy ones keep rendering.
  const error = (startupQ.error && annualQ.error && monthlyQ.error && variableQ.error)
    ? startupQ.error : null;
  const sourceErrors = {
    startup: startupQ.error || null,
    annual:  annualQ.error  || null,
    monthly: monthlyQ.error || null,
    variable: variableQ.error || null,
  };
  const refetch = () => {
    startupQ.refetch(); startupItemsQ.refetch(); ledgerParentsQ.refetch();
    annualQ.refetch(); monthlyQ.refetch(); vouchersQ.refetch(); variableQ.refetch();
  };

  // Consumers of a single headline total must not interpret partial coverage
  // as a complete tax report. Keep the existing detail-page contract intact.
  const coverage = {
    loading: loading || ledgerParentsQ.loading,
    error: startupQ.error || startupItemsQ.error || ledgerParentsQ.error || annualQ.error
      || monthlyQ.error || vouchersQ.error || variableQ.error || null,
  };
  return { invoices, loading, error, sourceErrors, coverage, refetch };
}
