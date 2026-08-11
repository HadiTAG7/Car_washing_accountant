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
 *     single date, so it carries `recurring: true` and an empty date. The
 *     report treats those as claimable in whichever period is selected,
 *     which is what a monthly VAT return actually does.
 *
 * Once a recurring template has generated dated VOUCHERS, those vouchers are
 * the documents and the template drops out — same double-count guard as the
 * startup one, for the same reason: a real dated document and a ×N estimate
 * of the same cost must never both be claimed.
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

  // Startup ITEMS flagged as tax invoices — for items whose spend was typed
  // in directly. Items that have sub-ledger entries are filtered out below.
  const startupItemsQ = useFirestoreQuery(
    () => fetchRows('startup_costs', [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapStartupCost, fallback: [] },
  );

  // Every entry's parent id — identifies which items are ledger-managed.
  const ledgerParentsQ = useFirestoreQuery(
    () => fetchRows('startup_cost_entries'),
    { enabled: isFirebaseConfigured, fallback: [] },
  );

  const variableQ = useFirestoreQuery(
    () => fetchRows('variable_expenses', [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapVariableExpense, fallback: [] },
  );

  const monthlyQ = useFirestoreQuery(
    () => fetchRows('monthly_expenses', [where('is_tax_invoice', '==', true)]),
    { enabled: isFirebaseConfigured, map: mapMonthlyExpense, fallback: [] },
  );

  // Dated vouchers generated from the recurring templates. Once a template
  // has vouchers, they are the documents — see the double-count guard below.
  const vouchersQ = useFirestoreQuery(
    () => fetchRows('expense_vouchers'),
    { enabled: isFirebaseConfigured, fallback: [] },
  );

  const invoices = useMemo(() => {
    const startup = (startupQ.data || []).map((e) => ({
      ...e, source: 'startup', parentId: e.startupCostId,
    }));
    const annual = (annualQ.data || []).map((e) => ({
      ...e, source: 'annual', parentId: e.annualExpenseId,
    }));
    // Monthly expenses: DOUBLE-COUNT GUARD, the same shape as the startup one
    // below. A template that has generated dated vouchers is represented by
    // those vouchers; counting the template as well would claim the same tax
    // twice — once as a real document and once as a ×N estimate.
    const voucherRows = (vouchersQ.data || []).filter((v) => v.status !== 'cancelled');
    const voucheredTemplates = new Set(voucherRows.map((v) => String(v.templateId)));
    const monthly = (monthlyQ.data || [])
      .filter((m) => !voucheredTemplates.has(String(m.id)))
      .map((m) => ({
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
    // Each voucher IS a dated document, so it needs no recurrence estimate.
    const vouchers = voucherRows
      .filter((v) => v.isTaxInvoice)
      .map((v) => ({
        id:           v.id,
        description:  `${v.templateName || 'مصروف شهري'} — ${v.periodKey}`,
        amount:       Number(v.amount) || 0,
        spentDate:    v.dueDate || '',
        notes:        '',
        invoiceUrl:   v.invoiceUrl || '',
        isTaxInvoice: true,
        createdAt:    v.generatedAtIso || v.dueDate || '',
        source:       'monthly',
        parentId:     v.templateId,
      }));
    // Variable expenses are one-off logged events, so they always carry a
    // real spend date — no recurring special case needed.
    const variable = (variableQ.data || []).map((v) => ({
      id:           v.id,
      description:  v.expenseName,
      amount:       v.totalVariableCost,
      spentDate:    v.loggedDate || '',
      notes:        '',
      invoiceUrl:   v.invoiceUrl,
      isTaxInvoice: true,
      createdAt:    v.loggedDate || '',
      source:       'variable',
      parentId:     v.id,
    }));
    // Startup items: DOUBLE-COUNT GUARD. An item managed by the sub-ledger
    // already contributes its VAT through those entries, so a parent flag on
    // it must be ignored here — otherwise the same tax is reclaimed twice.
    const ledgerManaged = new Set(
      (ledgerParentsQ.data || []).map((r) => r.startup_cost_id).filter(Boolean),
    );
    const startupItems = (startupItemsQ.data || [])
      .filter((i) => !ledgerManaged.has(i.id) && i.actualAmount > 0)
      .map((i) => ({
        id:           i.id,
        description:  i.itemName,
        // VAT is reclaimable on money actually paid, never on the plan.
        amount:       i.actualAmount,
        spentDate:    String(i.createdAt || '').slice(0, 10),
        notes:        '',
        invoiceUrl:   i.invoiceUrl,
        isTaxInvoice: true,
        createdAt:    i.createdAt || '',
        source:       'startup',
        parentId:     i.id,
      }));
    return [...startup, ...startupItems, ...annual, ...monthly, ...vouchers, ...variable]
      .sort((a, b) => {
        const byDate = String(b.spentDate).localeCompare(String(a.spentDate));
        return byDate !== 0 ? byDate : String(b.createdAt).localeCompare(String(a.createdAt));
      });
  }, [startupQ.data, startupItemsQ.data, ledgerParentsQ.data, annualQ.data,
    monthlyQ.data, vouchersQ.data, variableQ.data]);

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

  return { invoices, loading, error, sourceErrors, refetch };
}
