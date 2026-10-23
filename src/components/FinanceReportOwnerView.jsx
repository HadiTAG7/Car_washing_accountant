import { FINANCE_ROLES, FINANCE_STATES } from '../lib/financeReportContract';
import { financeDateLabel, financeMoney, financeOwnerView, financeReportUrl, readableFinanceText } from '../lib/financeReportPresentation';
import './FinanceReportOwnerView.css';

const stamp = value => new Date(value).toLocaleString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh', numberingSystem: 'latn', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' });

export function FinanceSavedNumbers({ report, previousReport, view = financeOwnerView(report, previousReport) }) {
  return <section className="fr-numbers" aria-label="الأرقام المالية المحفوظة"><h3>الأرقام عند قطع التقرير</h3>
    {!view.savedCount ? <p className="fr-missing">ما انحفظت أرقام مع هذا التقرير</p>
      : view.savedCount < 6 && <p className="fr-missing">انحفظت أرقام لبعض البنود فقط؛ الباقي غير متاح في هذه اللقطة.</p>}
    <div className="fr-table-scroll"><table><thead><tr><th scope="col">البند</th><th scope="col">الرقم بالريال</th><th scope="col">التغيّر عن السابق</th><th scope="col">تاريخ الرقم وأساسه</th></tr></thead><tbody>
      {view.numbers.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td className={row.value < 0 ? 'fr-negative' : undefined}><bdi>{row.value === null ? row.asOf ? 'غير متاح وقت التقرير' : 'ما انحفظ رقم' : financeMoney(row.value)}</bdi></td>
        <td><bdi>{row.change === null ? 'غير قابل للمقارنة' : `${row.change > 0 ? '+' : ''}${financeMoney(row.change)}`}</bdi></td>
        <td>{row.asOf ? <><time dateTime={row.asOf}>{stamp(row.asOf)}</time><small>{row.basis === 'ledger' ? 'دفتري تراكمي' : row.id === 'monthly-vat-net' ? 'صافي ضريبة الشهر' : 'تشغيلي للشهر'} · {report.dateRiyadh.slice(0, 7)}</small></> : 'غير محفوظ'}</td>
      </tr>)}
    </tbody></table></div>
    <p className="fr-table-note">الأرقام من الحقول المحفوظة، لا من النص أو أرصدة اليوم. البنك والصندوق دفتريان، وليسا كشفًا أو جردًا.</p>
    {previousReport ? <small>المقارنة مع تقرير {financeDateLabel(previousReport.dateRiyadh)}، النسخة {previousReport.revision}. لا نقارن أساسين مختلفين أو شهرين تشغيليين.</small>
      : <small>لا يوجد تقرير سابق من نفس الفريق ونوع الفترة للمقارنة.</small>}
  </section>;
}

export function FinanceReportDigest({ report, previousReport, link = true }) {
  const view = financeOwnerView(report, previousReport);
  if (!view) return <p className="fr-missing">ما فيه تقرير مالي محفوظ ضمن وقت القطع.</p>;
  return <section className="fr-report-digest" aria-label="خلاصة تقرير المالية"><header>
    <p className="fr-kicker">{FINANCE_ROLES[report.sourceRole]} · لقطة محفوظة</p>
    <h2>{financeDateLabel(report.dateRiyadh)}: {view.headline}</h2>
    <p className="fr-cut">القطع: <time dateTime={report.cutAtRiyadh}>{stamp(report.cutAtRiyadh)}</time> — الرياض</p>
    <div className="fr-summary" aria-label="الخلاصة المالية">{view.summary.map((text, index) => <p key={index}>{text}</p>)}</div>
  </header><FinanceSavedNumbers report={report} previousReport={previousReport} view={view} />
    {link && <a className="fr-full-link" href={financeReportUrl(report)}>فتح التقرير المالي الكامل</a>}
  </section>;
}

