import { useState } from 'react';
import { useLanguage } from '../i18n/useLanguage';
import { callBikerQuality } from '../lib/bikerQualityApi';
import { formatDate, formatNumber } from '../data/initialData';

const labels = { washQuality: ['جودة الغسيل', 'Wash quality'], behavior: ['السلوك', 'Behavior'],
  productivity: ['الإنتاجية', 'Productivity'], complaints: ['الشكاوى', 'Complaints'],
  cancellations: ['الإلغاء', 'Cancellations'], lateness: ['التأخر', 'Lateness'],
  duration: ['مدة الغسلة', 'Wash duration'], statusUpdates: ['تحديث الحالة', 'Status updates'] };

export default function BikerQualitySection({ query, sectionRef }) {
  const { language } = useLanguage();
  const text = (ar, en) => language === 'en' ? en : ar;
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const reports = query.available ? query.data.reports : [];
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
  return <section ref={sectionRef} tabIndex={-1} className="sw-biker-quality">
    <h3>{text('تقييم الجودة المركّب', 'Composite quality assessment')}</h3>
    <p className="sw-biker-profile__note">{text('تقييم مستقل من 100، وليس نجوم العملاء من 5. لا تُرفع نقاط العينة إلى 100 ولا تُستنتج أيام الدوام من أيام الغسلات.',
      'Separate assessment out of 100, not customer stars out of 5. Partial points are not rescaled to 100; wash days do not prove attendance.')}</p>
    {query.loading && <p role="status">{text('جارٍ تحميل تقرير الجودة…', 'Loading quality report…')}</p>}
    {query.error && <><p role="alert">{text('تعذّر قراءة تقرير الجودة؛ لا يمكن تأكيد التقييم.', 'Quality report could not be read; assessment is unconfirmed.')}</p>
      <button type="button" className="sw-button sw-button--secondary" onClick={query.refetch}>{text('إعادة المحاولة', 'Retry')}</button></>}
    {query.available && reports.length === 0 && <p>{text('لا يوجد تقرير جودة محفوظ لهذا الشهر.', 'No quality report is saved for this month.')}</p>}
    {reports.map(report => <article key={report.id} className="sw-biker-quality__report">
      <div className="sw-biker-quality__heading"><strong>{text('التقييم النهائي غير مكتمل', 'Final assessment incomplete')}</strong>
        <span>{formatDate(report.from)} — {formatDate(report.to)}</span></div>
      {report.status === 'outside-period' && <p>{text('العامل خارج فترة التقرير؛ لا توجد درجة.', 'Worker is outside the report period; no score.')}</p>}
      <p className="sw-biker-profile__note">{text('نسخة القاعدة', 'Rule version')}: <bdi>{report.rulesVersion}</bdi> · {text('تاريخ قراءة المصدر', 'Source read date')}: {formatDate(report.sourceReadDate)}</p>
      <div className="sw-biker-quality__metrics"><div><span>{text('الغسلات المقاسة', 'Measured washes')}</span><strong>{formatNumber(report.duration.n)}</strong></div>
        <div><span>{text('متوسط المدة · دقيقة', 'Average duration · minutes')}</span><strong>{report.duration.averageMinutes === null ? text('غير متاح', 'Unavailable') : formatNumber(report.duration.averageMinutes)}</strong></div>
        <div><span>{text('أكثر من 50 دقيقة في العينة', 'Over 50 minutes in sample')}</span><strong>{report.duration.n ? formatNumber(report.duration.over50) : text('غير متاح', 'Unavailable')}</strong></div></div>
      <p className="sw-biker-profile__note">{text('تغطية جزئية: المدة تخص الغسلات المقاسة فقط، ولا تثبت تغطية جميع غسلات الفترة أو الشهر.',
        'Partial coverage: duration includes measured washes only, not all washes in the period or month.')}</p>
      <div className="sw-biker-quality__table-wrap"><table><caption>{text('تفصيل المعايير والأوزان المعتمدة', 'Approved criteria and weights')}</caption>
        <thead><tr><th>{text('المعيار', 'Criterion')}</th><th>{text('الوزن', 'Weight')}</th><th>{text('النقاط المتاحة', 'Available points')}</th><th>{text('العينة', 'Sample')}</th></tr></thead>
        <tbody>{report.components.map(c => <tr key={c.key}><th>{text(...labels[c.key])}</th><td><bdi>{c.weight}</bdi></td>
          <td>{c.points === null ? text('غير مكتمل', 'Incomplete') : <bdi dir="ltr">{formatNumber(c.points)} / {c.weight}</bdi>}
            <small>{c.reason === 'partial-sample' ? text('عينة فقط', 'Sample only') : c.reason === 'rule-and-evidence-incomplete'
              ? text('القاعدة والأدلة غير مكتملة', 'Rule and evidence incomplete') : text('الأدلة غير متاحة', 'Evidence unavailable')}</small></td>
          <td>{c.n === null ? '—' : formatNumber(c.n)}</td></tr>)}</tbody></table></div>
      <details><summary tabIndex={0}>{text('طريقة حساب المدة', 'Duration calculation')}</summary>
        <p>{text('تُحسب نقاط كل غسلة أولاً: 10 نقاط، وخصم 0.2 لكل دقيقة فوق 50، بحد أدنى صفر؛ ثم يؤخذ متوسط نقاط الغسلات المقاسة.',
          'Score each wash first: 10 points less 0.2 per minute above 50, with a floor of zero; then average measured wash points.')}</p></details>
      <h4>{text('خطوة التحسين', 'Improvement step')}</h4><p dir="auto" translate="no">{report.improvement}</p>
    </article>)}
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
