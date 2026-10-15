import { useState } from 'react';
import { useLanguage } from '../i18n/useLanguage';
import { callBikerQuality } from '../lib/bikerQualityApi';
import { formatDate, formatNumber } from '../data/initialData';
import BikerQualityEvidence from './BikerQualityEvidence';
import BikerQualitySource from './BikerQualitySource';
import BikerQualityManual from './BikerQualityManual';
import BikerQualityOriginalValue from './BikerQualityOriginalValue';
import { currentManualQualityReport, selectBikerQualityReport } from '../lib/bikerQualitySummary';

const labels = { washQuality: ['جودة الغسيل', 'Wash quality'], behavior: ['السلوك', 'Behavior'],
  productivity: ['الإنتاجية', 'Productivity'], complaints: ['الشكاوى', 'Complaints'],
  cancellations: ['الإلغاء', 'Cancellations'], lateness: ['التأخر', 'Lateness'],
  duration: ['مدة الغسلة', 'Wash duration'], statusUpdates: ['تحديث الحالة', 'Status updates'] };
const relocatedReasons = { washQuality: ['partial-rounded-rating-sample'], behavior: ['partial-rounded-rating-sample'],
  productivity: ['wash-day-productivity'], complaints: ['approved-attributed-rate'] };
const reasons = {
  'partial-sample': ['عينة فقط', 'Sample only'],
  'partial-rounded-rating-sample': ['عينة نجوم مدوّرة · نتيجة تقريبية', 'Rounded rating sample · approximate result'],
  'missing-rating-sample': ['تنقص عينة تقييمات مرتبطة بالعامل والفترة', 'Missing rating sample linked to this worker and period'],
  'missing-work-days': ['ينقص دليل أيام العمل المثبتة', 'Missing verified working-day evidence'],
  'missing-explicit-status-review': ['تنقص مراجعة صريحة لتحديثات الوصول والبدء والإنهاء', 'Missing explicit arrival/start/end status review'],
  'verified-work-days': ['من أيام العمل المثبتة، بما فيها أيام الصفر', 'From verified working days, including zero-service days'],
  'explicit-status-review': ['من مراجعة صريحة؛ الموعد المتأثر يُحسب مرة واحدة', 'Explicit review; each affected appointment counted once'],
  'awaiting-approved-rule': ['الأدلة محفوظة؛ بانتظار اعتماد قاعدة الخصم', 'Evidence saved; awaiting approval of the deduction rule'],
  'awaiting-rule-and-evidence': ['بانتظار قاعدة خصم معتمدة ومقام حالات موثق', 'Awaiting an approved rule and evidenced eligible denominator'],
  'rule-and-evidence-incomplete': ['القاعدة والأدلة غير مكتملة', 'Rule and evidence incomplete'],
  'missing-canonical-wash-source': ['تعذّر تأكيد مجموعة الغسلات المرتبطة بالمعرّف', 'Canonical UID-linked wash cohort is unconfirmed'],
  'wash-day-productivity': ['الغسلات ÷ أيام وجود غسلات فقط؛ ليست أيام دوام', 'Washes ÷ days with washes only; not attendance days'],
  'no-eligible-wash-days': ['لا يوجد مقام أيام غسلات مؤهل للحساب', 'No eligible wash-day denominator'],
  'timestamp-completeness': ['اكتمال الطوابع المقروءة، لا إثبات نسيان', 'Completeness of readable timestamps, not proven forgetting'],
  'missing-readable-ssp-events': ['تنقص قراءة أحداث سويتر الفعلية المؤهلة', 'Missing eligible readable Sweater events'],
  'missing-attributed-denominator': ['ينقص مقام مؤهل وحالات منسوبة بدليل', 'Missing eligible denominator and evidenced attribution'],
  'approved-attributed-rate': ['نسبة مؤهلة ومنسوبة وفق القاعدة المعتمدة', 'Eligible attributed rate under the approved rule'],
  'awaiting-manual-status-review': ['بانتظار المراجعة اليدوية؛ عدم الإدخال ليس مراجعة صفرية', 'Awaiting manual review; no entries do not mean a zero-case review'],
  'manual-status-reviewed': ['من مراجعة يدوية مؤكدة؛ الموعد المتأثر يُحسب مرة واحدة', 'Explicitly confirmed manual review; each affected appointment counts once'],
};

