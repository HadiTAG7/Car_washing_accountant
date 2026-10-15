import { formatDate, formatNumber } from '../data/initialData';

export default function BikerQualitySource({ source, language }) {
  if (!source) return null;
  const text=(ar,en)=>language==='en'?en:ar;
  return <details className="sw-biker-quality__source"><summary tabIndex={0}>{text('الغسلات المرتبطة بمعرّف العامل · مصدر التحقق', 'Washes linked to worker UID · verification source')}</summary>
    <p className="sw-biker-profile__note">{text('قراءة فقط من السجلات الداخلية المرتبطة بالمعرّف، لا مطابقة بالاسم ولا إثبات اكتمال استيراد سويتر.',
      'Read-only internal UID-linked records, not a name match or proof of complete Sweater imports.')}</p>
    {!source.available ? <p role="status">{text('تعذّر تأكيد مصدر الغسلات؛ ليس صفراً.', 'Wash source could not be confirmed; this is not zero.')}</p> : <>
      <p><bdi dir="ltr" translate="no">UID: {source.bikerUID} · Sweater ID: {source.externalId || '—'}</bdi></p>
      <p className="sw-biker-profile__note">{text('قراءة حالية مستقلة عن لقطات التقييم المحفوظة', 'Current read, separate from saved assessment snapshots')}{source.readAt ? ` · ${new Intl.DateTimeFormat(language==='en'?'en-GB':'ar-SA',{dateStyle:'short',timeStyle:'short',calendar:'gregory',timeZone:'Asia/Riyadh'}).format(new Date(source.readAt))}` : ''}</p>
      <p>{text('الغسلات المكتملة المرتبطة', 'Linked completed washes')}: {formatNumber(source.eligible.length)} · {text('سجلات مستبعدة تحتاج مراجعة', 'Excluded records requiring review')}: {formatNumber(source.excluded.length)}</p>
      <div className="sw-biker-quality__table-wrap"><table><caption>{text('دليل الغسلات للشهر المحدد', 'Wash evidence for the selected month')}</caption>
        <thead><tr><th>{text('معرّف الغسلة', 'Wash ID')}</th><th>{text('تاريخ الخدمة', 'Service date')}</th><th>{text('معرّف موعد سويتر', 'Sweater appointment ID')}</th></tr></thead>
        <tbody>{source.eligible.map(r=><tr key={r.washId}><td><bdi dir="ltr" translate="no">{r.washId}</bdi></td><td>{formatDate(r.serviceDate)}</td><td><bdi dir="ltr" translate="no">{r.sspBookingId || '—'}</bdi></td></tr>)}</tbody>
      </table></div>
    </>}
  </details>;
}
