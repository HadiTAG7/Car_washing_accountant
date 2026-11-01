import { FINANCE_ROLES } from '../lib/financeReportContract';
import { financeOwnerDecisions, financeReportNotes, financeReportSummary } from '../lib/financeReportPresentation';

export default function FinanceOwnerBrief({ state }) {
  const reports = state.teams.filter(team => !team.error && !team.loading && team.report).map(team => team.report);
  const cfo = reports.find(report => report.sourceRole === 1);
  const notes = reports.flatMap(report => financeReportNotes(report).map(note => ({ ...note, report })))
    .sort((a, b) => Number(b.cash) - Number(a.cash) || Number(b.severity === 'critical') - Number(a.severity === 'critical') || b.amount - a.amount);
  const decisions = reports.flatMap(report => financeOwnerDecisions(report).map(decision => ({ ...decision, report })));
  const source = report => <small>{FINANCE_ROLES[report.sourceRole]} · تقرير <time dateTime={report.cutAtRiyadh}>{report.dateRiyadh}</time></small>;
  return <section className="fm-actions fm-owner-brief" aria-label="خلاصة فريق المالية">
    <h2>خلاصة فريق المالية</h2>
    <p className="fm-scope">من آخر تقرير محفوظ لكل فريق؛ ليست أرقام الشهر الحالي أو تأكيدًا لاستمرار الحالات.</p>
    {state.loading && <p role="status">جارٍ قراءة خلاصة المالية…</p>}
    {state.error && <p role="alert">تعذرت قراءة بعض التقارير؛ قد توجد تنبيهات أو قرارات لم تظهر.</p>}
    {cfo ? <div aria-label="خلاصة آخر تقرير مالي">{source(cfo)}{financeReportSummary(cfo).map((line, i) => <p key={i}>{line}</p>)}</div>
      : !state.loading && <p>لا خلاصة متحققة متاحة للمدير المالي.</p>}
    {notes.length > 0 && <section aria-label="تنبيهات التقارير المحفوظة"><h3>تنبيهات التقارير المحفوظة ({notes.length})</h3>
      <ul>{notes.slice(0, 3).map(note => <li key={`${note.report.reportId}:${note.id}`} className={note.severity === 'critical' ? 'fm-negative' : ''}>
        <p>{note.severity === 'critical' ? 'أولوية مالية: ' : 'تنبيه: '}{note.text}</p>{source(note.report)}
      </li>)}</ul><small>تظهر أهم 3 ملاحظات؛ التفاصيل الكاملة محفوظة لدى فريق المالية.</small>
    </section>}
    <h3>المطلوب منك حسب التقارير</h3>
    <p className="fm-scope">تظهر الطلبات الموسومة بانتظار قرار هادي فقط؛ راجع حالتها مع الفريق قبل القرار.</p>
    {decisions.length > 0 ? <ul>{decisions.map(decision => <li key={`${decision.report.reportId}:${decision.id}`}>
      <p>{decision.text}</p><small>{decision.reason}</small>{source(decision.report)}
    </li>)}</ul> : !state.loading && !state.error && <p>لا قرار مسجل بانتظار هادي في آخر تقارير الفرق.</p>}
  </section>;
}
