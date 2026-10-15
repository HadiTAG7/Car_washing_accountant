import { useLanguage } from '../i18n/useLanguage';
import { formatNumber } from '../data/initialData';
import { bikerQualitySummary } from '../lib/bikerQualitySummary';

export default function BikerQualityMetric({ query, bikerUID, periodKey, today }) {
  const { language } = useLanguage();
  const text = (ar, en) => language === 'en' ? en : ar;
  const title = text('تقييم الجودة المركّب', 'Composite quality assessment');
  const summary = bikerQualitySummary(query.available ? query.data?.reports : [], bikerUID, periodKey, today, query.available ? query.data?.manual : null);
  const unavailable = query.loading || query.error || !query.available || summary.points === null;
  const value = unavailable ? '—'
    : `${formatNumber(Math.round(summary.points * 100) / 100)} / ${formatNumber(summary.weight)}`;
  return <div role="group" aria-label={title} aria-busy={query.loading || undefined} className="sw-biker-profile__metric sw-biker-quality-card">
    <span>{title}</span>
    <strong><bdi dir={unavailable ? 'auto' : 'ltr'}>{value}</bdi></strong>
  </div>;
}
