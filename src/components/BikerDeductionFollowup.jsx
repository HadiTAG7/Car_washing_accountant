import { useState } from 'react';
import { BIKER_DEDUCTION_AUTHORITY } from '../lib/sweater/bikerDeductions';
import { Card, SectionHeader } from './UI';
const button = 'sw-button sw-button--secondary sw-button--sm';
const amount = row => row.unit === 'count' ? `${row.quantity} إلغاء · المبلغ ${row.amountSAR == null ? 'غير محدد من المصدر' : `${row.amountSAR} ر.س`}` : `${row.amountSAR} ر.س`;

export default function BikerDeductionFollowup({ records = [], preview, save, disabled }) {
  const [json, setJson] = useState(''), [review, setReview] = useState(null), [payload, setPayload] = useState(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirmed, setConfirmed] = useState(false), [requestId, setRequestId] = useState(null);
  return <Card className="qv-panel qv-deductions"><SectionHeader title="خصومات سويتر على البايكر" subtitle="إسناد واقعة موثقة فقط؛ لا يخصم من المسير ولا يرحّل مبلغًا." />
    <p>قرار هادي يشمل الوقائع من 29 أغسطس إلى 28 أكتوبر 2026. إلغاء البايكر بالعدد، والمخالفة بمبلغ المصدر.</p>
    {records.length ? <ul>{records.map(record => <li key={record.id}>{record.bikerName} · {record.event?.bookingId || record.sourceId} · {record.event?.date} · {amount(record)}
      {' · '}{record.matchedToCompensations ? 'مطابق لتفاصيل سويتر' : record.bookingEvidence?.invoice ? 'فاتورة الحجز؛ مطابقة جدول سويتر معلقة' : 'قرار هادي؛ بانتظار مطابقة تفاصيل سويتر'} · النسخة {record.revision}
      <details><summary>دليل الواقعة وسجل التصحيح</summary><pre dir="ltr">{JSON.stringify(record, null, 2)}</pre></details></li>)}</ul> : <p>لا توجد وقائع خصم مسجلة لهذا الشهر.</p>}
    <details><summary>معاينة واقعة موثقة أو تصحيحها</summary>
      <p>مرجع القرار: <bdi>{BIKER_DEDUCTION_AUTHORITY}</bdi>. المعاينة تقرأ المصدر المحفوظ وتكشف التكرار والربط والأقفال.</p>
      <form onSubmit={async e => { e.preventDefault(); setBusy(true); setReview(null); setMessage(''); setConfirmed(false); try {
        const input = JSON.parse(json); const result = await preview(input); setReview(result); setPayload(input); setRequestId(crypto.randomUUID());
      } catch (error) { setMessage(error.message || 'تعذّرت المعاينة.'); } finally { setBusy(false); } }}>
        <label>ملف الواقعة المراجع<textarea aria-label="ملف واقعة الخصم" dir="ltr" value={json} rows={8} onChange={e => { setJson(e.target.value); setReview(null); setPayload(null); setConfirmed(false); }} /></label>
        <button className={button} disabled={disabled || busy}>معاينة فقط</button>
      </form>
      {review && <section aria-label="معاينة خصم البايكر"><h3>{review.proposed.bikerName} · {amount(review.proposed)}</h3>
        <p>{review.proposed.event.date} · {review.proposed.event.bookingId} · {review.proposed.event.reason}</p>
        <p>{review.proposed.matchedToCompensations ? 'المصدر: تفاصيل Compensations المحفوظة' : review.proposed.bookingEvidence?.invoice
          ? 'المصدر: مبلغ الخصم الفعلي في فاتورة الحجز؛ مطابقة جدول Compensations لم تكتمل'
          : 'المصدر: سبب الحجز المحفوظ وتصنيف بقرار هادي؛ المطابقة مع Compensations لم تكتمل'}</p>
        <p role="status">{review.warning}</p>
        {review.canSave && <><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> راجعت العامل ودليل المصدر وسبب الإسناد؛ هذا تسجيل تشغيلي بلا خصم راتب.</label>
          <button className={button} disabled={disabled || busy || !confirmed} onClick={async () => {
            setBusy(true); setMessage(''); try { const result = await save({ payload, reviewedPayloadHash: review.reviewedPayloadHash, previewStateHash: review.previewStateHash, requestId });
              if (!result.record) throw Error('تعذّر التحقق من سجل الحفظ.');
              setReview({ ...review, canSave: false }); setMessage(`تم تسجيل الواقعة · النسخة ${result.record.revision} · لم يُخصم راتب ولم يُنشأ قيد.`);
            } catch (error) { setMessage(error.message || 'تعذّر الحفظ؛ أعد المعاينة.'); } finally { setBusy(false); }
          }}>تسجيل الواقعة المراجعة</button></>}
      </section>}
      <p role="status">{message}</p>
    </details>
  </Card>;
}
