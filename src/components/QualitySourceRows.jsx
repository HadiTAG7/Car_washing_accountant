import { cancellationTime, cancellationSourceLink } from '../lib/sweater/cancellationDetails';
import { bookingInvoiceDeduction } from '../../functions/src/sweater/bookingInvoiceDeduction';
import { reviewStatusLabels, safeReviewUrl } from '../lib/compensationReview';
import { getLanguage } from '../i18n/locale';

const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(getLanguage() === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory', {
  timeZone: 'Asia/Riyadh', numberingSystem: 'latn',
}) : 'غير متاح';
const amountLabels = { customer_code: 'كود أو محفظة العميل', compensation: 'قسم التعويضات',
  invoice_deduction: 'خصم فاتورة الحجز', settlement: 'مبلغ التسوية', late: 'دقائق التأخير' };
const objectionLabels = { Open: 'مفتوح', Processing: 'قيد المعالجة', Accepted: 'مقبول في سويتر', Rejected: 'مرفوض في سويتر' };

export default function QualitySourceRows({ rows, protectLink }) {
  return <div className="qv-events">{rows.map(row => <details key={row.id} className="qv-event qv-source-event">
    <summary><strong>{row.kind === 'ticket' ? 'التكت' : 'الحجز'} <bdi>{row.sourceId}</bdi></strong>
      <span>{row.siteBikerName ? 'اسم الموقع حسب الربط:' : row.sourceBikerName ? 'اسم سويتر:' : 'البايكر:'} {row.bikerLabel} <bdi>{row.driverExternalId || ''}</bdi> · <bdi>{row.date || 'غير متاح'}</bdi></span>
      <span className="qv-preview" translate={row.reason ? 'no' : undefined}>{row.reason || 'السبب غير محفوظ'}</span></summary>
    <p>{row.dateBasis === 'ticket' ? 'تاريخ التكت' : 'تاريخ الخدمة'}: <bdi>{row.date || 'غير محسوم'}</bdi></p>
    <p>اسم الموقع حسب الربط: {row.siteBikerName || 'غير مربوط'}</p>
    <p>اسم سويتر: {row.sourceBikerName || 'غير محفوظ'} · رقم الشركة في سويتر: <bdi>{row.driverExternalId || 'غير متاح'}</bdi></p>
    {row.identityConflict && <p className="qv-warning">ربط البايكر مكرر أو متعارض؛ الاسم المعروض من المصدر ولا يثبت الإسناد.</p>}
    <p className="qv-prose" translate={row.reason ? 'no' : undefined}>{row.reason || 'السبب غير محفوظ'}</p>
    {row.quantity !== null && <p>الكمية المسجلة في هذا المصدر: <bdi>{row.quantity}</bdi></p>}
    <p className="qv-note">{row.kind === 'ticket' || row.timeBasis === 'source_read' ? 'قراءة هذا المصدر:'
      : row.timeBasis === 'record_update' ? 'وقت تحديث السجل المحفوظ:' : 'وقت حفظ ملاحظة المصدر:'} <bdi>{stamp(row.sourceReadAt)}</bdi> (الرياض). مستقلة عن لقطة المجاميع.</p>
    {row.kind === 'booking' && row.timeBasis !== 'source_read' && <p className="qv-note">هذا وقت حفظ أو تحديث السجل، وليس وقت قراءة سويتر أو الإلغاء.</p>}
    {row.kind === 'ticket' ? <TicketFacts row={row} protectLink={protectLink} /> : <BookingFacts row={row} />}
    {row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer">فتح المصدر الأصلي</a>}
  </details>)}</div>;
}

function TicketFacts({ row, protectLink }) {
  const source = row.source, facts = source.facts;
  return <>
    <p>الحجوزات المرتبطة: <bdi>{facts.washIds.join(' · ') || 'غير متاح'}</bdi></p>
    <p>تاريخ الخدمة: <bdi>{facts.serviceDate || 'غير متاح'}</bdi></p>
    <p>إنشاء التكت كما ورد: <bdi>{facts.createdAt || 'غير محفوظ'}</bdi></p>
    <p className="qv-prose">رد الدعم: {facts.supportResponse ? <span translate="no">{facts.supportResponse}</span> : 'غير محفوظ'}</p>
    <details><summary>التعليقات وحدود القراءة</summary>
      {[...facts.comments, ...source.source.coverage.limitations].map((text, i) => <p key={i} className="qv-prose" translate="no">{text}</p>)}
      <p translate="no">{source.source.coverage.filters}</p>
      <p>تغطية المصدر: {source.source.coverage.complete ? 'مكتملة حسب القراءة' : 'جزئية'}</p>
    </details>
    <div className="qv-scroll"><table><caption>مبالغ المصدر مستقلة؛ لا تُجمع كخصم تسوية</caption>
      <thead><tr><th>البند</th><th>القيمة</th><th>الوحدة</th><th>المرجع</th></tr></thead>
      <tbody>{source.amounts.map((a, i) => <tr key={i}><th>{amountLabels[a.kind]}</th><td><bdi>{a.value ?? 'غير متاح'}</bdi></td><td>{a.unit}</td><td translate="no">{a.sourceRef}</td></tr>)}</tbody>
    </table></div>
    {source.attachments?.length > 0 && <details><summary>مرفقات المصدر ({source.attachments.length})</summary>
      {source.attachments.map((a,i) => <article key={`${a.id}:${i}`}><p><bdi>{a.id}</bdi> · {a.kind}</p>
        <p>{({viewed:'مشاهدة مسجلة في المصدر المحفوظ',unavailable:'لم تُشاهد أو تعذر عرضها',missing:'مفقود',duplicate:'مكرر'})[a.observation]}</p>
        <p className="qv-prose" translate="no">{a.note}</p>
        {a.url && safeReviewUrl(a.url) && <a href={a.url} target="_blank" rel="noreferrer">فتح رابط المرفق الأصلي</a>}
      </article>)}
    </details>}
    {source.timeline?.length > 0 && <details><summary>أوقات المصدر كما سُجلت</summary>
      {source.timeline.map((item,i) => <p key={i}>{item.label}: <bdi>{item.value || 'غير محفوظ'}</bdi> · {item.timezone || 'منطقة زمنية غير مثبتة'} · {item.precision}</p>)}
    </details>}
    <h3>اعتراضات سويتر المرتبطة بالتكت</h3>
    {row.review.objectionHistory?.length ? row.review.objectionHistory.map(obj => <p key={obj.id}>
      {cancellationSourceLink(obj.url) ? <a href={cancellationSourceLink(obj.url)} target="_blank" rel="noreferrer"><bdi>{obj.id}</bdi></a> : <bdi>{obj.id}</bdi>}
      {' · '}{objectionLabels[obj.status] || obj.status} · {obj.reply ? <span translate="no">{obj.reply}</span> : 'لا رد محفوظ'} · <bdi>{stamp(obj.checkedAt)}</bdi>
    </p>) : <p>لا اعتراض محفوظ لهذا التكت؛ لا يعني فحص كل اعتراضات سويتر.</p>}
    <p className="qv-note">قبول اعتراض لا يثبت عكس خصم مالي. عرض الأرشيف لا يعيد فتحه أو يرسل اعتراضًا.</p>
    <p>المراجعة الداخلية: {reviewStatusLabels[row.review.reviewStatus] || row.review.reviewStatus}</p>
    <a href={`?page=compensation_review&ticket=${encodeURIComponent(row.sourceId)}`} onClick={protectLink}>فتح سجل التكت القائم</a>
  </>;
}

function BookingFacts({ row }) {
  const time = cancellationTime(row.detail.time, row.detail.timeZone);
  let invoice = null, invoiceError = false;
  try { if (!row.conflict && !row.orderUnknown) invoice = bookingInvoiceDeduction(row.record, row.detail.reason, row.savedAt || row.sourceReadAt); } catch { invoiceError = true; }
  return <>
    <p>حالة سويتر الأصلية: <bdi>{row.conflict ? 'قراءات متعارضة' : row.record.rawStatus}</bdi></p>
    <p>وقت الإلغاء: <bdi>{row.conflict ? 'غير محسوم' : time.text || 'غير محفوظ'}</bdi>{time.text && !time.converted && ' · المنطقة الزمنية غير مثبتة'}</p>
    <p>اسم منفّذ الإلغاء: {row.conflict ? 'غير محسوم' : row.detail.actorName || 'غير محفوظ'}</p>
    <p className="qv-note">الحالة والسبب من المصدر؛ اسم البايكر المسند لا يثبت المسؤولية أو خصمًا من راتبه.</p>
    {row.conflict && <p className="qv-warning">قراءات متعارضة بالتوقيت نفسه؛ لم نحدد نوع الإلغاء.</p>}
    {row.orderUnknown && <p className="qv-warning">وقت قراءة المصدر غير محفوظ؛ لا نرتب الوقائع بوقت الحفظ ولا نحسم نوع الإلغاء أو المبلغ.</p>}
    {row.hasUndatedObservations && !row.orderUnknown && <p className="qv-note">توجد ملاحظات بلا وقت قراءة مثبت؛ المعروض آخر قراءة معروفة، وليس إثبات الحالة الحالية.</p>}
    {invoice && <p>خصم فاتورة الحجز كما ورد: <bdi>{invoice.signedDeductionSAR}</bdi> ر.س · ليس خصم تسوية معتمدًا.</p>}
    {invoiceError && <p className="qv-warning">تعذّر التحقق من دليل مبلغ الفاتورة؛ لم نستخدم مبلغًا بديلًا.</p>}
    {row.conflict ? <details><summary>القراءات المتعارضة للمراجعة</summary>{row.alternatives.map((item,i) => <article key={i}>
      <p><bdi>{stamp(item.sourceAt)}</bdi> · <bdi>{item.record.rawStatus}</bdi></p>
      <p>تاريخ الخدمة: <bdi>{item.record.serviceDate}</bdi></p>
      <p>اسم سويتر: {item.record.driverName || 'غير محفوظ'} · رقم الشركة في سويتر: <bdi>{item.record.driverExternalId || 'غير متاح'}</bdi></p>
      <p className="qv-prose" translate={item.record.notes ? 'no' : undefined}>{item.record.notes || 'السبب غير محفوظ'}</p>
    </article>)}</details> : row.record.notes && <details><summary>نص الملاحظة المحفوظة للمراجعة</summary><p className="qv-prose" translate="no">{row.record.notes}</p></details>}
  </>;
}
