import { useMemo, useState } from 'react';
import { useOverviewDashboard } from './useOverviewDashboard';
import { useLedger } from './useLedger';
import { cashAccountBalances } from './useExecutiveDailyMetrics';
import { useTaxInvoices } from './useTaxInvoices';
import { useAccountingSettings } from './useAccountingSettings';
import { useWashes } from './useWashes';
import { useBudgets } from './useBudgets';
import { useMonthlyExpenses } from './useMonthlyExpenses';
import { useMonthlyExpenseCategories } from './useMonthlyExpenseCategories';
import { useAnnualExpenses } from './useAnnualExpenses';
import { useAnnualExpenseCategories } from './useAnnualExpenseCategories';
import { useVariableExpenses } from './useVariableExpenses';
import { useVariableExpenseCategories } from './useVariableExpenseCategories';
import { useBudgetReadModel, readHidden } from './useBudgetReadModel';
import { useFirestoreQuery } from './useFirestoreQuery';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows } from '../lib/firestoreCrud';
import { riyadhTodayISO } from '../lib/washesYesterday';
import { todayMonth } from '../lib/variableExpenseTotals';
import { mapAnnualExpenseEntry } from '../lib/mappers';
import { financeLedgerSnapshot, financeVatSnapshot, financeWorkbenchCounts } from '../lib/financeHome';

function useDocumentSource(collection) {
  return useFirestoreQuery(() => fetchRows(collection),
    { enabled: isFirebaseConfigured, cacheKey: collection, fallback: [] });
}

export function useFinanceHomeData(month) {
  const today = riyadhTodayISO();
  const overview = useOverviewDashboard(month, today);
  const ledger = useLedger();
  const tax = useTaxInvoices();
  const settings = useAccountingSettings();
  // The VAT and budget pages genuinely use the complete wash register.
  const washes = useWashes();
  const budgets = useBudgets();
  const monthly = useMonthlyExpenses(), monthlyCats = useMonthlyExpenseCategories();
  const annual = useAnnualExpenses(), annualCats = useAnnualExpenseCategories();
  const variable = useVariableExpenses(), variableCats = useVariableExpenseCategories();
  const [hiddenKeys, setHiddenKeys] = useState(readHidden);
  const budgetMonth = todayMonth();
  // These are raw readers of the same cache units as the original registers.
  // No per-document network loop and no limited workbench page mistaken for a total.
  const variableDocs = useDocumentSource('variable_expenses');
  const monthlyDocs = useDocumentSource('monthly_expenses');
  const annualDocs = useDocumentSource('annual_expense_entries');
  const startupDocs = useDocumentSource('startup_cost_entries');
  const documentSources = [variableDocs, monthlyDocs, annualDocs, startupDocs];
  const budgetModel = useBudgetReadModel({ budgets: budgets.items, monthlies: monthly.items, monthlyCats: monthlyCats.categories,
    annuals: annual.items, annualCats: annualCats.categories, variables: variable.items, variableCats: variableCats.categories,
    washes: washes.items, hiddenKeys, currentMonth: budgetMonth, currentYear: today.slice(0,4), asOfDate:today,
    annualEntries:(annualDocs.data || []).map(mapAnnualExpenseEntry) });
  const locks = useFirestoreQuery(() => fetchRows('posting_locks'),
    { enabled: isFirebaseConfigured, cacheKey: 'posting_locks', fallback: [] });
  const ledgerReady = !ledger.loading && !ledger.error && !ledger.needsSeeding && ledger.accounts.length > 0;
  const { accounts, entries, lines } = ledger;
  const ledgerSnapshot = useMemo(() => ledgerReady
    ? financeLedgerSnapshot({ accounts, entries, lines }, month, cashAccountBalances({ accounts, entries, lines })) : null,
  [ledgerReady, accounts, entries, lines, month]);
  const taxLoading = tax.coverage?.loading || tax.loading || settings.loading || washes.loading || ledger.loading;
  const taxError = tax.coverage?.error || tax.error || Object.values(tax.sourceErrors || {}).find(Boolean)
    || settings.error || washes.error || ledger.error;
  const vat = useMemo(() => !taxLoading && !taxError && ledgerReady
    ? financeVatSnapshot({ invoices: tax.invoices, washes: washes.items, entries: ledger.entries, lines: ledger.lines, settings: settings.settings, month })
    : null, [taxLoading, taxError, ledgerReady, tax.invoices, washes.items, ledger.entries, ledger.lines, settings.settings, month]);
  const budgetSources = [budgets, monthly, monthlyCats, annual, annualCats, variable, variableCats, washes, annualDocs];
  const budgetLoading = budgetSources.some(source => source.loading);
  const budgetError = budgetSources.find(source => source.error)?.error;
  const documentLoading = documentSources.some(source => source.loading) || locks.loading || ledger.loading;
  const documentError = documentSources.find(source => source.error)?.error || locks.error || ledger.error;
  const workbench = useMemo(() => !documentLoading && !documentError && ledgerReady
    ? financeWorkbenchCounts({ sources: { variable_expenses: variableDocs.data, monthly_expenses: monthlyDocs.data,
      annual_expense_entries: annualDocs.data, startup_cost_entries: startupDocs.data },
    locks: locks.data || [], entries: ledger.entries, periods: ledger.periods })
    : null, [documentLoading, documentError, variableDocs.data, monthlyDocs.data, annualDocs.data, startupDocs.data,
      locks.data, ledgerReady, ledger.entries, ledger.periods]);
  const settlementSource = overview.settlements;
  const settlement = !settlementSource.loading && !settlementSource.error
    ? settlementSource.items.find(row => row.periodKey === month) || null : null;
  const loading = overview.finance.loading || ledger.loading || taxLoading || budgetLoading || documentLoading || settlementSource.loading;
  const problems = [
    [!ledgerReady && !ledger.loading, 'الدفتر'],
    [!overview.finance.statement && !overview.finance.loading, 'قائمة الدخل'],
    [!vat && !taxLoading, 'الضريبة'],
    [budgetError, 'الميزانيات'],
    [!workbench && !documentLoading, 'صندوق العمل'],
    [settlementSource.error, 'تسويات سويتر'],
  ].filter(([failed]) => failed).map(([, name]) => name);
  const refresh = () => {
    overview.retry(); ledger.refetch(); tax.refetch(); settings.refetch(); washes.refetch();
    budgetSources.filter(source => source !== washes).forEach(source => source.refetch());
    // Monthly/variable raw readers observe the refresh of their shared units above.
    startupDocs.refetch(); locks.refetch(); setHiddenKeys(readHidden());
  };
  return { today, month, loading, problems, refresh, ledger: ledgerSnapshot, statement: overview.finance.statement,
    vat, workbench, settlement, settlementReady: !settlementSource.loading && !settlementSource.error,
    budget: !budgetLoading && !budgetError ? { ...budgetModel, month: budgetMonth } : null };
}
