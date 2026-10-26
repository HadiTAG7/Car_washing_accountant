import { financeOwnerDecisions, financeReportHeading, financeReportNotes, financeReportSummary, financeSnapshotRows } from '../lib/financeReportPresentation';
import './ReportFinancialNumbers.css';

const number=value=>new Intl.NumberFormat('ar-SA',{numberingSystem:'latn',minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
const bases={ledger:'دفتري',operational:'تشغيلي',collected:'تحصيل مثبت',estimate:'تقديري',unavailable:'غير متاح'};
export default function FinanceReportOverview({report,previousMetrics,comparisonError}) {
  const rows=financeSnapshotRows(report,previousMetrics), notes=financeReportNotes(report), decisions=financeOwnerDecisions(report);
  const available=rows.filter(r=>r.value!==null).length;
  return <div className="finance-report-overview">
    <header><p className="finance-report-cut">تقرير محفوظ · القطع <time dateTime={report.cutAtRiyadh}>{report.cutAtRiyadh.replace('T',' ').replace('+03:00','')} — الرياض</time></p>
      <h1>{financeReportHeading(report)}</h1>
      <div className="finance-report-summary" aria-label="الخلاصة">{financeReportSummary(report).map((line,i)=><p key={i}>{line}</p>)}</div>
    </header>
    <section aria-label={report.financialSnapshot?"أرقام التقرير المحفوظة":"أرقام التقرير عند القطع"}><h2>أرقام التقرير</h2>
      <p className="finance-report-caption">لقطة بيانات الموقع المحفوظة مع التقرير، وليست أرصدة اليوم أو أرقامًا مستخرجة من النص.</p>
      {report.financialSnapshot&&<p className="finance-report-caption">شهر الأرقام: {report.financialSnapshot.month} · وقت قراءة الأرقام: <time dateTime={report.financialSnapshot.capturedAt}>{report.financialSnapshot.capturedAt.replace('T',' ').replace('+03:00','')}</time> — الرياض. قد يختلف عن وقت قطع النص.</p>}
      {available===0?<p role="note">{report.financialSnapshot?"تعذرت قراءة الأرقام وقت الحفظ":"ما انحفظت أرقام مع هذا التقرير"}</p>:available<6&&<p role="note">{report.financialSnapshot?"تعذرت قراءة بعض الأرقام وقت الحفظ؛ المتوفر ظاهر أدناه.":"ما انحفظت كل الأرقام المطلوبة مع هذا التقرير؛ المتوفر ظاهر أدناه."}</p>}
      <div className="finance-report-table"><table><caption>الأرقام المالية المحفوظة — ريال</caption><thead><tr><th scope="col">البند</th><th scope="col">{report.financialSnapshot?"المبلغ المحفوظ":"عند القطع"}</th><th scope="col">التغيّر عن التقرير السابق</th><th scope="col">الأساس والتاريخ</th></tr></thead>
        <tbody>{rows.map(row=><tr key={row.id}><th scope="row">{row.label}</th><td className={row.value<0?'finance-report-negative':''}><bdi>{row.value===null?(report.financialSnapshot?'تعذرت القراءة وقت الحفظ':'غير محفوظ'):number(row.value)}</bdi></td>
          <td><bdi>{row.delta===null?'غير متاح للمقارنة':`${row.delta>0?'+':''}${number(row.delta)}`}</bdi></td>
          <td>{row.metric?<>{bases[row.metric.basis]} · <time dateTime={row.metric.asOf}>{row.metric.asOf.slice(0,10)}</time>{report.financialSnapshot&&<small>{row.metric.coverage}</small>}</>:'لا لقطة محفوظة'}</td></tr>)}</tbody></table></div>
      {previousMetrics&&<p className="finance-report-caption">المقارنة مع تقرير {previousMetrics.dateRiyadh} لنفس الفريق؛ اختلاف الأساس أو الشهر يمنع مقارنة التدفقات.</p>}
      {comparisonError&&<p role="note">تعذرت قراءة المقارنة؛ لم يُفترض فرق صفر.</p>}
    </section>
    <section aria-label="أهم الملاحظات المالية"><h2>أهم الملاحظات</h2>
      {notes.length?<ul className="finance-report-notes">{notes.slice(0,3).map(note=><li key={note.id} data-severity={note.severity}><strong>{note.severity==='critical'?'أولوية مالية':'تنبيه'}</strong><p>{note.text} {note.needsWording&&<span className="report-wording-warning">تحتاج صياغة</span>}</p></li>)}</ul>:<p>لا ملاحظات مالية إضافية مسجلة؛ هذا ليس إثبات اكتمال المراجعة.</p>}
      {notes.length>3&&<small>تظهر أهم 3 ملاحظات؛ جميع الملاحظات محفوظة في التفاصيل التقنية أدناه.</small>}
    </section>
    <section aria-label="المطلوب من هادي"><h2>المطلوب من هادي</h2>
      {decisions.length?<ul className="finance-report-decisions">{decisions.map(d=><li key={d.id}><p>{d.text}</p><small>{d.reason}</small></li>)}</ul>:<p>لا قرار مسجل بانتظار هادي في هذا التقرير.</p>}
    </section>
  </div>;
}
