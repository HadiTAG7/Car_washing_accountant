import { isFirebaseConfigured, callPartnerAllocationReport } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';

export function usePartnerStatement({ partnerId, enabled = true } = {}) {
  const result = useFirestoreQuery(async () => {
    const report = await callPartnerAllocationReport({ partnerId });
    if (!Array.isArray(report?.statements)) throw new Error('خادم تقرير المصروفات لم يُحدّث بعد؛ لا يمكن عرض حسبة ناقصة.');
    return report;
  }, { enabled: enabled && isFirebaseConfigured && Boolean(partnerId), preserveResult: true, deps: [partnerId], fallback: null });
  // The shared query hook can complete an older request after an admin changes
  // the simulated partner. Never put A's founding balance under B's name.
  const belongsToPartner = result.data?.partnerId === partnerId;
  return { report: belongsToPartner ? result.data : null,
    loading: result.loading || Boolean(enabled && result.data && !belongsToPartner), error: result.error };
}
