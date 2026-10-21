import { isFirebaseConfigured, callPartnerAllocationReport } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';

const JOURNEY_MISSING = 'تفاصيل رحلة رأس المال غير متاحة من الخادم؛ لا يمكن تأكيد الرصيد.';

/**
 * تقرير الشريك — مرّة واحدة للجلسة لكل التبويبات.
 *
 * التقرير يقرأ في الخادم نحو عشرين مجموعة، وكان كل تبويب (النظرة، الدخل،
 * الاتجاه، رحلة رأس المال) يطلبه من جديد. الآن يُطلب مرّة شاملاً رحلة رأس
 * المال (مجموعتان صغيرتان إضافيتان) ويُخزَّن، فتنتقل بين التبويبات بلا قراءة.
 * أي كتابة أو زر «تحديث البيانات» يسقطه.
 */
export function usePartnerStatement({ partnerId, enabled = true, includeCapitalJourney = false } = {}) {
  const result = useFirestoreQuery(async () => {
    const report = await callPartnerAllocationReport({ partnerId, includeCapitalJourney: true });
    if (!Array.isArray(report?.statements)) throw new Error('خادم تقرير المصروفات لم يُحدّث بعد؛ لا يمكن عرض حسبة ناقصة.');
    return report;
  }, { enabled: enabled && isFirebaseConfigured && Boolean(partnerId), preserveResult: true,
    cacheKey: 'partnerReport', cacheTags: ['*'], queryKey: partnerId || '', fallback: null });
  // The shared query hook can complete an older request after an admin changes
  // the simulated partner. Never put A's founding balance under B's name.
  const belongsToPartner = result.data?.partnerId === partnerId;
  const journeyMissing = includeCapitalJourney && belongsToPartner && result.data?.capitalJourney?.version !== 1;
  return { report: belongsToPartner && !journeyMissing ? result.data : null,
    loading: result.loading || Boolean(enabled && result.data && !belongsToPartner),
    error: result.error || (journeyMissing ? new Error(JOURNEY_MISSING) : null), refetch: result.refetch };
}
