import { isFirebaseConfigured, callPartnerWashInsights } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * حصّة الشريك من الغسلات شهراً بشهر — من الخادم.
 *
 * صفحة الشريك لا تقرأ `washes` من المتصفح: صفُّ الغسلة يحمل اسم العامل، وما
 * لا يُطلب لا يُسرَّب. فالعدّ يقع في `partnerInsights` بـ Admin SDK ويعود
 * رقمان لكل شهر. المدير المحاكي يمرّر `partnerId` والخادم يتحقق من دوره؛
 * الشريك يمرّره أيضاً والخادم يتجاهله ويحلّ ربطه هو.
 */
export function usePartnerInsights({ partnerId, months = 12, enabled = true } = {}) {
  const on = enabled && isFirebaseConfigured && Boolean(partnerId);
  const { data, loading, error, refetch } = useFirestoreQuery(
    () => callPartnerWashInsights({ partnerId, months }),
    { enabled: on, fallback: null, preserveResult: true, deps: [partnerId, months] },
  );
  const ownData = data?.partnerId === partnerId ? data : null;
  return {
    insights: ownData,
    washMonths: ownData?.months ?? [],
    loading,
    error,
    refetch,
  };
}
