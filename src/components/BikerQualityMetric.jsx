import { useLanguage } from '../i18n/useLanguage';
import { formatDate, formatNumber } from '../data/initialData';
import { bikerQualitySummary } from '../lib/bikerQualitySummary';

export default function BikerQualityMetric({ query, bikerUID, periodKey, today, onShowDetails }) {
  const { language } = useLanguage();
  const text = (ar, en) => language === 'en' ? en : ar;
  const title = text('تقييم الجودة المركّب', 'Composite quality assessment');
  const summary = bikerQualitySummary(query.available ? query.data?.reports : [], bikerUID, periodKey, today, query.available ? query.data?.manual : null);
  const value = summary.points === null ? text('غير متاح', 'Unavailable')
    : summary.weight === 100 && summary.incomplete ? `${formatNumber(Math.round(summary.points * 100) / 100)} ${text('نقطة متاحة', 'available points')}`
    : `${formatNumber(Math.round(summary.points * 100) / 100)} / ${formatNumber(summary.weight)}`;
  return <div role="group" aria-label={title} className="sw-biker-profile__metric sw-biker-quality-card">
    <span>{title}</span>
    <strong><bdi dir={summary.points === null ? 'auto' : 'ltr'}>{query.loading ? text('جارٍ تحميل التقييم…', 'Loading assessment…') : value}</bdi></strong>
    {query.loading ? <small role="status">{text('نقرأ تقارير الجودة المحفوظة', 'Reading saved quality reports')}</small>
      : query.error ? <small role="alert">{text('تعذّر قراءة التقييم', 'Assessment could not be read')}</small>
        : <>
          {summary.incomplete && <small>{text('النهائي غير مكتمل', 'Final assessment incomplete')}</small>}
          {summary.points !== null && <small>{text('النقاط المتاحة فقط · دون إعادة وزن', 'Available points only · not rescaled')}</small>}
          {summary.approximate && <small>{text('يشمل عينات نجوم تقريبية', 'Includes approximate rating samples')}</small>}
          {summary.ratingSamples?.washQuality !== undefined && <small>{text('عينة تقييم الغسيل', 'Wash rating sample')}: {formatNumber(summary.ratingSamples.washQuality)}</small>}
          {summary.ratingSamples?.behavior !== undefined && <small>{text('عينة تقييم السلوك', 'Behavior rating sample')}: {formatNumber(summary.ratingSamples.behavior)}</small>}
          {summary.durationN !== null && <small>{summary.durationTotal === null ? text('عينة المدة', 'Duration sample') : text('المقاس من الغسلات المرتبطة', 'Measured out of linked washes')}: <bdi dir="ltr">{formatNumber(summary.durationN)}{summary.durationTotal !== null ? ` / ${formatNumber(summary.durationTotal)}` : ''}</bdi></small>}
          {summary.report && <small>{formatDate(summary.report.from)} — {formatDate(summary.report.to)}</small>}
        </>}
    {!query.loading && !query.error && summary.report && <button type="button" onClick={onShowDetails} className="sw-biker-quality-card__details">{text('تفاصيل التقييم', 'Assessment details')}</button>}
  </div>;
}
