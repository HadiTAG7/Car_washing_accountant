import { useExecutiveDailyMetrics } from '../hooks/useExecutiveDailyMetrics';
import { executiveOwnerDecisions, executiveProblems, readableExecutiveText } from '../lib/executiveOwnerSummary';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';
import { riyadhTodayISO } from '../lib/washesYesterday';

const dayLabel = day => new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', numberingSystem: 'latn', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

export function ExecutiveDailySummaryLive({ report, latestReportDate }) {
  const data = useExecutiveDailyMetrics();
  return <ExecutiveDailySummary report={report} data={data} latestReportDate={latestReportDate} />;
}

export default function ExecutiveDailySummary({ report, data, latestReportDate = report?.dateRiyadh }) {
  const today = data?.today || riyadhTodayISO(), periodKey = today.slice(0, 7);
  const overview = data?.overview, statement = overview?.finance.statement;
  const ops = data?.yesterdayOperations || overview?.operations;
  const washReady = overview && !overview.washes.loading && !overview.washes.error && ops && !ops.conflicts.length;
  const washValue = washReady && ops.yesterdayInPeriod ? ops.yesterdayQuantity : null;
  const money = key => statement ? formatCurrencyPrecise(statement[key]) : overview?.finance.loading ? '…' : 'غير متاح';
  const periodLabel = `${dayLabel(`${periodKey}-01`)} — ${dayLabel(today)}`;
  const yesterday = ops?.yesterday;
  const metrics = [
    { label: 'غسلات أمس', value: washValue == null ? overview?.washes.loading ? '…' : 'غير متاح' : formatNumber(washValue), day: yesterday,
      date: yesterday ? dayLabel(yesterday) : 'بتوقيت الرياض', note: ops && !ops.yesterdayInPeriod ? 'أمس خارج شهر النظرة العامة؛ راجع صفحة الغسلات.' : null },
    { label: 'إيراد الشهر حتى اليوم', value: money('netRevenue'), date: periodLabel, day: today },
    { label: 'مصروفات الشهر', value: money('totalCosts'), date: periodLabel, day: today,
      note: statement?.salaryAccrual?.estimated ? 'تشمل رواتب تقديرية حتى اعتماد المسير.' : null },
    { label: 'صافي الربح', value: money('netProfit'), date: periodLabel, day: today,
      note: statement?.salaryAccrual?.estimated ? 'تقديري حتى اعتماد مسير الرواتب.' : null },
  ];
  const problems = executiveProblems(report, data?.cash);
  const decisions = executiveOwnerDecisions(report);
  return <div className="sw-executive-daily">
    {latestReportDate && latestReportDate !== today && <p className="sw-executive-daily__stale" role="note">آخر تقرير: <time dateTime={latestReportDate}>{dayLabel(latestReportDate)}</time> — لم يُحفظ تقرير اليوم؛ سبب عدم صدوره غير مسجل.</p>}
    <section aria-label="خلاصة المشروع الحالية">
      <h2>الخلاصة</h2>
      <div className="sw-executive-daily__metrics">{metrics.map(metric => <section key={metric.label} aria-label={metric.label}>
        <h3>{metric.label}</h3><strong><bdi>{metric.value}</bdi></strong><time dateTime={metric.day}>{metric.date}</time>
        {metric.note && <small>{metric.note}</small>}
      </section>)}</div>
      {overview?.finance.error && <p className="sw-executive-daily__read-error" role="alert">تعذرت قراءة الأرقام المالية؛ لم تُستبدل بأرقام التقرير القديم.</p>}
      {overview && (overview.washes.error || ops?.conflicts.length > 0) && <p role="alert">تعذر تأكيد غسلات أمس؛ راجع بيانات الغسلات.</p>}
    </section>
    <section aria-label="أهم المشاكل" className="sw-executive-daily__problems"><h2>أهم المشاكل</h2>
      {problems.length ? <ul>{problems.map(problem => <li key={problem.id} data-severity={problem.severity}>
        <span className="sw-executive-daily__severity">{problem.severity === 'critical' ? 'عاجل' : problem.severity === 'open' ? 'يحتاج متابعة' : 'تنبيه'}</span>
        <p>{problem.text}{problem.balances?.map(row => <span key={row.code}> {row.name} <bdi>{formatCurrencyPrecise(row.balance)}</bdi>؛</span>)}</p>
        <small>{problem.current ? `الدفتر الحالي · ${dayLabel(today)}` : `بحسب تقرير ${dayLabel(report.dateRiyadh)}`}</small>
      </li>)}</ul> : <p>{data?.cash.loading ? 'جارٍ فحص الأرصدة النقدية…' : 'لا توجد مشاكل إضافية مسجلة في المصادر المقروءة.'}</p>}
    </section>
    <section aria-label="المطلوب مني" className="sw-executive-daily__owner"><h2>المطلوب مني</h2>
      {decisions.length ? <><div className="sw-executive-daily__decisions">{decisions.map(decision => <article key={decision.id}>
        <h3>{decision.question}</h3><p>{decision.reason}</p>
      </article>)}</div><p className="sw-executive-daily__readonly">هذه الطلبات للقراءة فقط؛ تسجيل الموافقة أو الرفض غير متاح من الصفحة.</p></>
        : <p>{report?.ownerAction.requiredAtCut ? 'الطلب المحفوظ لا يتضمن سؤال قرار واضحًا؛ راجع التفاصيل أدناه.' : 'لا يوجد قرار مطلوب منك في التقرير المختار.'}</p>}
      {report && decisions.length > 0 && <small>طلبات محفوظة بتاريخ {dayLabel(report.dateRiyadh)}؛ راجع حالة القرار قبل اعتماده.</small>}
    </section>
    <details className="sw-executive-daily__technical"><summary>التفاصيل التقنية والتقرير المحفوظ</summary>
      {!report ? <p>لم يتوفر تقرير محفوظ؛ الأرقام أعلاه من الموقع مباشرة.</p> : <>
        <h3>{readableExecutiveText(report.title)}</h3><p>{readableExecutiveText(report.summary)}</p>
        <div className="sw-executive__metrics">{report.metrics.map(metric => <section key={metric.id} aria-label={metric.label}>
          <h3>{readableExecutiveText(metric.label)}</h3><strong>{metric.value == null ? 'غير متاح' : formatNumber(metric.value)} <small>{metric.unit}</small></strong>
          <p>{readableExecutiveText(metric.coverage)}</p>{metric.asOfRiyadh && <time dateTime={metric.asOfRiyadh}>{metric.asOfRiyadh}</time>}
        </section>)}</div>
        <h3>القيود وفشل الجولات والأدوات</h3>{report.visibleWarnings.map(warning => <p key={warning.id}>{readableExecutiveText(warning.text)}</p>)}
        <h3>نص طلبات المالك</h3><p>{readableExecutiveText(report.ownerAction.text)}</p>
        {report.decisions.filter(d => d.status === 'awaiting_owner').map(d => <details key={d.caseId}><summary>{readableExecutiveText(d.caseId)}</summary><p>{readableExecutiveText(d.decision)}</p><p>{readableExecutiveText(d.next)}</p></details>)}
        <section className="sw-executive__detail-list" aria-label="تفاصيل الملخص">{report.details.map((detail, i) => <details key={i}><summary>{readableExecutiveText(detail.title)}</summary><p>{readableExecutiveText(detail.text)}</p>{detail.sourceRef && <p>مرجع المصدر: <bdi>{detail.sourceRef}</bdi></p>}</details>)}</section>
        <p>وقت التقرير: <time dateTime={report.cutAtRiyadh}>{report.cutAtRiyadh}</time> · نسخة {report.revision}</p>
      </>}
    </details>
  </div>;
}