export default function FinanceReportOwnerView({ report, previousReport, currentRevision = report.revision, history = [], historyLimited, onRevision }) {
  const view = financeOwnerView(report, previousReport);
  return <article className="fr-report" dir="rtl" translate="no"><FinanceReportDigest report={report} previousReport={previousReport} link={false} />
    {report.revision < currentRevision && <div className="fr-old-version" role="note"><p>نسخة تاريخية معروضة. أحدث نسخة محفوظة: {currentRevision} — لا تعتبر هذه آخر نتيجة.</p>
      <button type="button" onClick={() => onRevision?.(undefined)}>عرض أحدث نسخة</button></div>}
    <section className="fr-notes" aria-label="الملاحظات المالية"><h3>أهم الملاحظات</h3>
      {view.notes.length ? <ol>{view.notes.map(note => <li key={note.id} className={note.critical ? 'fr-note--critical' : 'fr-note--warning'}>
        <strong>{note.critical ? 'أولوية عالية' : 'يحتاج متابعة'}</strong><p>{note.text}</p></li>)}</ol> : <p>لا توجد ملاحظات مالية واضحة مسجلة؛ هذا لا يثبت اكتمال المراجعة.</p>}
      {report.visibleWarnings.length > view.notes.length && <small>بقية الملاحظات وسياقها محفوظة في التفاصيل أدناه.</small>}
    </section>
    <section className="fr-decisions" aria-label="المطلوب من هادي"><h3>المطلوب من هادي</h3>
      {view.decisions.length ? <ul>{view.decisions.map(item => <li key={item.id}>{item.text}</li>)}</ul> : <p>لا يوجد قرار مطلوب من هادي مسجل في هذا التقرير.</p>}
      <small>عرض للطلبات المحفوظة فقط؛ لا يسجل موافقة أو رفضًا.</small>
    </section>
    <details className="fr-technical"><summary>التفاصيل التقنية والتقرير الأصلي</summary><div className="fr-technical-body">
      <h3>المحتوى الأصلي — مع تحسين المسافات للقراءة فقط</h3><h4>{readableFinanceText(report.title)}</h4><p>{readableFinanceText(report.summary)}</p>
      <p>{readableFinanceText(report.historicalIntegrity)}</p><p>معرف التقرير: <bdi>{report.reportId}</bdi></p><p>الفترة: {report.period.from} — {report.period.to}</p>
      <p>النسخة المعروضة: {report.revision} · المراجعة {stamp(report.review.at)} · <bdi>{report.review.sourceRef}</bdi></p>
      {onRevision && <label>نسخة محفوظة<select aria-label="نسخة التقرير" value={report.revision} onChange={event => onRevision(Number(event.target.value))}>
        {!history.some(item => item.revision === report.revision) && <option value={report.revision}>{report.revision}</option>}
        {history.map(item => <option key={item.revision} value={item.revision}>{item.revision} — {readableFinanceText(item.reason)}</option>)}
      </select></label>}
      {historyLimited && <p>تعرض القائمة آخر 30 نسخة؛ تبقى الأقدم محفوظة ويمكن قراءتها برقم النسخة.</p>}
      <h3>كل المؤشرات الأصلية</h3>{report.metrics.map(item => <p key={item.id}>{readableFinanceText(item.label)}: {item.value === null ? 'غير متاح' : financeMoney(item.value)} {item.unit} — {readableFinanceText(item.coverage)} · {stamp(item.asOf)}</p>)}
      <h3>كل الملاحظات وحدودها</h3>{report.visibleWarnings.map(item => <p key={item.id}><bdi>{item.id}</bdi> — {readableFinanceText(item.text)}</p>)}
      <h3>الحالات والمتابعة</h3>{report.cases.map(item => <details key={item.caseId}><summary>{readableFinanceText(item.title)} — {FINANCE_STATES[item.status]}</summary>
        <p>المعرف: <bdi>{item.caseId}</bdi> · المسؤول: الدور {item.ownerRole}</p><p>{readableFinanceText(item.evidence)}</p><p>الخطوة التالية: {readableFinanceText(item.next)}</p>
        {item.lastVerifiedAt && <p>آخر تحقق: {stamp(item.lastVerifiedAt)}</p>}
        {item.verification && <p>التحقق: {item.verification.kind === 'self' ? 'ذاتي موثق — ليس مستقلًا' : item.verification.kind === 'owner' ? 'قرار المالك' : 'مستقل'} · {stamp(item.verification.at)} · <bdi>{item.verification.sourceRef}</bdi></p>}
      </details>)}
      <h3>المصادر وحدود التغطية</h3>{report.sources.map(item => <details key={item.id}><summary>{readableFinanceText(item.label)}</summary><p>{readableFinanceText(item.coverage)}</p><p><bdi>{item.sourceRef}</bdi> · {stamp(item.checkedAt)}</p></details>)}
      {report.sections.map(section => <details key={section.id}><summary>{readableFinanceText(section.title)}</summary><p>{readableFinanceText(section.text)}</p>
        {section.rows && <div className="fr-table-scroll"><table><thead><tr>{section.columns.map((label, index) => <th key={index}>{readableFinanceText(label)}</th>)}</tr></thead><tbody>{section.rows.map((row, index) => <tr key={index}>{row.map((value, col) => <td key={col}>{value === null ? 'غير متاح' : typeof value === 'string' ? readableFinanceText(value) : value}</td>)}</tr>)}</tbody></table></div>}
      </details>)}
    </div></details>
  </article>;
}
