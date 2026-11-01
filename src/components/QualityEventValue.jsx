import { qualityEventValuation, qualityValuationSummary, QUALITY_OWNER_ESTIMATE_RATE, QUALITY_VALUED_TYPES } from '../lib/qualityEventValuation';
import { formatNumber } from '../data/initialData';
const number = value => formatNumber(value);

export default function QualityEventValue({ row, metricKey, compact = false, unavailable = false }) {
  if (!QUALITY_VALUED_TYPES.includes(metricKey)) return null;
  const value = unavailable ? { basis: 'unresolved' } : qualityEventValuation(row, metricKey);
  return <span className={`qv-event-value qv-value-${value.basis}`}>
    {value.basis === 'source' ? <>{value.source === 'booking_invoice' ? 'خصم فاتورة سويتر:' : 'مبلغ سويتر المحفوظ:'} <bdi>{number(value.sourceSignedSAR)}</bdi> ر.س</>
      : value.basis === 'owner_estimate' ? <>تقدير داخلي بقرار هادي: <bdi>{number(value.amountSAR)}</bdi> ر.س</>
        : 'القيمة غير محسومة؛ يلزم التحقق من الدليل.'}
    {!compact && <small>{value.basis === 'owner_estimate'
      ? <>{row.quantity} × {QUALITY_OWNER_ESTIMATE_RATE} ر.س؛ مبلغ المصدر غير محفوظ. ليس خصمًا معتمدًا ولا عمولة.</>
      : 'قيمة المصدر مستقلة عن صافي الفاتورة والتسوية وخصم راتب البايكر.'}</small>}
  </span>;
}

export function QualityValueOverview({ rows, metricKey, total, unavailable }) {
  if (unavailable) return <><strong>غير متاح</strong><small>تعذّرت قراءة المصدر؛ لم نفترض قيمة بديلة.</small></>;
  if (!rows.length) return Number.isSafeInteger(total) && total >= 0
    ? <><strong>{number(total * QUALITY_OWNER_ESTIMATE_RATE)} ر.س</strong><small>تقدير داخلي بقرار هادي · {total} × {QUALITY_OWNER_ESTIMATE_RATE}</small><small>من مؤشر العدد فقط؛ تفاصيل الحالات غير متاحة.</small></>
    : <strong>غير متاح</strong>;
  const value = qualityValuationSummary(rows, metricKey);
  return <>
    {value.sourceRows ? <div className="qv-source-signed-values">
      {value.sourceNegativeSAR < 0 && <span>مبالغ سالبة من المصدر: <strong><bdi>{number(value.sourceNegativeSAR)}</bdi> ر.س</strong></span>}
      {(value.sourcePositiveSAR > 0 || value.sourceNegativeSAR === 0) && <span>مبالغ غير سالبة من المصدر: <strong><bdi>{number(value.sourcePositiveSAR)}</bdi> ر.س</strong></span>}
    </div> : <strong>لا مبلغ مصدر مثبت</strong>}
    <small>مبالغ المصدر: {value.sourceRows} سجل</small>
    {value.estimatedRows > 0 && <small>تقدير داخلي بقرار هادي: {number(value.estimatedSAR)} ر.س · {value.estimatedRows} سجل</small>}
    {value.unresolvedRows > 0 && <small>قيمة غير محسومة: {value.unresolvedRows} سجل</small>}
  </>;
}
