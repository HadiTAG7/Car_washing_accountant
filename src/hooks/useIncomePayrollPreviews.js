import { useAuth } from './useAuth';
import { useFirestoreQuery } from './useFirestoreQuery';
import { callPayroll, isFirebaseConfigured } from '../lib/firebaseClient';

export function incomePayrollMonths(periodKey) {
  const [year, month] = String(periodKey).split('-').map(Number);
  return Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(year, month - 6 + index, 1)).toISOString().slice(0, 7));
}

// Preview only. Admin/accountant already have payrollPreview permission;
// a real partner never receives company payroll rows through this hook.
export function useIncomePayrollPreviews(periodKey, { enabled = false, revision = '' } = {}) {
  const { user, loading } = useAuth();
  const ready = enabled && isFirebaseConfigured && !loading && Boolean(user?.id)
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey);
  return useFirestoreQuery(async () => Promise.all(incomePayrollMonths(periodKey).map(async month => {
    const preview = await callPayroll('payrollPreview', { periodKey: month, automaticAdvanceDeduction: true });
    if (preview?.periodKey !== month || !Array.isArray(preview.lines)) throw new Error('معاينة الرواتب لا تطابق شهر قائمة الدخل.');
    return preview;
  })), { enabled: ready, preserveResult: true, queryKey: JSON.stringify([user?.id, periodKey, enabled, revision]), fallback: [] });
}
