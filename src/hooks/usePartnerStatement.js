import { isFirebaseConfigured, callPartnerAllocationReport } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';

export function usePartnerStatement({ partnerId, enabled = true, includeCapitalJourney = false } = {}) {
  const result = useFirestoreQuery(async () => {
    const report = await callPartnerAllocationReport({ partnerId, ...(includeCapitalJourney ? { includeCapitalJourney: true } : {}) });
    if (!Array.isArray(report?.statements)) throw new Error('خادم تقرير المصروفات لم يُحدّث بعد؛ لا يمكن عرض حسبة ناقصة.');
    if (includeCapitalJourney && report?.capitalJourney?.version !== 1) throw new Error('تفاصيل رحلة رأس المال غير متاحة من الخادم؛ لا يمكن تأكيد الرصيد.');
    return report;
  }, { enabled: enabled && isFirebaseConfigured && Boolean(partnerId), preserveResult: true, deps: [partnerId, includeCapitalJourney], fallback: null });
  // The shared query hook can complete an older request after an admin changes
  // the simulated partner. Never put A's founding balance under B's name.
  const belongsToPartner = result.data?.partnerId === partnerId;
  return { report: belongsToPartner ? result.data : null,
    loading: result.loading || Boolean(enabled && result.data && !belongsToPartner), error: result.error, refetch: result.refetch };
}
