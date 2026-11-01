import { useExecutiveDailyMetrics } from '../hooks/useExecutiveDailyMetrics';
import { executiveOwnerDecisions, executiveProblems, readableExecutiveText } from '../lib/executiveOwnerSummary';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';
import { riyadhTodayISO } from '../lib/washesYesterday';
import { useLatestOperationsReview } from '../hooks/useLatestOperationsReview';
import { OPERATIONS_STATUSES } from '../lib/operationsReportContract';
import ReportFinancialNumbers from './ReportFinancialNumbers';
import { needsReportWording } from '../lib/reportPublication';
import { useExecutiveQualityReview } from '../hooks/useExecutiveQualityReview';

const dayLabel = day => new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', numberingSystem: 'latn', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
const operationsMetricLabels = { 'business-month': 'غسلات سويتر للشهر حسب تعريف المصدر', 'tips-net': 'صافي البقشيش بعد الرسوم', 'actual-capacity': 'السعة الفعلية والتعطل' };
const operationsCaseLabel = item => /ملغ.*معتمد.*حفظ/u.test(item.title) ? 'حجوزات ملغاة معتمدة تنتظر الحفظ.'
  : /ربط.*تاريخ/u.test(item.title) ? 'ربط حجز تاريخي يحتاج مراجعة.'
    : /جاهزية.*مخزون/u.test(item.title) ? 'جاهزية الأصول والمخزون غير متحققة.' : readableExecutiveText(item.title);

export function ExecutiveDailySummaryLive({ report, latestReportDate }) {
  const data = useExecutiveDailyMetrics();
  const operationsReview = useLatestOperationsReview(data?.today || riyadhTodayISO());
  const today = data?.today || riyadhTodayISO();
  const qualityReview = useExecutiveQualityReview(data?.overview?.workers, today.slice(0, 7), today);
  return <ExecutiveDailySummary report={report} data={data} latestReportDate={latestReportDate} operationsReview={operationsReview} qualityReview={qualityReview} />;
}

export default function ExecutiveDailySummary({ report, data, latestReportDate = report?.dateRiyadh, operationsReview, qualityReview }) {
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
  const problems = executiveProblems(report, data?.cash, operationsReview, qualityReview);
  const decisions = executiveOwnerDecisions(report);
  return <div className="sw-executive-daily">
    {latestReportDate && latestReportDate !== today && <p className="sw-executive-daily__stale" role="note">آخر تقرير: <time dateTime={latestReportDate}>{dayLabel(latestReportDate)}</time> — لم يُحفظ تقرير اليوم؛ سبب عدم صدوره غير مسجل.</p>}
    <section aria-label="خلاصة المشروع الحالية">
      <h2>الخلاصة</h2>
      <p className="sw-executive-daily__dated">مؤشرات الموقع الحالية حتى <time dateTime={today}>{dayLabel(today)}</time>؛ ليست لقطة التقرير المحفوظ{report ? <> بتاريخ <time dateTime={report.dateRiyadh}>{dayLabel(report.dateRiyadh)}</time></> : ''}.</p>
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
        <p>{problem.text}{problem.balances?.map(row => <span key={row.code}> {row.name} <bdi>{formatCurrencyPrecise(row.balance)}</bdi>؛</span>)} {problem.needsWording&&<span className="report-wording-warning">تحتاج صياغة</span>}</p>
        <small>{problem.quality ? 'المصدر: تقارير الجودة المنشورة أدناه' : problem.qualityRead ? 'المصدر: قراءة الجودة الحالية' : problem.operations ? `مراجعة التشغيل · ${dayLabel(problem.operations.dateRiyadh)}` : problem.current ? `الدفتر الحالي · ${dayLabel(today)}` : `بحسب تقرير ${dayLabel(report.dateRiyadh)}`}</small>
      </li>)}</ul> : <p>{data?.cash.loading ? 'جارٍ فحص الأرصدة النقدية…' : 'لا توجد مشاكل إضافية مسجلة في المصادر المقروءة.'}</p>}
    </section>
    {report&&<ReportFinancialNumbers report={report}/>}
    <OperationsCoverage state={operationsReview} today={today} />
    <QualityCoverage state={qualityReview} today={today} />
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
        <h3>القيود وفشل الجولات والأدوات</h3>{report.visibleWarnings.map(warning => <p key={warning.id}>{readableExecutiveText(warning.text)} {needsReportWording(warning.text)&&<span className="report-wording-warning">تحتاج صياغة</span>}</p>)}
        <h3>نص طلبات المالك</h3><p>{readableExecutiveText(report.ownerAction.text)}</p>
        {report.decisions.filter(d => d.status === 'awaiting_owner').map(d => <details key={d.caseId}><summary>{readableExecutiveText(d.caseId)}</summary><p>{readableExecutiveText(d.decision)}</p><p>{readableExecutiveText(d.next)}</p></details>)}
        <section className="sw-executive__detail-list" aria-label="تفاصيل الملخص">{report.details.map((detail, i) => <details key={i}><summary>{readableExecutiveText(detail.title)}</summary><p>{readableExecutiveText(detail.text)}</p>{detail.sourceRef && <p>مرجع المصدر: <bdi>{detail.sourceRef}</bdi></p>}</details>)}</section>
        <p>وقت التقرير: <time dateTime={report.cutAtRiyadh}>{report.cutAtRiyadh}</time> · نسخة {report.revision}</p>
      </>}
    </details>
  </div>;
}

