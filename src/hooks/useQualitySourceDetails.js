import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useCompensationReview } from './useCompensationReview';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchRows, where } from '../lib/firestoreCrud';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { cancellationSourceIds } from '../lib/sweater/cancellationDetails';
import { cancellationCandidate } from '../lib/qualitySourceDetails';

export function useQualitySourceDetails(month) {
  const { user } = useAuth(), { role, isPartnerView } = usePartnerView();
  const enabled = isFirebaseConfigured && Boolean(user?.id) && role === 'admin' && !isPartnerView;
  const reviews = useCompensationReview();
  const bookings = useFirestoreQuery(() => fetchRows('sweater_bookings', [where('periodKey', '==', month)]), {
    enabled, cacheKey: `quality-bookings:${month}`, cacheTags: ['sweater_bookings'], queryKey: user?.id, deps: [month], fallback: [],
  });
  const ids = [...new Set((bookings.data || []).filter(cancellationCandidate)
    .flatMap(b => cancellationSourceIds((b.record ?? b).sspBookingId)))].sort();
  const idsKey = JSON.stringify(ids);
  const observations = useFirestoreQuery(async () => {
    if (ids.length > 2000) throw Error('تجاوزت تفاصيل الإلغاء حد القراءة؛ لا نعرض تغطية مكتملة.');
    const chunks = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
    return [...new Map((await Promise.all(chunks.map(chunk => fetchRows('sweater_raw_payloads', [where('sspBookingId', 'in', chunk)]))))
      .flat().map(row => [row.id, row])).values()];
  }, { enabled: enabled && !bookings.loading && !bookings.error, cacheKey: `quality-cancellations:${month}:${idsKey}`,
    cacheTags: ['sweater_raw_payloads'], queryKey: user?.id, deps: [month, idsKey], fallback: [] });
  return { reviews, bookings, observations,
    refresh: () => { reviews.refresh(); bookings.refetch(); observations.refetch(); } };
}
