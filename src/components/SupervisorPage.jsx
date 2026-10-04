import { useState } from 'react';
import TopBar from './TopBar';
import { useSupervisorOverview } from '../hooks/useSupervisor';

const money = value => !Number.isFinite(value) ? 'غير متاح' : `${new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value)} ر.س`;
const quantity = value => Number.isFinite(value) ? String(value) : 'غير متاح';
const panel = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-5';

export function SupervisorDashboard({ report, periodKey, onPeriodChange, loading = false, error = null, onRetry }) {
  const statement = report?.statement;
  const coverage = report?.coverage?.performance;
  return <main dir="rtl" className="p-4 sm:p-6 space-y-5 min-w-0">
    <div className={`${panel} flex flex-wrap items-center justify-between gap-3`}>
      <div><h2 className="font-bold text-lg">لوحة المشرف</h2><p className="text-sm text-slate-600 dark:text-slate-300">بيانات العمل والأداء — قراءة فقط</p></div>
      <label className="text-sm font-medium">شهر الأداء والحسبة
        <input type="month" aria-label="شهر الأداء والحسبة" value={periodKey} onChange={e => onPeriodChange(e.target.value)} className="block min-h-11 mt-1 rounded-lg border p-2 bg-white dark:bg-slate-800" />
      </label>
    </div>
    {loading ? <p role="status">جارٍ قراءة بيانات الشهر؛ النتائج غير متاحة بعد.</p> : error ? <div role="alert" className={panel}><p>تعذّر قراءة البيانات؛ لا توجد نتيجة مؤكدة.</p><button onClick={onRetry} className="min-h-11 underline">إعادة القراءة</button></div> : !report ? <p role="status">لا تتوفر بيانات موثقة للعرض.</p> : <>
      <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 break-words">
        <p>الفترة: {report.from} إلى {report.to}، الشهر الميلادي كاملًا. آخر قراءة: <span dir="ltr">{report.observedAt || 'غير متاح'}</span></p>
        <p>الأداء من الغسلات التشغيلية، والربح من القيود المرحّلة. {report.periodsOutsideScope || 'لم تُفحص نتائج الفترات الأخرى.'}</p>
      </div>
      <section aria-label="مؤشرات المشرف" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[[ 'العمال المسجلون', report.kpis.workers ],[ 'كمية الغسلات المكتملة', report.kpis.completedQuantity ],[ 'كمية الغسلات قيد التنفيذ', report.kpis.pendingQuantity ]].map(([label, value]) => <div className={panel} key={label}><p className="text-sm">{label}</p><p className="text-2xl font-bold mt-2">{quantity(value)}</p></div>)}
      </section>
      {!coverage?.complete && <div role="status" className="p-4 rounded-xl bg-amber-50 text-amber-900 text-sm space-y-1">
        <p>تغطية الأداء غير مكتملة؛ المؤشرات غير متاحة حتى تكتمل البيانات.</p>
        <p>سجلات بتواريخ مجهولة خارج المؤشر: {quantity(coverage?.unknownDateRows)}. سجلات غير صالحة في الشهر: {quantity(coverage?.invalidRows)}. كمية بلا ربط عامل مؤكد: {quantity(coverage?.unassignedQuantity)}.</p>
      </div>}
      <section aria-label="حسبة المشرف" className={`${panel} space-y-3`}>
        <h2 className="font-bold text-lg">أساس حسبة المشرف — 5%</h2>
        <p className="text-sm">الأساس مؤكد من المالك: 10% للإدارة و5% للمشرف، بإجمالي 15% من صافي الربح قبل الرسوم للشركة كاملة. الخسارة والتعادل لا ينتجان حصة موجبة.</p>
        {statement ? <dl className="space-y-2 text-sm">
          {[[ 'صافي الإيرادات بعد المردودات', statement.netRevenue ],[ 'التكاليف المباشرة', statement.directCosts ],[ 'المصاريف التشغيلية', statement.operatingExpenses ],[ 'صافي الربح قبل الرسوم (netProfitBeforeFees)', statement.netProfitBeforeFees ],[ 'مجموع الرسوم الحالية', statement.totalFees ],[ 'الصافي النهائي بعد الرسوم (netProfit)', statement.netProfit ]].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2"><dt className="break-words">{label}</dt><dd className="font-semibold">{money(value)}</dd></div>)}
        </dl> : <p role="status">بنود الربح غير متاحة بسبب نقص البيانات المحاسبية.</p>}
        {report.coverage.issues.length > 0 && <div role="status" className="text-sm text-amber-900 bg-amber-50 p-3 rounded-lg"><p className="font-semibold">حسبة الشهر الكامل غير مؤكدة</p><ul className="list-disc mr-5 mt-2">{report.coverage.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
        <p className="font-semibold text-sm">حسبة مرجعية للسياسة الحالية: {money(report.share.basisAmount)} × 5% = {money(report.share.referenceAmount)}</p>
        <p className="text-sm">هذا عرض مرجعي للقراءة فقط؛ لا يسجل استحقاقًا ولا يصرف مبلغًا.</p>
      </section>
      <section aria-label="أهداف المشرف من المصدر" className={`${panel} space-y-3`}>
        <h2 className="font-bold text-lg">أهداف المشرف من المصدر</h2>
        <p className="text-sm">أهداف موثقة في تبويب kpi، غير مربوطة بفترة محددة؛ الاعتماد والربط التشغيلي غير مكتملين.</p>
        <p role="status" className="text-sm">لا توجد مزامنة تلقائية مع الجدول. هذه أهداف المصدر المفحوص؛ الفعلي والإنجاز غير متاحين.</p>
        <p className="text-sm">تواريخ أشهر المتابعة الثلاثة: غير محددة. لا يمثل هذا السجل أداء الشهر المختار.</p>
        <dl className="space-y-3 text-sm">{report.goals?.metrics.map(metric => <div key={metric.key} className="space-y-1">
          <dt className="font-semibold">{metric.label}</dt>
          <dd>هدف المصدر: {metric.unit === 'ratio' ? '90% أو أكثر لكل شهر' : 'سقف 5000 ريال لكل شهر مستقل'}</dd>
          <dd>الفعلي: غير متاح · نسبة الإنجاز: غير متاحة</dd>
        </div>)}</dl>
        {report.goals?.source && <p className="text-xs break-words"><a href={report.goals.source.url} target="_blank" rel="noopener noreferrer" className="underline">مرجع أهداف المشرف — تبويب kpi</a> · فحص المصدر: <span dir="ltr">{report.goals.source.inspectedAt}</span> · النطاق: <span dir="ltr">{report.goals.source.range}</span></p>}
      </section>
      <section aria-label="أهداف وأداء العمال" className="space-y-3">
        <h2 className="font-bold text-lg">العمال والأداء الفعلي</h2>
        <div role="status" className={`${panel} text-sm`}>أهداف العمال غير متاحة؛ أهداف المشرف في المصدر مستقلة ولا توزّع على العمال. لا تُنشأ أهداف أو تقييمات من هذا العرض.</div>
        <p className="text-xs text-slate-600 dark:text-slate-300">الربط بمعرّف العامل أولًا، وبالاسم الفريد للسجلات القديمة فقط؛ الربط الملتبس يظهر مستقلًا عن أداء العامل.</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{report.workers.map(worker => <article className={`${panel} space-y-2`} key={worker.id}>
          <h3 className="font-bold break-words">{worker.name}</h3>
          <p className="text-xs">المباشرة: {worker.startDate || 'غير متاحة'} · نهاية العمل: {worker.endDate || 'غير مسجلة'}</p>
          <p className="text-sm">المكتملة: {quantity(worker.completedQuantity)} · قيد التنفيذ: {quantity(worker.pendingQuantity)}</p>
          {worker.invalidRows > 0 && <p className="text-xs text-amber-800">الأداء غير مكتمل: {worker.invalidRows} سجل غير صالح.</p>}
          <p className="text-sm">الهدف: غير متاح · نسبة التحقيق: غير متاحة</p>
        </article>)}</div>
        {report.workers.length === 0 && <p role="status">لم ترجع القراءة عمالًا مسجلين؛ لا يوجد أداء فردي معروض.</p>}
      </section>
    </>}
  </main>;
}
export default function SupervisorPage() {
  const [periodKey, setPeriodKey] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit' }).format(new Date()));
  const { data, loading, error, refetch } = useSupervisorOverview(periodKey);
  return <><TopBar title="حساب المشرف" subtitle="قراءة بيانات العمل والأداء" hidePartnerSelector /><SupervisorDashboard report={data} periodKey={periodKey} onPeriodChange={setPeriodKey} loading={loading} error={error} onRetry={refetch} /></>;
}
