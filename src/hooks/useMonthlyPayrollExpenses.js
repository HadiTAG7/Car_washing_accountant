import { useAuth } from './useAuth';
import { useFirestoreQuery } from './useFirestoreQuery';
import { callPayroll, isFirebaseConfigured } from '../lib/firebaseClient';
import { monthlyPayrollExpenses } from '../lib/monthlyPayrollExpenses';

export function useMonthlyPayrollExpenses(periodKey, { enabled = false } = {}) {
  const { user, loading: authLoading } = useAuth();
  const ready = enabled && isFirebaseConfigured && !authLoading && Boolean(user?.id)
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey);
  return useFirestoreQuery(async () => {
    const preview = await callPayroll('payrollPreview', { periodKey, automaticAdvanceDeduction: true });
    return monthlyPayrollExpenses(preview, periodKey);
  }, { enabled: ready, preserveResult: true, queryKey: `${user?.id || ''}:${periodKey}:${enabled}`, fallback: null });
}
