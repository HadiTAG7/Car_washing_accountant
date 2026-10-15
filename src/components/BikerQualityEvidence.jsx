import { formatDate, formatNumber } from '../data/initialData';

export default function BikerQualityEvidence({ report, language }) {
  if (!report.evidence) return null;
  const text = (ar, en) => language === 'en' ? en : ar;
  const e = report.evidence;
  const proofs = [...(e.ratings || []).map(r => r.source), e.productivity?.source,
    ...(e.updates?.reviews || []).map(r => r.source), e.complaints?.source, e.cancellations?.source, e.lateness?.source].filter(Boolean);
  const sources = [...new Map(proofs.map(p => [`${p.hash}:${p.reference}:${p.readDate}`, p])).values()];
  const eventTime = value => value ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA', {
    dateStyle: 'short', timeStyle: 'short', calendar: 'gregory', timeZone: 'Asia/Riyadh',
  }).format(new Date(value)) : text('غير مسجّل', 'Not recorded');
  return <details><summary tabIndex={0}>{text('تفاصيل مصدر التقييم', 'Assessment source details')}</summary>
    <p className="sw-biker-profile__note">{text('عينات مؤرخة، لا تغطية كاملة للشهر ولا تعديل لنجوم المصدر. المتوسطات المدورة تعطي نتائج تقريبية.',
      'Dated samples, not full-month coverage or changes to source stars. Rounded source means produce approximate results.')}</p>
    {report.sourceIdentity?.externalId && <p><bdi dir="ltr">Sweater ID: {report.sourceIdentity.externalId} · SSP ID: {report.sourceIdentity.sspId || '—'}</bdi></p>}
    {e.ratings?.length > 0 && <div className="sw-biker-quality__table-wrap"><table>
      <caption>{text('مقاطع عينات النجوم غير المتداخلة', 'Non-overlapping rating sample segments')}</caption>
      <thead><tr><th>{text('الفترة', 'Period')}</th><th>{text('الغسيل · المتوسط والعينة', 'Wash · mean and sample')}</th><th>{text('السلوك · المتوسط والعينة', 'Behavior · mean and sample')}</th></tr></thead>
      <tbody>{e.ratings.map((r, i) => <tr key={`${r.from}:${r.to}:${i}`}>
        <td>{formatDate(r.from)} — {formatDate(r.to)}</td>
        {[r.wash, r.behavior].map((v, index) => <td key={index}>{v.n ? <bdi dir="ltr">{formatNumber(v.mean)} / 5 · n={formatNumber(v.n)}</bdi> : text('غير متاح', 'Unavailable')}</td>)}
      </tr>)}</tbody>
    </table></div>}
    {e.updates?.reviews?.some(r=>r.readStatus) && <details><summary tabIndex={0}>{text('مراجعات اكتمال الطوابع', 'Timestamp completeness reviews')}</summary>
      <p>{text('دليل تاريخي من المصدر، وليس ملاحظات عدم تحديث يدوية أو نقاطها الحالية.', 'Historical source evidence, not manual missing-update notes or their current points.')}</p>
      <div className="sw-biker-quality__table-wrap"><table><thead><tr><th>{text('معرّف موعد سويتر', 'Sweater appointment ID')}</th><th>{text('الوصول', 'Arrival')}</th><th>{text('بدء الغسيل', 'Wash start')}</th><th>{text('انتهاء الغسيل', 'Wash end')}</th></tr></thead>
        <tbody>{e.updates.reviews.map(r=><tr key={r.washId}><td><bdi dir="ltr" translate="no">{r.appointmentId}</bdi></td>
          {r.readStatus === 'unreadable' ? <td colSpan={3}>{text('تعذّرت قراءة المصدر', 'Source could not be read')}: <span dir="auto">{r.reason}</span></td>
            : [r.arrival,r.start,r.end].map((v,index)=><td key={index}>{eventTime(v)}</td>)}
        </tr>)}</tbody></table></div>
    </details>}
    {e.gaps?.length > 0 && <><h4>{text('فجوات مصدر معلنة', 'Explicit source gaps')}</h4><ul>{e.gaps.map(g=><li key={g.washId}><bdi dir="ltr" translate="no">{g.washId}</bdi> — <span dir="auto">{g.reason}</span></li>)}</ul></>}
    <ul>{sources.map(p => <li key={`${p.hash}:${p.reference}:${p.readDate}`}>
      <span dir="auto">{p.reference}</span> · {text('تاريخ قراءة المصدر', 'Source read date')}: {formatDate(p.readDate)}
      <br /><bdi dir="ltr">SHA256: {p.hash}</bdi>
    </li>)}</ul>
  </details>;
}
