import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../i18n/useLanguage';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useOverviewBikerQuality } from '../hooks/useOverviewBikerQuality';
import { overviewBikerQuality } from '../lib/overviewBikerQuality';
import { displayBikerName } from '../lib/bikerNames';
import { formatDate, formatNumber } from '../data/initialData';
import BikerQualityMetric from './BikerQualityMetric';
import BikerQualityOriginalValue from './BikerQualityOriginalValue';
import ModalSurface from './ModalSurface';
import { Card, SectionHeader } from './UI';

const labels = { washQuality: ['جودة الغسيل', 'Wash quality'], behavior: ['السلوك', 'Behavior'],
  productivity: ['الإنتاجية', 'Productivity'], complaints: ['الشكاوى', 'Complaints'],
  cancellations: ['الإلغاء', 'Cancellations'], lateness: ['التأخر', 'Lateness'],
  duration: ['مدة الغسلة', 'Wash duration'], statusUpdates: ['عدم تحديث الحالة — مراجعة يدوية', 'Missing status updates — manual review'] };

export default function OverviewBikerQuality(props) {
  const { role, isPartnerView } = usePartnerView();
  // Retain the profile's existing admin-only access; never widen it to an
  // accountant or partner just because their overview has financial cards.
  return role === 'admin' && !isPartnerView ? <AdminQuality {...props} /> : null;
}

