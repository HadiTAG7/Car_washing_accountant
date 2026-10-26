import { operationsHeading,operationsSummary,operationsNotes,operationsDecisions } from '../lib/operationsReportPresentation';
import { OPERATIONS_NUMBER_ROWS } from '../lib/operationsReportPublication';
import './ReportFinancialNumbers.css';
export default function OperationsReportOverview({report}){
  const snapshot=report.operationsSnapshot,notes=operationsNotes(report),decisions=operationsDecisions(report);
  return <div className="finance-report-overview">
    <header><p className="finance-report-cut">تقرير عمليات محفوظ · {report.archiveMode==='historical_imported'?'أرشيف تاريخي منقول؛ ليس حالة التشغيل الحالية':'لقطة مراجعة تشغيلية'}</p>
      <h1>{operationsHeading(report)}</h1><div className="finance-report-summary" aria-label="الخلاصة">{operationsSummary(report).map((line,i)=><p key={i}>{line}</p>)}</div>
      <p className="finance-report-caption">قطع النص: {report.cutAtRiyadh||'غير موثق بدقة'} · تاريخ الخدمة: {report.serviceDateRiyadh||'غير موثق'}</p>
    </header>
    <section aria-label="أرقام التقرير المحفوظة"><h2>أرقام التقرير</h2>
      <p className="finance-report-caption">من دوال الموقع عند الحفظ، وليست أرقامًا مستخرجة من نص الوكيل. الغسلات حسب السجل المتاح.</p>
      {snapshot?<p className="finance-report-caption">شهر الأرقام: {snapshot.month} · وقت قراءة الأرقام: {snapshot.capturedAt} — الرياض. قد يختلف عن قطع النص.</p>:<p role="note">ما انحفظت أرقام مع هذا التقرير</p>}
      <div className="finance-report-table"><table><caption>الأرقام التشغيلية المحفوظة</caption><thead><tr><th scope="col">البند</th><th scope="col">القيمة المحفوظة</th><th scope="col">المصدر وحدود القراءة</th></tr></thead><tbody>
        {OPERATIONS_NUMBER_ROWS.map(row=>{const metric=snapshot?.metrics.find(m=>m.id===row.id);return <tr key={row.id}><th scope="row">{row.label}</th>
          <td><bdi>{metric?.value==null?(snapshot?'تعذرت القراءة وقت الحفظ':'غير محفوظ'):metric.value.toLocaleString('ar-SA',{numberingSystem:'latn',maximumFractionDigits:2})}</bdi></td>
          <td>{metric?.coverage||'لا لقطة محفوظة'}</td></tr>;})}
      </tbody></table></div>
    </section>
    <section aria-label="أهم ملاحظات العمليات"><h2>أهم الملاحظات</h2>
      {notes.length?<ul className="finance-report-notes">{notes.slice(0,3).map(n=><li key={n.id} data-severity={n.severity==='critical'?'critical':'warning'}>
        <strong>{n.severity==='critical'?'أولوية عالية':'تنبيه'}</strong><p>{n.text} {n.needsWording&&<span className="report-wording-warning">تحتاج صياغة</span>}</p></li>)}</ul>:<p>لا ملاحظات إضافية مسجلة؛ لا يثبت ذلك اكتمال الفحص.</p>}
      {notes.length>3&&<small>تظهر أهم 3 ملاحظات؛ البقية في التفاصيل التقنية.</small>}
    </section>
    <section aria-label="المطلوب من هادي"><h2>المطلوب من هادي</h2>{decisions.length?<ul className="finance-report-decisions">{decisions.map(d=><li key={d.id}><p>{d.text}</p><small>{d.reason}</small></li>)}</ul>:<p>لا قرار مسجل بانتظار هادي في هذا التقرير.</p>}</section>
  </div>;
}