export default function BikerQualitySection({ query, sectionRef, bikerUID, periodKey, today }) {
  const { language } = useLanguage();
  const text = (ar, en) => language === 'en' ? en : ar;
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const current = query.available ? selectBikerQualityReport(query.data.reports, bikerUID, periodKey, today) : null;
  const reports = current ? [current] : [];
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setFeedback(null);
    try {
      const payload = JSON.parse(input);
      const result = await callBikerQuality('save', payload);
      setFeedback({ success: true, message: text(`حُفظ ${result.created} تقريرًا؛ ${result.unchanged} موجودًا دون تغيير.`,
        `Saved ${result.created} reports; ${result.unchanged} already unchanged.`) });
      setInput('');
      await query.refetch();
    } catch (error) { setFeedback({ success: false, message: error.message }); }
    finally { setSaving(false); }
  };
  return <section ref={sectionRef} tabIndex={-1} className="sw-biker-quality" aria-label={text('تقييم الجودة المركّب', 'Composite quality assessment')}>
    {query.loading && <p role="status">{text('جارٍ تحميل تقرير الجودة…', 'Loading quality report…')}</p>}
    {query.error && <><p role="alert">{text('تعذّر قراءة تقرير الجودة؛ لا يمكن تأكيد التقييم.', 'Quality report could not be read; assessment is unconfirmed.')}</p>
      <button type="button" className="sw-button sw-button--secondary" onClick={query.refetch}>{text('إعادة المحاولة', 'Retry')}</button></>}
    {query.available && reports.length === 0 && <p>{text('لا يوجد تقرير جودة محفوظ لهذا الشهر.', 'No quality report is saved for this month.')}</p>}
    {reports.map((saved, index) => {
      const report = index === 0 ? currentManualQualityReport(saved, query.data?.manual) : saved;
      const manual = query.data?.manual;
      const washScope = index === 0 && manual?.sourceAvailable && manual.bikerUID === report.bikerUID
        && manual.from === report.from && manual.to === report.to ? manual.eligible.length : report.coverage?.canonicalCompleted;
      return <details key={report.id} open={index === 0} className="sw-biker-quality__snapshot">
      <summary>{text('التقييم الحالي — سياسة المراجعة اليدوية', 'Current assessment — manual-review policy')}</summary>
      <article className="sw-biker-quality__report">
      <div className="sw-biker-quality__heading"><strong>{report.status === 'complete' && Number.isFinite(report.finalScore)
        ? <>{text('التقييم النهائي', 'Final assessment')}: <bdi dir="ltr">{formatNumber(report.finalScore)} / 100</bdi></>
        : text('التقييم النهائي غير مكتمل', 'Final assessment incomplete')}</strong>
        <span>{formatDate(report.from)} — {formatDate(report.to)}</span></div>
      {report.status === 'outside-period' && <p>{text('العامل خارج فترة التقرير؛ لا توجد درجة.', 'Worker is outside the report period; no score.')}</p>}
      {index === 0 && saved.components.some(c => c.key === 'statusUpdates' && c.points !== null) && <details>
        <summary>{text('نقاط مؤشر التحديث في اللقطة التاريخية فقط', 'Status metric points in the historical snapshot only')}</summary>
        <p>{text('هذه النقاط محفوظة كدليل سابق وليست درجة عدم التحديث اليدوية الحالية.', 'These points remain saved as earlier evidence, not the current manual missing-update score.')}</p>
        <bdi dir="ltr">{formatNumber(saved.components.find(c => c.key === 'statusUpdates').points)} / 10</bdi>
      </details>}
      {report.availableWeight > 0 && <p>{text('مجموع البنود المتاحة', 'Available component total')}: <strong><bdi dir="ltr">{formatNumber(report.availablePoints)}{report.availableWeight === 100 && report.finalScore === null
        ? ` ${text('نقطة متاحة', 'available points')}` : ` / ${formatNumber(report.availableWeight)}`}</bdi></strong></p>}
      {report.rulesVersion === 'cqo-20261014-v1' && <p className="sw-biker-profile__note">{text('نسخة سابقة تحفظ دليل المدة فقط؛ ليست تقييم المعايير الأخرى.', 'Earlier version stores duration evidence only, not the other criteria.')}</p>}
      <div className="sw-biker-quality__metrics"><div><span>{text('الغسلات المقاسة', 'Measured washes')}</span><strong><bdi dir="ltr">{formatNumber(report.duration.n)}{report.coverage?.canonicalCompleted !== null && report.coverage?.canonicalCompleted !== undefined ? ` / ${formatNumber(report.coverage.canonicalCompleted)}` : ''}</bdi></strong></div>
        <div><span>{text('متوسط المدة · دقيقة', 'Average duration · minutes')}</span><strong>{report.duration.averageMinutes === null ? text('غير متاح', 'Unavailable') : formatNumber(report.duration.averageMinutes)}</strong></div>
        <div><span>{text('أكثر من 50 دقيقة في العينة', 'Over 50 minutes in sample')}</span><strong>{report.duration.n ? formatNumber(report.duration.over50) : text('غير متاح', 'Unavailable')}</strong></div></div>
      <div className="sw-biker-quality__table-wrap"><table className="sw-biker-quality__criteria"><caption>{text('تفصيل المعايير والأوزان المعتمدة', 'Approved criteria and weights')}</caption>
        <thead><tr><th>{text('المعيار', 'Criterion')}</th><th>{text('القيمة الأصلية ثم نقاطنا', 'Original value, then our points')}</th><th>{text('العينة', 'Sample')}</th></tr></thead>
        <tbody>{report.components.map(c => <tr key={c.key}><th scope="row">{c.key === 'statusUpdates' ? (index === 0 ? text('عدم تحديث الحالة — مراجعة يدوية', 'Missing status updates — manual review')
          : text('مؤشر التحديث التاريخي — ليس مراجعة يدوية حالية', 'Historical status metric — not a current manual review')) : text(...labels[c.key])}</th>
          <td><BikerQualityOriginalValue report={report} component={c} language={language} current={index === 0} manualConfirmed={Boolean(manual?.confirmed)} />
            <small>{text('نقاطنا / الوزن', 'Our points / weight')}</small>
            {c.points === null ? text('غير مكتمل', 'Incomplete') : <bdi dir="ltr">{formatNumber(c.points)} / {c.weight}</bdi>}
            {!relocatedReasons[c.key]?.includes(c.reason) && <small>{c.key === 'lateness' && c.points === null ? <>{text('بيانات التأخر للفترة غير مكتملة من المصدر؛ النقاط غير محسوبة', 'Source lateness data for this period is incomplete; points are not calculated')}
              {' · '}{formatDate(report.from)} — {formatDate(report.to)} · {text('آخر قراءة صالحة', 'Last valid read')}: {formatDate(report.evidence?.lateness?.source?.readDate || report.sourceReadDate)}</>
              : text(...(reasons[c.reason] || ['الأدلة غير متاحة', 'Evidence unavailable']))}</small>}
            {c.key !== 'complaints' && c.affected !== undefined && c.affected !== null && Number.isInteger(c.n) && c.n > 0 && <small>{c.key === 'statusUpdates' ? (index === 0 ? text('المواعيد ذات ملاحظة يدوية من النطاق المؤكد', 'Appointments with a manual note out of confirmed scope') : text('المواعيد ذات نقص الطوابع من المقام', 'Appointments with missing timestamps out of denominator')) : text('الحالات المنسوبة من المقام', 'Attributed cases out of denominator')}: <bdi dir="ltr">{formatNumber(c.affected)} / {formatNumber(c.n)}</bdi></small>}
            {c.unreadable > 0 && <small>{text('قراءات متعذرة مستبعدة', 'Excluded unreadable reviews')}: {formatNumber(c.unreadable)}</small>}
            {!['statusUpdates', 'productivity', 'complaints'].includes(c.key) && report.coverage?.criteria?.[c.key] === false && c.points !== null && <small>{text('تغطية الدليل جزئية لهذا المعيار', 'Evidence coverage for this criterion is partial')}</small>}</td>
          <td>{['washQuality', 'behavior'].includes(c.key) ? <>
            <small>{text('نطاق المراجعة', 'Review scope')}: {washScope == null ? text('غير متاح', 'Unavailable') : `${formatNumber(washScope)} ${text('غسلة', 'washes')}`}</small>
            <small>{text('تقييمات العملاء الفعلية', 'Actual customer ratings')}: {c.n == null ? text('غير متاح', 'Unavailable') : formatNumber(c.n)}</small>
          </> : c.n === null ? '—' : formatNumber(c.n)}{c.unit === 'work-days' && <small>{text('أيام عمل مثبتة', 'Verified working days')}</small>}
            {c.unit === 'wash-days' && <small>{text('أيام وجود غسلات', 'Days with washes')}</small>}
            {c.unit === 'reviewed-washes' && <small>{text('غسلات مراجعة صراحة', 'Explicitly reviewed washes')}</small>}</td></tr>)}</tbody></table></div>
      <BikerQualityEvidence report={report} language={language} />
      <details><summary tabIndex={0}>{text('طريقة حساب المدة', 'Duration calculation')}</summary>
        <p>{text('تُحسب نقاط كل غسلة أولاً: 10 نقاط، وخصم 0.2 لكل دقيقة فوق 50، بحد أدنى صفر؛ ثم يؤخذ متوسط نقاط الغسلات المقاسة.',
          'Score each wash first: 10 points less 0.2 per minute above 50, with a floor of zero; then average measured wash points.')}</p></details>
      <h4>{text('خطوة التحسين', 'Improvement step')}</h4><p dir="auto" translate="no">{report.improvement}</p>
    </article></details>;
    })}
    <BikerQualityManual manual={query.available ? query.data.manual : null} language={language} onReload={query.refetch} />
    <BikerQualitySource source={query.available ? query.data.source : null} language={language} />
    <details className="sw-biker-quality__publish"><summary tabIndex={0}>{text('حفظ تقارير جودة معتمدة · للأدمن', 'Save approved quality reports · Admin')}</summary>
      <p className="sw-biker-profile__note">{text('يُحفظ التقرير بمعرّف العامل والفترة ونسخة القاعدة. لا يستبدل تقريرًا مختلفًا محفوظًا، ولا يغيّر الرواتب أو نجوم العملاء.',
        'Reports are linked by worker UID, period and rule version. Existing different reports are not overwritten; wages and customer stars are unchanged.')}</p>
      <form onSubmit={save}><label>{text('بيانات التقارير المعتمدة (JSON)', 'Approved reports (JSON)')}
        <textarea value={input} onChange={event => setInput(event.target.value)} maxLength={500000} rows={5} dir="ltr" required disabled={saving} /></label>
        <button type="submit" className="sw-button sw-button--primary" disabled={saving || !input.trim()}>{saving ? text('جارٍ الحفظ…', 'Saving…') : text('حفظ التقارير المعتمدة', 'Save approved reports')}</button>
      </form>{feedback && <p role={feedback.success ? 'status' : 'alert'}>{feedback.message}</p>}
    </details>
  </section>;
}