function AdminQuality({ workers, periodKey, today, onNavigate }) {
  const { language } = useLanguage();
  const text = (ar, en) => language === 'en' ? en : ar;
  const query = useOverviewBikerQuality(workers.bikers, periodKey, !workers.loading && !workers.error);
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const summary = useMemo(() => overviewBikerQuality(workers.bikers, query.data, periodKey, today), [workers.bikers, query.data, periodKey, today]);
  const ready = query.available && !workers.loading && !workers.error && (!summary.total || summary.read > 0);
  const selected = ready && summary.rows.find(row => row.biker.id === selectedId && !row.failed && row.summary.points !== null);
  const shown = showAll ? summary.rows : summary.rows.filter(row => !row.failed && row.summary.points !== null);
  const status = row => row.failed ? text('تعذّر التحميل', 'Read failed') : row.summary.points === null
    ? row.summary.report?.status === 'outside-period' ? text('خارج فترة التقرير', 'Outside report period') : text('بدون درجة متاحة', 'No available score')
    : row.summary.incomplete ? text('جزئي', 'Partial') : text('مكتمل', 'Complete');
  return <section className="sw-overview__section" aria-labelledby="overview-quality-title">
    <SectionHeader title={<span id="overview-quality-title">{text('الجودة وتقييمات البايكرز', 'Quality and biker assessments')}</span>}
      subtitle={text('نفس التقييم الحالي في البروفايل، بالفترة والوزن المتاحين؛ ليست نجوم العملاء ولا نحول التقييم الجزئي إلى 100.', 'The current profile assessment, with its reporting window and available weight; not customer stars, and partial scores are not rescaled to 100.')}
      action={<button type="button" className="sw-overview__link" onClick={() => onNavigate?.('bikers')}>{text('سجل البايكر', 'Biker registry')}</button>} />
    <div className="sw-overview__metric-grid">{[
      ['تقييمات متاحة', 'Available assessments', summary.available], ['تقييمات مكتملة', 'Complete assessments', summary.complete],
      ['تقييمات جزئية', 'Partial assessments', summary.partial], ['بدون درجة متاحة', 'No available score', summary.missing],
    ].map(([ar, en, value]) => <div className="sw-overview-metric" key={en}>
      <span className="sw-overview-metric__label">{text(ar, en)}</span><strong>{ready ? formatNumber(value) : query.loading || workers.loading ? '…' : text('غير متاح', 'Unavailable')}</strong>
    </div>)}</div>
    {(workers.error || query.error || summary.failed > 0 && query.available) && <p role="alert" className="sw-overview__notice">
      {text('تعذّر تحميل بعض تقييمات البروفايلات؛ لم تُحسب صفرًا أو تقييمًا مفقودًا.', 'Some profile assessments could not be read; they were not counted as zero or missing scores.')}
      <button type="button" className="sw-overview__link" onClick={() => { workers.refetch?.(); query.refetch(); }}>{text('إعادة المحاولة', 'Retry')}</button></p>}
    {query.loading && <p role="status" className="sw-overview__source-note">{text('جارٍ قراءة تقييمات البروفايلات…', 'Reading profile assessments…')}</p>}
    {ready && <Card className="sw-overview__panel sw-overview__daily">
      <SectionHeader title={text('التقييم الحالي لكل بايكر', 'Current assessment by biker')}
        action={<button type="button" className="sw-overview__link" onClick={() => setShowAll(value => !value)}>{showAll ? text('عرض التقييمات المتاحة فقط', 'Show available assessments only') : text('عرض جميع البايكرز', 'Show all bikers')}</button>} />
      <p className="sw-overview__source-note">{text('قرئت بروفايلات', 'Profiles read')}: <bdi dir="ltr">{summary.read} / {summary.total}</bdi> · <bdi dir="ltr">{periodKey}</bdi></p>
      {!shown.length ? <p className="sw-overview__source-note">{text('لا توجد درجات متاحة في بروفايلات هذا الشهر.', 'No available scores in this month’s profiles.')}</p>
        : <ul className="sw-overview-quality__list">{shown.map(row => <li key={row.biker.id}>
          <div><bdi dir="ltr">{row.biker.driverExternalId || '—'}</bdi> · <span translate="no">{displayBikerName(row.biker, language)}</span>
            <small>{status(row)}{row.summary.approximate ? ` · ${text('تقريبي', 'Approximate')}` : ''}</small>
            {row.summary.report && <small>{formatDate(row.summary.report.from)} — {formatDate(row.summary.report.to)}</small>}</div>
          {row.failed || row.summary.points === null ? <span>{status(row)}</span> : <button type="button" className="sw-overview__link"
            aria-label={`${text('عرض تقييم', 'View assessment')}: ${row.biker.driverExternalId || row.biker.id}`} onClick={() => setSelectedId(row.biker.id)}>
            <bdi dir="ltr">{formatNumber(Math.round(row.summary.points * 100) / 100)} / {formatNumber(row.summary.weight)}</bdi></button>}
        </li>)}</ul>}
    </Card>}
    {selected && <ModalSurface onClose={() => setSelectedId(null)}><section className="sw-overview-detail" dir={language === 'en' ? 'ltr' : 'rtl'}>
      <header><h2>{text('تقييم البايكر من البروفايل', 'Biker assessment from profile')}</h2><button type="button" aria-label={text('إغلاق التفاصيل', 'Close details')} onClick={() => setSelectedId(null)}><X size={20} /></button></header>
      <p><bdi dir="ltr">{selected.biker.driverExternalId || '—'}</bdi> · <span translate="no">{displayBikerName(selected.biker, language)}</span> · {status(selected)}</p>
      <p>{formatDate(selected.summary.report.from)} — {formatDate(selected.summary.report.to)} · {text('آخر قراءة للمصدر', 'Source read date')}: {formatDate(selected.summary.report.sourceReadDate)}</p>
      <BikerQualityMetric query={{ available: true, data: selected.data }} bikerUID={selected.biker.id} periodKey={periodKey} today={today} />
      <p>{text('نفس نقاط ووزن البروفايل؛ البنود غير المكتملة لا تتحول إلى صفر.', 'The same profile points and weight; incomplete components are not converted to zero.')}</p>
      <ul>{selected.summary.report.components.map(component => <li key={component.key}>
        <strong>{text(...(labels[component.key] || ['معيار', 'Criterion']))}</strong>
        <BikerQualityOriginalValue report={selected.summary.report} component={component} language={language} manualConfirmed={Boolean(selected.data.manual?.confirmed)} />
        <span>{component.points == null ? text('غير مكتمل', 'Incomplete') : <bdi dir="ltr">{formatNumber(component.points)} / {formatNumber(component.weight)}</bdi>}</span>
      </li>)}</ul>
    </section></ModalSurface>}
  </section>;
}