function QualityCoverage({ state, today }) {
  if (!state) return null;
  const review = state.review;
  const dateTime = value => new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh', numberingSystem: 'latn' }).format(new Date(value));
  return <section aria-label="حالة الجودة المنشورة" className="sw-executive-daily__operations">
    <h2>حالة الجودة المنشورة</h2>
    {state.loading ? <p role="status">جارٍ قراءة تقارير الجودة المنشورة…</p> : state.error ? <p role="alert">{state.error}</p> : !review ? <p>حالة الجودة غير متاحة في هذه القراءة.</p> : <>
      {review.latestPublishedAt ? <p>آخر حفظ ضمن التقارير المعروضة: <time dateTime={review.latestPublishedAt}>{dateTime(review.latestPublishedAt)}</time> (الرياض)</p>
        : <p>لم يُعثر على تقارير منشورة متحققة ضمن القائمة المقروءة.</p>}
      {review.oldestCut && <p>وقت قطع التقارير: <time dateTime={review.oldestCut}>{dateTime(review.oldestCut)}</time>
        {review.latestCut !== review.oldestCut && <> — <time dateTime={review.latestCut}>{dateTime(review.latestCut)}</time></>} (الرياض)</p>}
      {review.windows.map(window => <p key={`${window.from}:${window.to}`}>نطاق منشور: <time dateTime={window.from}>{dayLabel(window.from)}</time> — <time dateTime={window.to}>{dayLabel(window.to)}</time> · {formatNumber(window.count)} بايكر</p>)}
      {review.windows.length > 0 && review.windows.some(window => window.to < today) && <p role="note">هذه فترات التقارير المنشورة؛ لا تثبت مراجعة الوقائع اللاحقة لها.</p>}
      <p>لهم تقرير منشور: {formatNumber(review.published)} من {formatNumber(review.requested)} · جزئي: {formatNumber(review.partial)} · مكتمل: {formatNumber(review.complete)} · خارج الفترة: {formatNumber(review.outside)}</p>
      <p>بلا تقرير: {formatNumber(review.missing)} · تعذرت قراءتهم: {formatNumber(review.failed)} · بيانات غير صالحة: {formatNumber(review.invalid)}</p>
      {review.sourceUnavailable > 0 && <p role="alert">تعذرت قراءة المصدر التشغيلي الحالي لبعض البايكرية؛ التقارير المنشورة لا تثبت تغطيته.</p>}
      {review.hasIssues && <p>التقييم النهائي غير مكتمل على مستوى القائمة؛ لا يُفترض اكتمال المعايير الناقصة.</p>}
      <details><summary>تغطية معايير الجودة المنشورة</summary>
        <ul>{review.criteria.map(item => <li key={item.key}>{item.label}: بيانات متاحة لـ {formatNumber(item.available)} من {formatNumber(item.total)}؛ تغطية كاملة لـ {formatNumber(item.covered)}.</li>)}</ul>
        <p>قراءة من تقارير البروفايلات ومسار المراجعة اليدوية القائم؛ لا درجات جديدة أو إعادة وزن.</p>
      </details>
    </>}
    <a href="/?page=bikers">فتح تقارير الجودة في البايكر</a>
  </section>;
}

