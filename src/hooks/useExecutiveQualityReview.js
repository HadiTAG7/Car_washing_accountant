import { useMemo } from 'react';
import { useOverviewBikerQuality } from './useOverviewBikerQuality';
import { publishedQualityReview } from '../lib/executiveQualityReview';

const empty = [];
export function useExecutiveQualityReview(workers, periodKey, today) {
  const bikers = workers?.bikers || empty;
  const enabled = Boolean(workers && !workers.loading && !workers.error);
  // Reuse the profile/overview reader and its admin/partner policy and cache.
  const query = useOverviewBikerQuality(bikers, periodKey, enabled);
  const review = useMemo(() => enabled && query.available
    ? publishedQualityReview(bikers, query.data, periodKey, today) : null,
  [enabled, query.available, query.data, bikers, periodKey, today]);
  const loading = Boolean(workers?.loading || query.loading);
  const error = !loading && (workers?.error || query.error || !review)
    ? 'تعذرت قراءة تقارير الجودة المنشورة؛ لا يمكن تأكيد الحالة الحالية.' : null;
  return { review, loading, error };
}
