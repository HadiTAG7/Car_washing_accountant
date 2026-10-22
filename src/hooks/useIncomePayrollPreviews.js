import { useAuth } from './useAuth';
import { useFirestoreQuery } from './useFirestoreQuery';
import { callPayroll, isFirebaseConfigured } from '../lib/firebaseClient';

export function incomePayrollMonths(periodKey) {
  const [year, month] = String(periodKey).split('-').map(Number);
  return Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(year, month - 6 + index, 1)).toISOString().slice(0, 7));
}

// Preview only. Admin/accountant already have payrollPreview permission;
// a real partner never receives company payroll rows through this hook.
//
// One server call for the months asked (not one per month), cached for the
// session: a payroll or wash write drops it (server reports are tagged `*`),
// and «تحديث» re-reads it. The selected month must succeed; another month that
// fails stays explicitly unavailable — never zero wages.
export function useIncomePayrollPreviews(periodKey, { enabled = false, months = null } = {}) {
  const { user, loading } = useAuth();
  const ready = enabled && isFirebaseConfigured && !loading && Boolean(user?.id)
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey);
  const wanted = months || incomePayrollMonths(periodKey);
  return useFirestoreQuery(async () => {
    const results = await callPayroll('payrollPreviews', { periodKeys: wanted });
    return wanted.map(month => {
      const preview = (results || []).find(row => row?.periodKey === month);
      if (preview && !preview.error && Array.isArray(preview.lines)) return preview;
      if (month === periodKey) {
        const error = new Error(preview?.error?.message || 'معاينة الرواتب لا تطابق شهر قائمة الدخل.');
        if (preview?.error?.code) error.code = preview.error.code;
        throw error;
      }
      // A historical chart gap cannot hide a verified selected-month report.
      return { periodKey: month, unavailable: true };
    });
  }, { enabled: ready, preserveResult: true, cacheKey: `payrollPreviews:${wanted.join(',')}`, cacheTags: ['*'],
    queryKey: JSON.stringify([user?.id, periodKey, enabled]), deps: [wanted.join(',')], fallback: [] });
}
