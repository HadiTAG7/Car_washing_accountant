import { getLocale } from '../i18n/locale';
import { HandCoins, Landmark, Wallet, Receipt } from 'lucide-react';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState } from './UI';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { usePartnerStatement } from '../hooks/usePartnerStatement';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import { formatCurrency, formatDate } from '../data/initialData';

const BASIS_LABEL = {
  posted: 'مسجل في الدفاتر — لا يؤكد الدفع وحده',
  recorded: 'مصروف مسجل',
  scheduled: 'التزام شهري — ليس دفعة مؤكدة',
  operational: 'حسب سجل التشغيل',
  reserve: 'محجوز للتجديد — ليس صرفاً',
};
const monthLabel = key => new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' })
  .format(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1));

function AmountLine({ label, amount, total = false }) {
  return <div className={`flex justify-between gap-4 py-2 ${total ? 'border-t border-slate-200 dark:border-slate-700 font-bold' : ''}`}>
    <span>{label}</span><span className="tabular-nums whitespace-nowrap">{formatCurrency(amount)}</span>
  </div>;
}

// Pure content also used by the isolated UI tests. All amounts arrive already
// allocated and scoped by the server; this view performs no financial writes.
export function CapitalJourneyContent({ report }) {
  const journey = report.capitalJourney;
  return <>
    <Card className="p-5 space-y-3">
      <SectionHeader title="فلوسك وين راحت؟" subtitle="من رأس المال المسدّد إلى التأسيس ثم مصاريف التشغيل" />
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        الأرقام أدناه تخص حصتك فقط. التأسيس حسب مستندات الصرف والعدد الأصلي، والتشغيل حسب عدد البايكرز المؤهلين لكل شهر.
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        نطاق السجلات: {formatDate(report.from)} إلى {formatDate(report.through)} · آخر قراءة: {formatDate(report.asOf?.slice(0, 10))}
      </p>
      {journey.fundingAsOf && <p className="text-xs text-slate-500 dark:text-slate-400">دفعات التأسيس حتى {formatDate(journey.fundingAsOf)} موزعة على مصاريفك من الأقدم للأحدث، وتشمل الدفعات المتأخرة دون تغيير تواريخ سنداتها.</p>}
    </Card>

    {!journey.complete && <div role="alert" className="rounded-control border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200 space-y-2">
      <p className="font-bold">تفاصيل الصرف غير مكتملة — الرصيد المتبقي غير مؤكد</p>
      <p>نعرض البنود المتاحة، لكن يلزم مراجعة الإدارة للبنود التالية قبل تأكيد الرصيد:</p>
      <ul className="list-disc pr-5">{journey.warnings.map((warning, i) => <li key={i}>
        {warning.description}{warning.amount != null ? ` — حصتك من الفرق: ${formatCurrency(warning.amount)}` : ''} · {warning.reason}
      </li>)}</ul>
    </div>}

    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <StatCard icon={HandCoins} tone="emerald" label="رأس المال الذي دفعته" value={formatCurrency(journey.received)} sub={`${journey.receipts.length} سند قبض باسمك`} />
      <StatCard icon={Landmark} label="حصتك من صرف التأسيس" value={formatCurrency(journey.initialTotal)} sub="التأسيس والدفعات السنوية الأولى الموثقة" />
      <StatCard icon={Receipt} tone="amber" label="حصتك من مصاريف التشغيل" value={formatCurrency(journey.operatingTotal)} sub="يشمل المسجل والالتزامات الشهرية، دون احتياطي التجديد" />
      <StatCard icon={Wallet} tone="indigo" label="رصيد التأسيس المتبقي" value={journey.complete ? formatCurrency(journey.remaining) : 'غير مؤكد'} sub="رصيد تحليلي حسب تقرير التوزيع — ليس رصيداً بنكياً" />
    </div>

    <Card className="p-5 text-sm text-slate-700 dark:text-slate-200">
      <SectionHeader title="ملخص استخدام الرصيد" subtitle="هذه التفاصيل تشرح التقرير الحالي ولا تخصم أي مبلغ جديد" />
      <AmountLine label="المبلغ المسدّد ضمن ميزانية التأسيس" amount={journey.funded} />
      <AmountLine label="حصة صرف التأسيس والسنوي الأول" amount={-journey.initialTotal} />
      <AmountLine label="حصة المصاريف العادية المسجلة والالتزامات" amount={-journey.operatingTotal} />
      <AmountLine label="احتياطي التجديد المحجوز — لم يُصرف" amount={-journey.reserveTotal} />
      {journey.complete && <AmountLine total label="المتبقي حسب التقرير" amount={journey.remaining} />}
      {journey.received > journey.funded && <p className="mt-2 text-xs">دفعات فوق ميزانية التأسيس: {formatCurrency(journey.received - journey.funded)} — لا تُخصم تلقائياً في هذه الرحلة.</p>}
      {journey.beyondBalance > 0 && <p className="mt-2 text-xs">التكاليف والمحجوزات تتجاوز الرصيد بـ {formatCurrency(journey.beyondBalance)}. هذا بيان تحليلي، وليس مطالبة إضافية عليك.</p>}
      <details className="mt-3 text-xs leading-relaxed">
        <summary className="cursor-pointer font-semibold">كيف أقرأ هذه الأرقام؟</summary>
        <p className="mt-2">التأسيس يشمل الدفعة السنوية الأولى مرة واحدة. الاحتياطي مبلغ مخصص للتجديد من أشهر الربح فقط، وليس فاتورة جديدة أو صرفاً فعلياً. المصروف الشهري المجدول التزام وليس إثبات دفع، والترحيل في الدفاتر لا يثبت خروج المال من البنك. رصيد الصفحة يتبع حسبة التأسيس الحالية ولا يغيّر قائمة الدخل أو القيود أو مصدر التمويل.</p>
      </details>
    </Card>

    <Card className="p-5">
      <SectionHeader title="١. تفاصيل صرف التأسيس" subtitle="الفرنشايز والدباب والتجهيزات والدفعات السنوية الأولى — المبلغ المعروض هو حصتك" />
      {journey.initialItems.length === 0 ? <EmptyState compact icon={Landmark} title="لا توجد مستندات صرف تأسيس ضمن هذا النطاق" /> : <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="تفاصيل صرف التأسيس">
          <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
            <th className="py-3 text-right">البند والتاريخ</th><th className="py-3 text-left">حصتك من الصرف</th>
          </tr></thead>
          <tbody>{journey.initialItems.map(item => <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-3 pl-3 text-slate-700 dark:text-slate-200">
              <p className="font-semibold">{item.reversal ? 'عكس / استرداد — ' : ''}{item.description}</p>
              <p className="text-xs text-slate-500 mt-1">{formatDate(item.date)} · {item.kind === 'annual' ? 'دفعة سنوية أولى' : 'تأسيس'}</p>
            </td>
            <td className="py-3 text-left tabular-nums whitespace-nowrap">{formatCurrency(item.amount)}</td>
          </tr>)}</tbody>
          <tfoot><tr><td className="py-3 font-bold">إجمالي حصتك من الصرف الموثق</td><td className="py-3 text-left font-bold tabular-nums whitespace-nowrap">{formatCurrency(journey.initialTotal)}</td></tr></tfoot>
        </table>
      </div>}
    </Card>

    <Card className="p-5 space-y-4">
      <SectionHeader title="٢. المصاريف العادية بعد التأسيس" subtitle="التفاصيل الشهرية: المتغيرة والرواتب والشهرية وغيرها؛ والمحجوز للتجديد منفصل" />
      {[...journey.months].reverse().map((month, index) => <details key={month.periodKey} open={index === 0} className="rounded-control border border-slate-200 dark:border-slate-700 p-3 sm:p-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-800 dark:text-slate-100">
          {monthLabel(month.periodKey)} — مصاريف {formatCurrency(month.operatingCost)}
        </summary>
        <div className="mt-4 space-y-4">
          {month.groups.filter(group => group.items.length || group.amount !== 0).map(group => <details key={group.key}>
            <summary className="cursor-pointer text-sm font-bold text-slate-800 dark:text-slate-100">
              <span>{group.key === 'annual' ? 'احتياطي التجديد — محجوز وليس صرفاً' : group.label}</span>
              <span className="tabular-nums whitespace-nowrap mr-2">{formatCurrency(group.amount)}</span>
            </summary>
            <ul className="mt-2 space-y-2">{group.items.map(item => <li key={item.id} className="flex justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
              <div className="min-w-0"><p>{item.description}</p><p className="text-xs text-slate-500 mt-1">{formatDate(item.date)} · {BASIS_LABEL[item.basis] || 'حسب تقرير المصروفات'}</p></div>
              <span className="tabular-nums whitespace-nowrap">{formatCurrency(item.amount)}</span>
            </li>)}</ul>
          </details>)}
          {month.operatingCost === 0 && month.reserve === 0 && <p className="text-xs text-slate-500">لا توجد مصاريف أو محجوزات لهذا الشهر.</p>}
          <div className="text-xs text-slate-500 border-t border-slate-200 dark:border-slate-700 pt-3 space-y-1">
            <p>المغطى من التأسيس في التقرير هذا الشهر، شاملاً الاحتياطي: {formatCurrency(month.covered)}</p>
            {journey.complete && <p>رصيد التأسيس بنهاية الشهر: {formatCurrency(month.remaining)}</p>}
          </div>
        </div>
      </details>)}
    </Card>

    <Card className="p-5">
      <SectionHeader title="سندات رأس مالك" subtitle="الدفعات التي بُني عليها الرصيد أعلاه — دون سندات أي شريك آخر" />
      {journey.receipts.length ? <ul className="space-y-3">{journey.receipts.map(receipt => <li key={receipt.id} className="flex justify-between gap-3 text-sm text-slate-700 dark:text-slate-200">
        <span>{formatDate(receipt.date)}</span><span className="tabular-nums whitespace-nowrap">{formatCurrency(receipt.amount)}</span>
      </li>)}</ul> : <EmptyState compact icon={HandCoins} title="لا توجد سندات قبض متاحة" />}
    </Card>
  </>;
}

export default function PartnerCapitalJourneyPage({ partner, meta }) {
  const { report, loading, error, refetch } = usePartnerStatement({ partnerId: partner.id, includeCapitalJourney: true });
  return <>
    <TopBar title={meta.title} subtitle={meta.subtitle} />
    <main className="p-4 sm:p-6 lg:p-8 space-y-6">
      {!isFirebaseConfigured ? <SetupRequiredCard missing={missingEnvNames} />
        : error ? <ErrorState title="تعذّر تحميل رحلة رأس مالك" error={error} onRetry={refetch} />
          : loading || !report?.capitalJourney ? <LoadingState message="جارٍ تحميل رحلة رأس مالك..." />
            : <CapitalJourneyContent report={report} />}
    </main>
  </>;
}
