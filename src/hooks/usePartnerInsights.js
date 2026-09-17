import { isFirebaseConfigured } from '../lib/firebaseClient';
import { callServer } from '../lib/ledgerTransport';
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
    () => callServer('partnerInsights', { partnerId, months }),
    { enabled: on, fallback: null, preserveResult: true, deps: [partnerId, months] },
  );
  return {
    insights: data ?? null,
    washMonths: data?.months ?? [],
    loading,
    error,
    refetch,
  };
}
