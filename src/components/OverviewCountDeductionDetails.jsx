import { displayBikerName } from '../lib/bikerNames';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';

/** Source evidence only. No booking/status/amount inferred from aggregate counts. */
export default function OverviewCountDeductionDetails({ item, label, rows = [], bikers = [], sourceTime, sourceUrl, periodKey, language, noSweater }) {
  const text = (ar, en) => language === 'en' ? en : ar;
  const unavailable = text('غير متاح', 'Unavailable');
  const covered = rows.reduce((sum, row) => sum + row.quantity, 0);
  const missing = item.value == null ? null : item.value - covered;
  const name = row => {
    const matches = row.driverExternalId ? bikers.filter(biker => biker.driverExternalId === row.driverExternalId) : [];
    return matches.length === 1 ? displayBikerName(matches[0], language) : text('اسم البايكر غير متاح', 'Biker name unavailable');
  };
  return <details className="sw-overview-count-detail">
    <summary><span>{label}<small>{text('عرض التفاصيل', 'View details')}</small></span>
      <bdi>{item.value == null ? noSweater || unavailable : formatNumber(item.value)}</bdi></summary>
    <div className="sw-overview-count-detail__body">
      <p>{text('الفترة', 'Period')}: <bdi>{periodKey}</bdi></p>
      {sourceTime && <p>{sourceTime}</p>}
      {sourceUrl && <p><a href={sourceUrl} target="_blank" rel="noopener noreferrer">{text('فتح مصدر العدد في سويتر', 'Open Sweater count source')}</a></p>}
      <p>{text('سويتر يصنّف هذا البند ضمن الخصومات بالعدد. العدد وحده لا يثبت مبلغًا أو مسؤولية بايكر.', 'Sweater classifies this as a count-based deduction. The count alone establishes neither an amount nor biker responsibility.')}</p>
      <p>{text('المفصل من العدد', 'Itemized units')}: <bdi>{formatNumber(covered)}</bdi> / <bdi>{item.value == null ? unavailable : formatNumber(item.value)}</bdi>
        {missing > 0 && <> · {text('بلا تفاصيل', 'Without details')}: <bdi>{formatNumber(missing)}</bdi></>}</p>
      {!rows.length ? <p role="status">{item.value === 0
        ? text('العدد في هذه القراءة صفر؛ لا توجد وقائع مفصلة مرفقة.', 'This reading reports zero; no itemized events are attached.')
        : text('ما وصلت تفاصيل مرتبطة بهذه القراءة: البايكر والحجز والسبب والمبلغ غير متاحة. لا نوزع العدد أو نقدر المبلغ.', 'No linked details arrived with this reading: biker, booking, reason and amount are unavailable. Counts are not allocated and amounts are not estimated.')}</p>
        : <>
          {missing > 0 && <p role="status">{text('هذه تفاصيل جزئية فقط؛ الباقي بلا إسناد مثبت من المصدر.', 'These details are partial; the remaining units have no verified source attribution.')}</p>}
          <ol className="sw-overview-count-detail__records" aria-label={`${label} — ${text('وقائع سويتر', 'Sweater events')}`}>
            {rows.map(row => <li key={row.sourceId}>
              <div><strong translate="no">{name(row)}</strong><bdi>{row.driverExternalId ?? unavailable}</bdi></div>
              <p>{text('الحجز', 'Booking')}: <bdi>{row.bookingId ?? unavailable}</bdi> · {text('الواقعة', 'Event')}: <bdi>{row.sourceId}</bdi></p>
              <p>{text('تاريخ الواقعة', 'Event date')}: <bdi>{row.date ?? unavailable}</bdi></p>
              <p>{text('السبب في المصدر', 'Source reason')}: {row.reason ?? unavailable}</p>
              <p>{item.key === 'freeWashCompensation' ? text('عدد الغسلات المجانية', 'Free-wash count') : text('عدد الإلغاءات', 'Cancellation count')}: <bdi>{formatNumber(row.quantity)}</bdi></p>
              <p>{text('المبلغ المبيّن في سويتر', 'Amount shown in Sweater')}: <bdi>{row.amount == null ? unavailable : formatCurrencyPrecise(row.amount)}</bdi></p>
              <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">{text('فتح دليل سويتر', 'Open Sweater evidence')}</a>
            </li>)}
          </ol>
        </>}
      <p>{text('هذه معلومات المصدر فقط؛ لا تثبت اعتمادًا في الدفتر، أو خصم راتب، أو صرف تعويض.', 'This is source information only; it does not establish ledger approval, a payroll deduction or compensation payment.')}</p>
    </div>
  </details>;
}
