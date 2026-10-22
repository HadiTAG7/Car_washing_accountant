import { useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { useAuth } from './useAuth';
import { useFirestoreQuery } from './useFirestoreQuery';
import { firestoreScopeExecutor as exec } from '../lib/accounting/firestoreScopeExecutor';
import { monthsBetween } from '../lib/accounting/incomeStatementScope';
import { monthOf, todayMonth } from '../lib/variableExpenseTotals';

// The dates an income statement month can come from.
const FIELDS = [
  ['washes', 'wash_date'], ['journal_entries', 'entryDate'],
  ['variable_expenses', 'invoice_date'], ['variable_expenses', 'logged_date'],
  ['monthly_expenses', 'logged_date'], ['annual_expense_entries', 'invoice_date'],
  ['annual_expense_entries', 'spent_date'], ['expense_vouchers', 'invoiceDate'], ['expense_vouchers', 'dueDate'],
];
const prefixMonth = value => monthOf(value) || monthOf(String(value || '').slice(0, 10)) || null;

/**
 * The months the income statement can be opened on: every month from the
 * first recorded date to the last (and today's), plus closed periods and
 * payroll runs. It used to be collected by scanning every record of eleven
 * collections; the first and last value of each date field cost one read
 * each. A month with nothing recorded inside that span is listed too and
 * simply shows an empty statement.
 */
export function useStatementMonths({ periods = [], payrollMonths = [] } = {}) {
  const { user } = useAuth();
  const edges = useFirestoreQuery(
    () => Promise.all(FIELDS.flatMap(([name, field]) => ['asc', 'desc'].map(dir => exec.edge(name, field, dir).catch(() => null)))),
    { enabled: isFirebaseConfigured && Boolean(user?.id), preserveResult: true, cacheKey: 'statementMonthEdges',
      cacheTags: [...new Set(FIELDS.map(([name]) => name))], queryKey: user?.id || '', fallback: [] },
  );
  return useMemo(() => {
    const known = [todayMonth(), ...(edges.data || []).map(prefixMonth), ...periods, ...payrollMonths]
      .filter(key => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(key || '')));
    if (!known.length) return [todayMonth()];
    const sorted = [...new Set(known)].sort();
    return monthsBetween(sorted[0], sorted.at(-1)).reverse();
  }, [edges.data, periods, payrollMonths]);
}