function OperationsCoverage({ state, today }) {
  if (!state) return null;
  const report = state.report;
  const statuses = { verified: 'متحقق ضمن النطاق', partial: 'جزئي', unavailable: 'غير متاح' };
  return <section aria-label="نطاق مراجعة التشغيل" className="sw-executive-daily__operations">
    <h2>نطاق مراجعة التشغيل</h2>
    {state.loading ? <p>جارٍ قراءة آخر مراجعة شاملة للتشغيل…</p> : state.error ? <p role="alert">{state.error}</p> : !report ? <p>لا توجد مراجعة شاملة متاحة؛ لا يمكن تأكيد اكتمال التشغيل.</p> : <>
      <p>مراجعة <time dateTime={report.dateRiyadh}>{dayLabel(report.dateRiyadh)}</time> · {OPERATIONS_STATUSES[report.status]} · آخر خدمة: <time dateTime={report.serviceDateRiyadh}>{dayLabel(report.serviceDateRiyadh)}</time></p>
      <p>النطاق: {dayLabel(report.period.from)} — {dayLabel(report.period.to)} · وقت القطع: <time dateTime={report.cutAtRiyadh}>{new Date(report.cutAtRiyadh).toLocaleString('ar-SA-u-ca-gregory', { numberingSystem: 'latn', timeZone: 'Asia/Riyadh' })}</time></p>
      {report.dateRiyadh !== today && <p role="note">هذه آخر مراجعة متاحة؛ ليست مراجعة اليوم.</p>}
      <p>الخدمات الفردية: {statuses[report.coverage.individual.status]} · خدمات الشركات: {statuses[report.coverage.b2b.status]}</p>
      <div className="sw-executive-daily__operations-metrics">{report.metrics.map(m => <section key={m.id} aria-label={operationsMetricLabels[m.id] || readableExecutiveText(m.label)}>
        <h3>{operationsMetricLabels[m.id] || readableExecutiveText(m.label)}</h3><strong><bdi>{m.value === null ? 'غير متاح' : `${formatNumber(m.value)} ${m.unit}`}</bdi></strong>
      </section>)}</div>
      <p>كل مؤشر له تعريفه وفترته؛ الأعداد لا تمثل مطابقة مالية.</p>
      <h3>الفجوات المسجلة عند القطع</h3>
      <ul>{report.cases.filter(c => c.status !== 'verified_closed').map(c => <li key={c.caseId}>{operationsCaseLabel(c)}</li>)}</ul>
      <details><summary>أدلة مراجعة التشغيل وحدودها</summary>
        <p>الخدمات الفردية: {readableExecutiveText(report.coverage.individual.detail)}</p>
        <p>خدمات الشركات: {readableExecutiveText(report.coverage.b2b.detail)}</p>
        {report.metrics.map(m => <p key={m.id}>{readableExecutiveText(m.label)}: {readableExecutiveText(m.coverage)} · <time dateTime={m.asOf}>{m.asOf}</time></p>)}
        {report.cases.filter(c => c.status !== 'verified_closed').map(c => <p key={c.caseId}>{readableExecutiveText(c.title)}: {readableExecutiveText(c.evidence)}</p>)}
        {report.visibleWarnings.map(w => <p key={w.id}>{readableExecutiveText(w.text)} {needsReportWording(w.text)&&<span className="report-wording-warning">تحتاج صياغة</span>}</p>)}
        <p>{readableExecutiveText(report.historicalIntegrity)}</p>
        <p><bdi>{report.reportId}</bdi> · نسخة {report.revision}</p>
      </details>
    </>}
  </section>;
}
