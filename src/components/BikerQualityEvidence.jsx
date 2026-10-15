import { formatDate, formatNumber } from '../data/initialData';

export default function BikerQualityEvidence({ report, language }) {
  if (!report.evidence) return null;
  const text = (ar, en) => language === 'en' ? en : ar;
  const e = report.evidence;
  const proofs = [...(e.ratings || []).map(r => r.source), e.productivity?.source,
    ...(e.updates?.reviews || []).map(r => r.source), e.complaints?.source, e.cancellations?.source, e.lateness?.source].filter(Boolean);
  const sources = [...new Map(proofs.map(p => [`${p.hash}:${p.reference}:${p.readDate}`, p])).values()];
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
    <ul>{sources.map(p => <li key={`${p.hash}:${p.reference}:${p.readDate}`}>
      <span dir="auto">{p.reference}</span> · {text('تاريخ قراءة المصدر', 'Source read date')}: {formatDate(p.readDate)}
      <br /><bdi dir="ltr">SHA256: {p.hash}</bdi>
    </li>)}</ul>
  </details>;
}
