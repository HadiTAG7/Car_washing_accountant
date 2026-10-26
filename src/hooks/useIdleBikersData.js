import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchRows } from '../lib/firestoreCrud';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { idleBikers } from '../lib/idleBikers';

/** Full history is needed for "last wash" even when October has no washes.
 * Shared by the tab and overview; a failed source is never a zero count. */
export function useIdleBikersData(data, { periodKey, today, followupOverrides = null }) {
  const { user } = useAuth();
  const history = useFirestoreQuery(() => fetchRows('washes'), {
    enabled: isFirebaseConfigured && Boolean(user?.id), cacheKey: 'idleWashHistory', cacheTags: ['washes'], queryKey: user?.id || null, fallback: [],
  });
  const payroll = data.payroll?.data?.find(p => p.periodKey === periodKey && !p.unavailable);
  const loading = history.loading || data.finance.loading || data.workers.loading || data.payroll?.loading;
  const error = history.error || data.finance.error || data.workers.error || data.payroll?.error;
  const value = useMemo(() => {
    if (loading || error || !payroll || !data.finance.statement || data.operations?.conflicts?.length) return null;
    return idleBikers({ bikers: data.workers.bikers.map(biker => followupOverrides?.[biker.id] ? { ...biker, idleFollowup: followupOverrides[biker.id] } : biker), washes: history.data || [], payrollLines: payroll.lines,
      statement: data.finance.statement, periodKey, today, historyComplete: true });
  }, [loading, error, payroll, data.finance.statement, data.workers.bikers, data.operations?.conflicts, history.data, periodKey, today, followupOverrides]);
  return { loading, error: error || (value?.error ? new Error('توجد بيانات غير محسومة في حساب الخمول؛ راجع الرواتب وربط الغسلات.') : null),
    value: value?.error ? null : value, estimated: payroll?.estimated === true,
    retry: () => { history.refetch(); data.retry(); } };
}
