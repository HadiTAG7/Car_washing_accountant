import { useLanguage } from '../i18n/useLanguage';
import { BIKER_DEDUCTION_FOLLOWUP_POLICY as policy } from '../config/bikerDeductionFollowupPolicy';
import { summarizeBikerDeductions } from '../lib/sweater/bikerDeductionFollowup';
import { formatCurrencyPrecise } from '../data/initialData';
import ScrollableTable from './ScrollableTable';

export default function BikerDeductionSummary({ records, periodKey, loading, readError }) {
  const { language } = useLanguage(), text = (ar, en) => language === 'en' ? en : ar;
  if (loading) return <p role="status">{text('جارٍ قراءة الوقائع المسندة…', 'Loading assigned events…')}</p>;
  if (readError) return <p role="alert">{text('تعذّرت قراءة الوقائع المسندة؛ لا يمكن عرض مجموع موثوق.', 'Assigned events could not be read; a reliable total is unavailable.')}</p>;
  const summary = summarizeBikerDeductions(records, periodKey);
  return <section aria-label={text('مبالغ متابعة الوقائع المسندة', 'Assigned-event follow-up amounts')}>
    <p>{text('مجموع المتابعة للوقائع المسندة فقط', 'Follow-up total for assigned events only')}: <strong><bdi>{formatCurrencyPrecise(summary.totalSAR)}</bdi></strong>
      {' · '}{summary.eventCount} {text('واقعة', 'events')} {periodKey && <bdi>· {periodKey}</bdi>}</p>
    <p>{text('مبالغ المصدر', 'Source amounts')}: <bdi>{formatCurrencyPrecise(summary.sourceSAR)}</bdi>{' · '}
      {text('بقرار هادي للمفقود', 'Owner decision for missing amounts')}: <bdi>{formatCurrencyPrecise(summary.ownerSAR)}</bdi></p>
    <p className="qv-note">{text('المبلغ المفقود لإلغاء مسند للبايكر يُتابع بقيمة', 'A missing amount for an assigned biker cancellation is followed up at')}{' '}
      <bdi>{formatCurrencyPrecise(policy.missingCancellationAmountSAR)}</bdi>{' '}
      {text('لكل إلغاء بقرار هادي. مبلغ المصدر المعلوم، بما فيه الصفر، يبقى كما هو.', 'per cancellation by Hadi’s decision. Known source amounts, including zero, are preserved.')}</p>
    <p className="qv-note">{text('هذه ليست جميع إلغاءات سويتر أو خصم راتب منفذ. لا تُحمّل إلغاءات العميل أو وقائع غير مسندة على البايكر.', 'This is not all Sweater cancellations or an executed payroll deduction. Customer cancellations and unassigned events are not charged to a biker.')}</p>
    {summary.unpricedCount > 0 && <p role="status">{text('المجموع جزئي؛ وقائع متعارضة أو غير محسومة المبلغ', 'Partial total; conflicting or unpriced events')}: {summary.unpricedCount}</p>}
    {summary.duplicateCount > 0 && <p>{text('قراءات مكررة لم تُجمع مرة أخرى', 'Repeated observations not counted again')}: {summary.duplicateCount}</p>}
    {!summary.bikers.length ? <p>{text('لا توجد وقائع مسندة مؤهلة للمتابعة في هذا الشهر.', 'No eligible assigned events for follow-up this month.')}</p>
      : <ScrollableTable className="overflow-x-auto"><table className="qv-followup-table"><thead><tr>
        {[text('البايكر', 'Biker'), text('الوقائع', 'Events'), text('مبلغ المصدر', 'Source amount'), text('بقرار هادي', 'Owner decision'), text('مجموع المتابعة', 'Follow-up total')].map(label => <th key={label}>{label}</th>)}
      </tr></thead><tbody>{summary.bikers.map(group => <tr key={group.bikerId}>
        <th scope="row">{group.bikerName}</th><td>{group.events.length}</td><td><bdi>{formatCurrencyPrecise(group.sourceSAR)}</bdi></td>
        <td><bdi>{formatCurrencyPrecise(group.ownerSAR)}</bdi></td><td><bdi>{formatCurrencyPrecise(group.totalSAR)}</bdi>{group.unpricedCount > 0 && ` · ${text('جزئي', 'Partial')}`}</td>
      </tr>)}</tbody></table></ScrollableTable>}
    {summary.bikers.map(group => <details key={group.bikerId}><summary>{group.bikerName} · {text('تفاصيل الوقائع المسندة', 'Assigned-event details')} ({group.events.length})</summary>
      <ul>{group.events.map(record => <li key={record.id || record.eventIdentity}>
        <p><bdi>{record.event.bookingId || record.sourceId}</bdi> · <bdi>{record.event.date}</bdi> · {record.event.reason}</p>
        <p>{text('مبلغ المصدر', 'Source amount')}: {record.followup.sourceAmountSAR == null ? text('غير محدد من المصدر', 'Not specified by source') : <bdi>{formatCurrencyPrecise(record.followup.sourceAmountSAR)}</bdi>}</p>
        <p>{text('مبلغ المتابعة', 'Follow-up amount')}: {record.followup.effectiveAmountSAR == null ? text('غير متاح', 'Unavailable') : <bdi>{formatCurrencyPrecise(record.followup.effectiveAmountSAR)}</bdi>}
          {' · '}{record.followup.basis === 'owner_decision' ? text('بقرار هادي، وليس مبلغًا فعليًا من سويتر', 'By Hadi’s decision, not an actual Sweater amount') : record.followup.basis === 'source' ? text('من مبلغ المصدر المحفوظ', 'From the saved source amount') : text('تحتاج مراجعة', 'Needs review')}</p>
        <p>{record.matchedToCompensations ? text('مطابق لتفاصيل سويتر', 'Matched to Sweater details') : text('مطابقة تفاصيل سويتر معلقة', 'Sweater detail reconciliation pending')}</p>
        <details><summary>{text('دليل الواقعة وسجل التصحيح', 'Event evidence and revision history')}</summary><pre dir="ltr">{JSON.stringify(records.find(row => row.id === record.id) || record, null, 2)}</pre></details>
      </li>)}</ul></details>)}
    {summary.conflicts.length > 0 && <details><summary>{text('السجلات المتعارضة المحفوظة', 'Conflicting saved records')}</summary>
      <pre dir="ltr">{JSON.stringify(summary.conflicts.flatMap(conflict => conflict.records.map(record => records.find(row => row.id === record.id))), null, 2)}</pre>
    </details>}
  </section>;
}
