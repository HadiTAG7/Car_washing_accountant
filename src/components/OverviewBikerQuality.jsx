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
  const [criterionKey, setCriterionKey] = useState(null);
  const summary = useMemo(() => overviewBikerQuality(workers.bikers, query.data, periodKey, today), [workers.bikers, query.data, periodKey, today]);
  const ready = query.available && !workers.loading && !workers.error && (!summary.total || summary.read > 0);
  const selected = ready && summary.rows.find(row => row.biker.id === selectedId && row.display);
  const criterion = ready && summary.criteria.find(item => item.key === criterionKey);
  const assumedNote = text('عرض من 100 بقرار هادي: المعيار غير المتوفر يأخذ وزنه كاملًا افتراضيًا، وليس درجة مقاسة. تعذّر القراءة لا يأخذ درجة.', 'Overview out of 100 by owner instruction: unavailable components receive full weight by assumption, not measurement. Read failures receive no score.');
  const shown = showAll ? summary.rows : summary.rows.filter(row => !row.failed && row.summary.points !== null);
  const status = row => row.failed ? text('تعذّر التحميل', 'Read failed') : row.invalid ? text('بيانات التقييم غير صالحة', 'Invalid assessment data') : row.summary.points === null
    ? row.summary.report?.status === 'outside-period' ? text('خارج فترة التقرير', 'Outside report period') : text('بدون درجة متاحة', 'No available score')
    : row.summary.incomplete ? text('جزئي', 'Partial') : text('مكتمل', 'Complete');
  return <section className="sw-overview__section" aria-labelledby="overview-quality-title">
    <SectionHeader title={<span id="overview-quality-title">{text('الجودة وتقييمات البايكرز', 'Quality and biker assessments')}</span>}
      subtitle={text('متوسط نقاط البايكرز لكل معيار، من درجات البروفايلات المتاحة؛ كل بايكر مرة واحدة، والناقص لا يُحسب صفرًا.', 'Mean biker points for each criterion from available profile scores; each biker counts once, and missing scores are not zero.')}
      action={<button type="button" className="sw-overview__link" onClick={() => onNavigate?.('bikers')}>{text('سجل البايكر', 'Biker registry')}</button>} />
    <div className="sw-overview__metric-grid">{summary.criteria.map(criterion => {
      const name = criterion.key === 'statusUpdates' ? text('تحديث الحالة', 'Status updates') : text(...labels[criterion.key]);
      return <div className="sw-overview-metric sw-overview-quality__criterion" role="group" aria-label={`${text('متوسط نقاط', 'Average points')}: ${name}`} key={criterion.key}>
        <button type="button" className="sw-overview-quality__opener" disabled={!ready} aria-haspopup="dialog"
          aria-label={`${text('تفاصيل معيار', 'Criterion details')}: ${name}`} onClick={() => { setSelectedId(null); setCriterionKey(criterion.key); }}>
          <span className="sw-overview-metric__label">{name}</span></button>
        <strong>{!ready ? query.loading || workers.loading ? '…' : text('غير متاح', 'Unavailable') : criterion.average === null ? text('غير متاح', 'Unavailable')
          : <bdi dir="ltr">{formatNumber(Math.round(criterion.average * 100) / 100)} / {formatNumber(criterion.weight)}</bdi>}</strong>
        {ready && <small className="sw-overview__source-note">{text('بايكرز مشمولون', 'Bikers included')}: {formatNumber(criterion.count)}{criterion.approximate ? ` · ${text('تقريبي', 'Approximate')}` : ''}</small>}
      </div>;
    })}</div>
    <details className="sw-overview-quality__coverage">
      <summary>{text('تغطية التقييمات', 'Assessment coverage')}</summary>
      <p className="sw-overview__source-note">{text('متوسط نقاط البايكرز، وليس متوسط نجوم العملاء أو تقييمًا نهائيًا من 100. الفترة الفعلية لكل درجة ظاهرة مع البروفايل؛ لا نجمع أوزان المعايير المختلفة.', 'Mean biker points, not mean customer stars or a final score out of 100. Each profile shows its actual reporting window; different criterion weights are not combined.')}</p>
    <div className="sw-overview__metric-grid">{[
      ['تقييمات متاحة', 'Available assessments', summary.available], ['تقييمات مكتملة', 'Complete assessments', summary.complete],
      ['تقييمات جزئية', 'Partial assessments', summary.partial], ['بدون درجة متاحة', 'No available score', summary.missing],
    ].map(([ar, en, value]) => <div className="sw-overview-metric" key={en}>
      <span className="sw-overview-metric__label">{text(ar, en)}</span><strong>{ready ? formatNumber(value) : query.loading || workers.loading ? '…' : text('غير متاح', 'Unavailable')}</strong>
    </div>)}</div>
    </details>
    {(workers.error || query.error || summary.failed > 0 && query.available) && <p role="alert" className="sw-overview__notice">
      {text('تعذّر تحميل بعض تقييمات البروفايلات؛ لم تُحسب صفرًا أو تقييمًا مفقودًا.', 'Some profile assessments could not be read; they were not counted as zero or missing scores.')}
      <button type="button" className="sw-overview__link" onClick={() => { workers.refetch?.(); query.refetch(); }}>{text('إعادة المحاولة', 'Retry')}</button></p>}
    {query.loading && <p role="status" className="sw-overview__source-note">{text('جارٍ قراءة تقييمات البروفايلات…', 'Reading profile assessments…')}</p>}
    {ready && <Card className="sw-overview__panel sw-overview__daily">
      <SectionHeader title={text('التقييم الحالي لكل بايكر', 'Current assessment by biker')}
        action={<button type="button" className="sw-overview__link" onClick={() => setShowAll(value => !value)}>{showAll ? text('عرض التقييمات المتاحة فقط', 'Show available assessments only') : text('عرض جميع البايكرز', 'Show all bikers')}</button>} />
      <p className="sw-overview__source-note">{text('قرئت بروفايلات', 'Profiles read')}: <bdi dir="ltr">{summary.read} / {summary.total}</bdi> · <bdi dir="ltr">{periodKey}</bdi></p>
      <p className="sw-overview__source-note">{assumedNote}</p>
      {!shown.length ? <p className="sw-overview__source-note">{text('لا توجد درجات متاحة في بروفايلات هذا الشهر.', 'No available scores in this month’s profiles.')}</p>
        : <ul className="sw-overview-quality__list">{shown.map(row => <li key={row.biker.id}>
          <div><bdi dir="ltr">{row.biker.driverExternalId || '—'}</bdi> · <span translate="no">{displayBikerName(row.biker, language)}</span>
            <small>{status(row)}{row.summary.approximate ? ` · ${text('تقريبي', 'Approximate')}` : ''}</small>
            {row.summary.report && <small>{formatDate(row.summary.report.from)} — {formatDate(row.summary.report.to)}</small>}</div>
          {!row.display ? <span>{status(row)}</span> : <div><button type="button" className="sw-overview__link"
            aria-label={`${text('عرض تقييم', 'View assessment')}: ${row.biker.driverExternalId || row.biker.id}`} onClick={() => { setCriterionKey(null); setSelectedId(row.biker.id); }}>
            <bdi dir="ltr">{formatNumber(Math.round(row.display.points * 100) / 100)} / 100</bdi></button>
            {row.display.assumedWeight > 0 && <small>{text('منها افتراضي', 'Assumed portion')}: <bdi>{formatNumber(row.display.assumedWeight)}</bdi></small>}</div>}
        </li>)}</ul>}
    </Card>}
    {selected && <ModalSurface onClose={() => setSelectedId(null)}><section className="sw-overview-detail" dir={language === 'en' ? 'ltr' : 'rtl'}>
      <header><h2>{text('تقييم البايكر من البروفايل', 'Biker assessment from profile')}</h2><button type="button" aria-label={text('إغلاق التفاصيل', 'Close details')} onClick={() => setSelectedId(null)}><X size={20} /></button></header>
      <p><bdi dir="ltr">{selected.biker.driverExternalId || '—'}</bdi> · <span translate="no">{displayBikerName(selected.biker, language)}</span> · {status(selected)}</p>
      <p><bdi dir="ltr">{formatNumber(Math.round(selected.display.points * 100) / 100)} / 100</bdi> · {assumedNote}</p>
      {selected.summary.report && <p>{formatDate(selected.summary.report.from)} — {formatDate(selected.summary.report.to)} · {text('آخر قراءة للمصدر', 'Source read date')}: {formatDate(selected.summary.report.sourceReadDate)}</p>}
      <BikerQualityMetric query={{ available: true, data: selected.data }} bikerUID={selected.biker.id} periodKey={periodKey} today={today} />
      <p>{text('درجة البروفايل المقاسة أعلاه لم تتغير؛ التفصيل التالي يوضح الإضافات الافتراضية في النظرة العامة فقط.', 'The measured profile score above is unchanged; the breakdown below explains overview-only assumptions.')}</p>
      <ul>{selected.display.components.map(component => <li key={component.key}>
        <strong>{text(...(labels[component.key] || ['معيار', 'Criterion']))}</strong>
        {component.assumed ? <span>{text('غير متوفر · كامل افتراضيًا', 'Unavailable · full weight assumed')}</span>
          : <BikerQualityOriginalValue report={selected.summary.report} component={component} language={language} manualConfirmed={Boolean(selected.data.manual?.confirmed)} />}
        <span><bdi dir="ltr">{formatNumber(component.points)} / {formatNumber(component.weight)}</bdi></span>
      </li>)}</ul>
    </section></ModalSurface>}
    {criterion && <ModalSurface onClose={() => setCriterionKey(null)}><section className="sw-overview-detail" dir={language === 'en' ? 'ltr' : 'rtl'}>
      <header><h2>{text('تفاصيل معيار', 'Criterion details')}: {text(...labels[criterion.key])}</h2>
        <button type="button" aria-label={text('إغلاق التفاصيل', 'Close details')} onClick={() => setCriterionKey(null)}><X size={20} /></button></header>
      <p><bdi dir="ltr">{periodKey}</bdi> · {text('المتوسط من الدرجات المقاسة فقط، لكل بايكر وزن واحد. القيم الافتراضية لا تدخل هذا المتوسط.', 'The average includes measured scores only, with one vote per biker. Assumed points are excluded.')}</p>
      <p>{assumedNote}</p>
      <ul>{summary.rows.map(row => {
        const component = row.display?.components.find(item => item.key === criterion.key);
        return <li key={row.biker.id}><div><bdi>{row.biker.driverExternalId || '—'}</bdi> · <span translate="no">{displayBikerName(row.biker, language)}</span>
          {row.summary.report && <p>{formatDate(row.summary.report.from)} — {formatDate(row.summary.report.to)}</p>}</div>
          {!component ? <span>{status(row)}</span> : <><span><bdi dir="ltr">{formatNumber(component.points)} / {formatNumber(component.weight)}</bdi>
            {component.assumed ? ` · ${text('غير متوفر · كامل افتراضيًا', 'Unavailable · full weight assumed')}` : ` · ${text('مقاس', 'Measured')}`}</span>
            {!component.assumed && <BikerQualityOriginalValue report={row.summary.report} component={component} language={language} manualConfirmed={Boolean(row.data.manual?.confirmed)} />}</>}
        </li>;
      })}</ul>
    </section></ModalSurface>}
  </section>;
}
