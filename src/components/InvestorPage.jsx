import { getLocale } from '../i18n/locale';
import { useLanguage } from '../i18n/useLanguage';
// ═══════════════════════════════════════════════════════════════════════════
// حسابي كشريك — أربعة خيارات لا ورقةً واحدة
// ═══════════════════════════════════════════════════════════════════════════
// المستثمر كان يدخل فيجد لوحة محاسب: دفتر الأستاذ وميزان المراجعة ورواتب
// البايكر بأسمائهم ومدفوعات بقية الشركاء. لا لأن أحداً قرّر ذلك، بل لأن لا
// أحد قرّر غيره — تبويبٌ واحد من ثلاثةٍ وعشرين كان يحمل قيداً بالدور.
//
// فقُلبت الافتراضية: صفحةٌ تُبنى ممّا يحتاجه المستثمر لا ممّا يتبقّى بعد
// الإخفاء. لكنها بُنيت ورقةً واحدة طويلة، وأربعةُ أشياء في ورقةٍ واحدة تعني
// أن من أراد رقماً واحداً يمرّ على الثلاثة الأخرى — وعلى الجوال، حيث يقرأ
// الشريك غالباً، يعني ذلك تمريراً لا قراءة.
//
// الآن أربعة عروض، كلٌّ يجيب سؤالاً واحداً:
//   • `overview`  أين أنا؟ حصّتي ورأس مالي ونتيجة آخر شهرٍ فيه حركة.
//   • `capital`   كم دفعتُ وكم بقي عليّ؟ السندات وكشف الحساب والتحصيل.
//   • `income`    ما نصيبي من نتيجة هذا الشهر؟
//   • `trends`    إلى أين تتجه؟
//
// التقسيم عرضٌ لا صلاحية: الأربعة تقرأ ما كانت الورقة الواحدة تقرؤه بالضبط،
// لا مجموعةً أكثر. والخطّافات هنا مقصودة بحصرها: لا `useWashes` ولا
// `useBikers` ولا `useMonthlyExpenses` ولا `useHousingUnits`. ليس تخفيفاً
// للحزمة وحده — بل لأن ما لا يُطلب لا يُسرَّب، ولأن المرحلة القادمة تمنع هذه
// المجموعات في القواعد، فصفحةٌ تطلبها ستسقط بخطأ صلاحيات بدل أن تعمل.
//
// وهي تُركَّب مرةً واحدة فوق العروض الأربعة: القراءة والانتظار والخطأ وبطاقة
// «لم يُربط حسابك» في غلافٍ واحد، فلا يختلف عرضٌ عن عرضٍ في معاملة الحالات
// التي ليست بيانات.
//
// ── ما يُستبعد من قائمة الدخل ──
// شريط المطابقة و«الفرق غير المفسَّر» وحاشية أرقام الحسابات والتنقيب
// التشغيلي: كلّها أدوات مَن يمسك الدفاتر لا مَن يقرأ نتيجته. و«فرق غير
// مفسَّر» عند مستثمرٍ ليس شفافية بل إنذارُ عطلٍ لا يملك إصلاحه.
// ═══════════════════════════════════════════════════════════════════════════

import { useId, useMemo, useState } from 'react';
import {
  Calendar, HandCoins, Printer, TrendingUp, Wallet, Link2Off, Droplets, Clock3,
  PiggyBank, BookOpen, CalendarRange, CircleHelp, ChevronDown,
} from 'lucide-react';

import TopBar from './TopBar';
import PartnerEligibilityNotice from './PartnerEligibilityNotice';
import { Card, SectionHeader, StatCard, EmptyState, ProgressBar, SecondaryButton } from './UI';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import StatementRow from './statement/StatementRow';
import PartnerStatementModal from './PartnerStatementModal';
import PartnerAssistantPage from './PartnerAssistantPage';
import PartnerCapitalJourneyPage from './PartnerCapitalJourneyPage';
import { ColumnTrend, LineTrend } from './charts/TrendCharts';

import { usePartnerView } from '../contexts/PartnerViewContext';
import { usePartnerPayments } from '../hooks/usePartnerPayments';
import { useLedger } from '../hooks/useLedger';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import { usePartnerStatement } from '../hooks/usePartnerStatement';
import { partnerPaidSummary } from '../lib/accounting/partnerTotals';
import {
  roiSummary, momChange, ytdTotal,
} from '../lib/accounting/partnerInsights';
import { comparePartnerReports, COMPARISON_FIELDS, validReportMonth } from '../lib/accounting/partnerReportComparison';
import { usePartnerInsights } from '../hooks/usePartnerInsights';
import {
  formatCurrency, formatDate, formatNumber, PER_WORKER_FEE,
} from '../data/initialData';

const METHOD_LABEL = {
  bank_transfer: 'تحويل بنكي',
  cash:          'نقدي',
  mada_pos:      'مدى / شبكة',
};

// عنوان الشريط العلوي لكل خيار. الاسم يقول ما في الصفحة لا ما في القسم كله،
// وإلا فقد التبويب فائدته: أربعة عناوين متطابقة تُرجع المستخدم إلى التمرير
// ليعرف أين هو.
const VIEW_META = {
  overview: { title: 'حسابي كشريك',  subtitle: 'حصّتك ورأس مالك ونتيجة آخر شهر' },
  capital:  { title: 'رأس مالي',     subtitle: 'سنداتك والباقي من حصّتك' },
  journey:  { title: 'رحلة رأس مالي', subtitle: 'تفاصيل صرف التأسيس ثم مصاريف التشغيل والرصيد المتبقي' },
  income:   { title: 'قائمة الدخل',  subtitle: 'إيراداتك ومصاريفك ونتيجة الشهر' },
  trends:   { title: 'اتجاه ٦ أشهر', subtitle: 'حصتك التحليلية من إيرادات الشركة وتكاليفها ونتيجتها' },
  assistant: { title: 'المساعد الذكي', subtitle: 'رابطك الخاص عشان تسأل Claude أو ChatGPT عن حصّتك' },
};

const metaFor = (view) => VIEW_META[view] || VIEW_META.overview;

// ما يُمرَّر بدل قائمة الدخل للعروض التي لا تعرضها: ثابتٌ واحد لا كائنٌ
// جديد في كل تصيير، فلا يُبطِل مذكّرةً تحته.
const EMPTY_STATEMENT = { hasActivity: false, fees: [] };

const todayMonth = () => new Date().toISOString().slice(0, 7);

// آخر n شهراً كـ { key, label } — نفس مُولِّد `OverviewPage` حرفياً كي
// يقرأ محورا الرسمين في الصفحتين الشيء نفسه.
function lastMonths(n, language) {
  const fmt = new Intl.DateTimeFormat(getLocale(language), { month: 'short', numberingSystem: 'latn' });
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({
      key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`,
      label: fmt.format(m),
    });
  }
  return out;
}

function formatMonthLabel(ym) {
  const [y, m] = String(ym).split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'long' }).format(date);
}

const COMPARISON_LABELS = {
  netRevenue: 'حصتك من صافي الإيرادات', variable: 'المصاريف المتغيرة والعمولات',
  monthly: 'المصاريف الشهرية والرواتب', other: 'المصاريف الأخرى', totalCosts: 'إجمالي مصاريف التشغيل',
  totalFees: 'رسوم الإدارة والإشراف', annualReserve: 'احتياطي التجديد السنوي', netAfterReserve: 'نتيجتك التشغيلية بعد الاحتياطي',
};

export function PartnerComparisonCard({ report, activeMonth }) {
  const [mode, setMode] = useState('month');
  const [choices, setChoices] = useState({});
  const months = [...new Set((report?.statements || []).map(row => row.periodKey).filter(validReportMonth))].sort().reverse();
  const periods = mode === 'year' ? [...new Set(months.map(key => key.slice(0, 4)))] : months;
  const preferred = mode === 'year' ? activeMonth?.slice(0, 4) : activeMonth;
  const first = periods.includes(choices[mode]?.first) ? choices[mode].first : periods.includes(preferred) ? preferred : periods[0];
  const second = periods.includes(choices[mode]?.second) && choices[mode].second !== first
    ? choices[mode].second : periods.find(key => key < first) || periods.find(key => key !== first);
  const newestYear = [first, second].filter(Boolean).sort().at(-1);
  const throughMonth = mode === 'year' ? Number(months.find(key => key.startsWith(`${newestYear}-`))?.slice(5)) || 12 : 12;
  const comparison = comparePartnerReports({ statements: report?.statements || [], mode, first, second, throughMonth });
  const label = key => mode === 'year' ? key : key ? formatMonthLabel(key) : 'غير متاح';
  const choose = (field, value) => setChoices(previous => ({ ...previous, [mode]: { first, second, ...previous[mode], [field]: value } }));
  const amount = value => value == null ? 'غير متاح' : formatCurrency(value);
  const firstLabelId = useId(); const secondLabelId = useId(); const modeLabelId = useId();
  return <Card className="p-5">
    <details>
      <summary className="cursor-pointer font-bold text-slate-900 dark:text-slate-100 min-h-10">مقارنة تقاريرك</summary>
      <div className="mt-4 space-y-4">
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">تقدر تقارن أرقام حصتك بين شهرين أو سنتين، من غير ما تتغيّر الحسابات أو رصيد التأسيس.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div><label htmlFor={modeLabelId} className="block mb-1">نوع المقارنة</label>
            <select id={modeLabelId} value={mode} onChange={event => setMode(event.target.value)} className="w-full min-h-10 p-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <option value="month">مقارنة شهرية</option><option value="year">مقارنة سنوية</option>
            </select></div>
          <div><label htmlFor={firstLabelId} className="block mb-1">الفترة الأولى</label>
            <select id={firstLabelId} value={first || ''} onChange={event => choose('first', event.target.value)} disabled={!periods.length} className="w-full min-h-10 p-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              {periods.map(key => <option key={key} value={key}>{label(key)}</option>)}
            </select></div>
          <div><label htmlFor={secondLabelId} className="block mb-1">الفترة الثانية</label>
            <select id={secondLabelId} value={second || ''} onChange={event => choose('second', event.target.value)} disabled={!second} className="w-full min-h-10 p-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              {periods.filter(key => key !== first).map(key => <option key={key} value={key}>{label(key)}</option>)}
            </select></div>
        </div>
        {!second ? <p className="text-sm text-slate-500">عشان تقارن، اختار فترتين مختلفتين</p> : <>
          {mode === 'year' && <p className="text-xs text-slate-500">المقارنة من يناير حتى {formatMonthLabel(`${newestYear}-${String(throughMonth).padStart(2, '0')}`).replace(/\s+[\d٠-٩]+$/, '')} في كل سنة؛ ما نحسب الأشهر المتاحة كأنها سنة كاملة.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
            {[comparison.first, comparison.second].map(period => <p key={period.period}>
              {label(period.period)} — أشهر متاحة: {formatNumber(period.available.length)} / {formatNumber(period.expected.length)}
              {!period.complete && <span className="block text-amber-700 dark:text-amber-300">أشهر غير متاحة: {period.missing.join('، ')}</span>}
            </p>)}
          </div>
          {!comparison.comparable && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">الأشهر مختلفة أو مو متاحة؛ عشان كذا ما نعرض فرق ممكن يعطيك صورة غلط.</p>}
          <div className="overflow-x-auto">
            <table aria-label="مقارنة أرقام حصتك" className="block sm:table w-full text-xs sm:text-sm">
              <thead className="hidden sm:table-header-group"><tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700"><th className="py-3 px-2 text-right">البند</th><th className="py-3 px-2">{label(first)}</th><th className="py-3 px-2">{label(second)}</th><th className="py-3 px-2">الفرق: الأولى − الثانية</th></tr></thead>
              <tbody className="block sm:table-row-group">{COMPARISON_FIELDS.map(field => <tr key={field} className={`grid grid-cols-3 sm:table-row border-b border-slate-100 dark:border-slate-800 ${field === 'netAfterReserve' ? 'font-bold' : ''}`}>
                <th scope="row" className="col-span-3 py-3 px-2 text-right font-normal">{COMPARISON_LABELS[field]}</th>
                {[comparison.first.values[field], comparison.second.values[field], comparison.differences[field]].map((value, index) => <td key={index} className="pb-3 sm:py-3 px-1 sm:px-2 text-center tabular-nums min-w-0">
                  <span className="block sm:hidden mb-1 text-[10px] text-slate-500">{index === 0 ? label(first) : index === 1 ? label(second) : 'الفرق'}</span>
                  <span className="inline-block max-w-full break-words sm:whitespace-nowrap">{amount(value)}</span>
                </td>)}
              </tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">المصاريف المتغيرة والشهرية والأخرى داخلة في إجمالي التشغيل، مو خصم زيادة.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">المجموع بس للأشهر المتاحة. «غير متاح» مو معناته صفر. النتيجة قبل تغطية التأسيس؛ مو مبلغ توزّع لك أو مطلوب منك.</p>
        </>}
      </div>
    </details>
  </Card>;
}

/** «▲ 12% عن الشهر السابق» — أو لا شيء حين لا سابق. */
function momText(mom) {
  if (!mom || mom.delta === null) return null;
  const arrow = mom.direction === 'up' ? '▲' : mom.direction === 'down' ? '▼' : '=';
  const pct = mom.percent === null ? formatCurrency(Math.abs(mom.delta)) : `${Math.abs(mom.percent).toFixed(1)}%`;
  return `${arrow} ${pct} عن الشهر السابق`;
}

/**
 * الحساب غير المربوط.
 *
 * دورٌ يقول «مستثمر» وصفٌّ لا يقول شيئاً. قبل اليوم كان هذا الحساب يحصل على
 * الواجهة الإدارية كاملة؛ الآن يقف هنا. الرسالة تسمّي الإجراء لا العطل: صاحبه
 * لا يملك إصلاحه، ومن يملكه لا يقرأ هذه الشاشة.
 */
function LinkMissingCard() {
  return (
    <Card className="p-8 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-control bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 mb-4">
        <Link2Off size={26} strokeWidth={2.2} />
      </div>
      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
        حسابك للحين ما انربط بسجل شريك
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-md mx-auto">
        حسابك مفعّل، بس الإدارة للحين ما ربطته بسجلّك في قائمة الشركاء. عشان كذا ما نقدر نعرض حصّتك ولا رأس مالك. تواصل مع الإدارة عشان يكملون الربط.
      </p>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// العروض الأربعة
// ═══════════════════════════════════════════════════════════════════════════

/** Own identity and original capital headcount, without allocation ratios. */
function ShareCard({ partner }) {
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">الشريك</p>
          <p translate="no" className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
            {partner.partnerName}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            عدد عمالك: {formatNumber(partner.workersCount || 0)}
          </p>
        </div>
      </div>
    </Card>
  );
}

/** رأس المال في ثلاثة أرقام واضحة. يُعاد في «نظرة عامة» و«رأس مالي». */
export function CapitalSummary({ partner, required, paid, remaining, settled, receiptsCount }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={Wallet}
          label="الرسوم المطلوبة"
          value={formatCurrency(required)}
          sub={`${formatNumber(partner.workersCount || 0)} عامل × ${formatCurrency(PER_WORKER_FEE)}`}
        />
        <StatCard
          icon={HandCoins}
          tone="emerald"
          label="المسدَّد"
          value={formatCurrency(paid)}
          sub={`${receiptsCount} سند قبض`}
        />
        <StatCard
          icon={TrendingUp}
          tone={settled ? 'emerald' : 'amber'}
          label="المتبقّي"
          value={settled ? '✓ مسدّد بالكامل' : formatCurrency(remaining)}
          sub={settled ? 'اكتمل رأس مالك' : 'الباقي عشان تكمّل حصّتك'}
        />
      </div>
    </>
  );
}

export function FoundingStageNotice({ status }) {
  if (!status?.available) return null;
  const exhausted = status.funded > 0 && status.remaining <= 0;
  return (
    <details key={exhausted ? 'exhausted' : 'available'} open={!exhausted}
      className="group rounded-control border border-indigo-100 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 p-4 text-sm leading-relaxed text-indigo-900 dark:text-indigo-100">
      <summary className="flex flex-wrap items-center justify-between gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden rounded-control focus-visible:outline-2 focus-visible:outline-primary-500">
        <span className="font-bold">رصيد مصاريف التأسيس</span>
        <span className="inline-flex items-center gap-2 text-xs">
          <span className="group-open:hidden">عرض التفاصيل</span>
          <span className="hidden group-open:inline">إخفاء التفاصيل</span>
          <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="mt-3">
      <p className="mt-1">ميزانيتك: {formatCurrency(status.budget)} — 20,000 ريال لكل بايكر.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        <div>المغطى من التأسيس هذا الشهر<p className="font-bold tabular-nums">{formatCurrency(status.covered)}</p></div>
        <div>رصيد التأسيس التحليلي المتبقي<p className="font-bold tabular-nums">{formatCurrency(status.remaining)}</p></div>
        <div>بعد ما يخلص رصيد التأسيس<p className="font-bold tabular-nums">{formatCurrency(status.uncovered)}</p></div>
      </div>
      <p className="mt-2 text-xs">هذا رصيد تحليلي من المبالغ اللي سددتها، بعد الصرف الأول واحتياطي التجديد. مو مطالبة مالية، وما يعني تحويل فلوس.</p>
      {status.fundingAsOf && <p className="mt-2 text-xs">دفعات التأسيس المسدّدة حتى {formatDate(status.fundingAsOf)} تغطي حصتك من المصاريف من الأقدم للأحدث، حتى لو سددت متأخر. هذي تغطية من رصيد التأسيس، وما تغيّر تاريخ الدفع.</p>}
      </div>
    </details>
  );
}

/** التفاصيل جزء من إجمالي المجموعة أعلاه، وليست خصماً إضافياً. */
function ExpenseStatementGroup({ label, amount, group, explanation = null, explanationId, explanationOpen = false, onExplain }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  return (
    <>
      <StatementRow label={<div className="flex items-center gap-2">
        <button type="button" onClick={() => setDetailsOpen(open => !open)} aria-label={`تفاصيل ${label}`}
          aria-expanded={detailsOpen} aria-controls={detailsOpen ? detailsId : undefined}
          className="inline-flex items-center gap-2 text-right cursor-pointer hover:underline focus-visible:outline-2 focus-visible:outline-primary-500 rounded-control py-1">
          <ChevronDown size={16} className={`shrink-0 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          <span>{label}</span>
        </button>
        {onExplain && <button type="button" onClick={onExplain} aria-label="شرح احتياطي التجديد السنوي"
          aria-expanded={explanationOpen} aria-controls={explanationOpen ? explanationId : undefined}
          className="inline-flex items-center justify-center shrink-0 w-8 h-8 cursor-pointer focus-visible:outline-2 focus-visible:outline-primary-500 rounded-control"
          title="ويش يعني احتياطي التجديد؟">
          <CircleHelp size={16} aria-hidden="true" />
        </button>}
      </div>} amount={amount} />
      {explanationOpen && (
        <tr><td colSpan={2} className="py-3">
          <div id={explanationId} className="rounded-control p-3 bg-indigo-50 dark:bg-indigo-500/10 text-sm text-indigo-900 dark:text-indigo-100 leading-relaxed space-y-2">
            {explanation}
          </div>
        </td></tr>
      )}
      {detailsOpen && <tr id={detailsId}><td colSpan={2}>
        <div role="region" aria-label={`تفاصيل ${label}`}>
          <table className="w-full text-sm" aria-label={`بنود ${label}`}>
            <colgroup><col /><col className="w-32 sm:w-44" /></colgroup><tbody>
      {(group?.items || []).map((item) => (
        <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-800/20">
          <td className="py-2 text-slate-700 dark:text-slate-300">
            <div className="pr-3 border-r-2 border-slate-200 dark:border-slate-700">
              <p className="font-medium">{item.description}</p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {group.key === 'annual'
                  ? `حصتك السنوية ${formatCurrency(item.annualAmount)} ÷ 12 — احتياطي التجديد`
                  : `${item.accountName} · ${formatDate(item.entryDate)}`}
              </p>
              {group.key === 'annual' && item.scheduledAmount != null && item.amount < item.scheduledAmount && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  المخطط لهذا الشهر: {formatCurrency(item.scheduledAmount)} — المحتسب حسب الربح: {formatCurrency(item.amount)}
                </p>
              )}
            </div>
          </td>
          <td className="py-2 text-left tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-400">
            {formatCurrency(item.amount)}
          </td>
        </tr>
      ))}
      {!group?.items?.length && (
        <tr><td colSpan={2} className="py-2 text-xs text-slate-500 dark:text-slate-400">ما فيه بنود في هالمجموعة لهالشهر.</td></tr>
      )}
            </tbody></table>
        </div>
      </td></tr>}
    </>
  );
}

/**
 * قائمة الدخل بحصّته.
 *
 * القسمة بالنسبة تقع داخل `monthlyStatement` مرة واحدة — كل سطر خطّيٌّ في
 * العامل، فلا حساب جديد هنا ولا فرصة لاختلاف رقمٍ عن رقم.
 */
export function IncomeStatementCard({
  hasShare, paid, foundingStatus, availableMonths, activeMonth, onMonthChange, statement,
}) {
  const groups = Object.fromEntries((statement.expenseBreakdown?.groups || []).map(group => [group.key, group]));
  const hasOtherExpenses = Boolean(groups.other?.amount || groups.other?.items?.length);
  const [reserveHelpOpen, setReserveHelpOpen] = useState(false);
  const reserveHelpId = useId();
  const reservePolicy = statement.renewalReserve;
  if (!hasShare) {
    return (
      <Card className="p-6">
        <SectionHeader title="قائمة الدخل" subtitle="حصّتك من نتيجة الشهر" />
        <EmptyState
          icon={TrendingUp}
          title="للحين ما تسجّل لك عدد عمال"
          hint="تواصل مع الإدارة عشان يسجّلون عدد عمالك."
        />
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <SectionHeader
        title="قائمة الدخل — حصّتك"
        subtitle="إيراداتك ومصاريفك ونتيجة الشهر"
        action={(
          <div className="flex items-center gap-2">
            <select
              aria-label="فترة التقرير (الشهر)"
              value={activeMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              className="px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-bold tabular-nums focus:outline-none focus:border-primary-500"
            >
              {availableMonths.map((ym) => (
                <option key={ym} value={ym}>{formatMonthLabel(ym)}</option>
              ))}
            </select>
          </div>
        )}
      />

      <FoundingStageNotice status={foundingStatus} />

      {!statement.hasActivity ? (
        <EmptyState
          icon={Calendar}
          title="ما فيه حركة مُرحّلة لهالشهر"
          hint="اختار شهر ثاني؛ ما فيه مصروفات أو إيرادات متاحة لهالفترة."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm [&_td]:px-2 [&_td:first-child]:whitespace-normal [&_td:first-child]:break-words [&_td:last-child]:text-xs sm:[&_td:last-child]:text-sm">
            <caption className="text-right text-xs text-slate-500 dark:text-slate-400 pb-3 leading-relaxed">
              هذي تفاصيل حصتك من المصروفات. البنود اللي تحت داخلة في إجمالي مجموعتها، مو خصم زيادة.
            </caption>
            <colgroup><col /><col className="w-32 sm:w-44" /></colgroup>
            <tbody>
              <StatementRow label="حصتك من صافي الإيرادات" amount={statement.netRevenue} kind="plus" />
              <ExpenseStatementGroup key={`variable:${activeMonth}`} label="المصاريف المتغيرة والعمولات" amount={groups.variable?.amount || 0} group={groups.variable} />
              <ExpenseStatementGroup key={`monthly:${activeMonth}`} label="المصاريف الشهرية والرواتب" amount={groups.monthly?.amount || 0} group={groups.monthly} />
              {hasOtherExpenses && (
                <ExpenseStatementGroup key={`other:${activeMonth}`} label="المصاريف الأخرى" amount={groups.other?.amount || 0} group={groups.other} />
              )}
              {(statement.fees || []).map((f) => (
                <StatementRow key={f.key} label={`يُخصم منه: ${f.label}`} amount={f.amount} />
              ))}
              <ExpenseStatementGroup key={`annual:${activeMonth}`} label="احتياطي التجديد السنوي — حصة هذا الشهر" amount={statement.annualReserve || 0} group={groups.annual}
                onExplain={() => setReserveHelpOpen(open => !open)} explanationOpen={reserveHelpOpen} explanationId={reserveHelpId}
                explanation={<>
                  <p>نخصص جزء من ربح الشهر لتجديد المصاريف السنوية، مثل السكن والتأمين، للسنة الجاية. حصتك السنوية ÷ 12 هي الحصة الشهرية المخططة، مو دفعة سنوية ثانية.</p>
                  <p>نحجز بس من الربح المتاح بعد المصروفات والرسوم. إذا الشهر فيه خسارة أو تعادل، ما نحجز أي مبلغ. وإذا الربح أقل من المخطط، نحجز قدّه بس. والأشهر اللي ما حجزنا فيها، ما نحمّل مبالغها على الأشهر اللي بعدها.</p>
                  {reservePolicy && <>
                    <p>المخطط لهذا الشهر: {formatCurrency(reservePolicy.scheduledAmount)} · الربح المتاح: {formatCurrency(reservePolicy.availableProfit)} · المحتسب: {formatCurrency(statement.annualReserve || 0)}</p>
                    {reservePolicy.reason === 'no-profit' && <p className="font-semibold">ما احتسبنا احتياطي لهالشهر، لأن ما فيه ربح متاح.</p>}
                    {reservePolicy.reason === 'limited' && <p className="font-semibold">حجزنا قدّ الربح المتاح بس، وهو أقل من الحصة الشهرية المخططة.</p>}
                    {reservePolicy.reason === 'no-schedule' && <p>ما فيه حصة سنوية مخططة لهالشهر.</p>}
                  </>}
                  <p className="text-xs">هذي حسبة في التقرير، مو تحويل فلوس فعلي ولا تغيير في قيود الشركة.</p>
                </>} />
              <StatementRow label="= حصتك التحليلية من نتيجة الشركة" amount={statement.netAfterReserve ?? statement.netProfit} kind="final" />
              {foundingStatus?.available && <>
                <StatementRow label="تغطية من رصيد رسوم التأسيس" amount={foundingStatus.covered} kind="plus" />
                <StatementRow label="= نتيجتك بعد تغطية التأسيس" amount={(statement.netAfterReserve ?? statement.netProfit ?? 0) + foundingStatus.covered} kind="final" />
              </>}
            </tbody>
          </table>
          {statement.expenseBreakdown && (
            <div aria-label="ملخص المصروفات" className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              <p>إجمالي المصروفات الثابتة الشهرية والسنوية: {formatCurrency(statement.expenseBreakdown.fixedTotal)}</p>
              <p>إجمالي مصروفاتك واحتياطي التجديد: {formatCurrency(statement.expenseBreakdown.total)}</p>
              <p>المصاريف الشهرية والمتغيّرة تخص نفس شهرها. كل بند سنوي ÷ 12 لتجديد السنة الجاية، ونحسبه بس من الربح المتاح؛ الدفعة الأولى ما تنخصم مرة ثانية.</p>
            </div>
          )}
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
            الأرقام اللي فوق هي حصّتك التحليلية من نتائج الشركة الشهرية، محسوبة على عدد العمال. وتشمل المصروفات المسجلة والالتزامات الدورية واحتياطي التجديد. هذا تقرير حصتك التشغيلي، وما يغيّر قائمة الشركة المحاسبية.
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-200 mt-3 p-3 rounded-control bg-amber-50 dark:bg-amber-500/10 leading-relaxed">
            هذي النتيجة مو مطالبة مالية جديدة عليك، ولا تعني توزيع نقدي. المسجّل في سندات رأس مالك: {formatCurrency(paid)}، وتفاصيله في «رأس مالي». إذا المصروف ظاهر في حسابات الشركة، مو معناته مطلوب منك تدفعه مرة ثانية.
          </p>
        </div>
      )}
    </Card>
  );
}

/**
 * «نظرة عامة» — الخيار الأول، وما يفتح عليه أول دخول.
 *
 * إجابةُ سطرٍ واحد على السؤالين: حصّتك ورأس مالك، وصافي ربحك من آخر شهرٍ
 * للدفاتر فيه قول. الشهر يُؤخذ من `availableMonths` لا من تاريخ اليوم: شهرٌ
 * لم يُرحَّل بعد يُظهر صفراً يبدو خسارةً، وهو أسوأ من ألا يُعرض.
 */
function OverviewView({
  partner, required, paid, remaining, settled,
  receiptsCount, hasShare, latestMonth, latestStatement,
  mom = null, ytd = 0, washShare = null, roi = null, foundingStatus = null,
}) {
  return (
    <>
      <ShareCard partner={partner} />
      <CapitalSummary
        partner={partner}
        required={required}
        paid={paid}
        remaining={remaining}
        settled={settled}
        receiptsCount={receiptsCount}
      />
      <FoundingStageNotice status={foundingStatus} />

      <Card className="p-5">
        <SectionHeader
          title="نتيجة آخر شهر"
          subtitle={`حصتك التحليلية من نتيجة ${formatMonthLabel(latestMonth)}`}
        />
        {!hasShare ? (
          <EmptyState
            compact
            icon={TrendingUp}
            title="للحين ما تسجّل لك عدد عمال"
            hint="تواصل مع الإدارة عشان يسجّلون عدد عمالك."
          />
        ) : !latestStatement.hasActivity ? (
          <EmptyState
            compact
            icon={Calendar}
            title="للحين ما فيه حركة مُرحّلة"
            hint="بتشوف نتيجتك هنا إذا ترحّلت قيود الشهر."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              icon={TrendingUp}
              label="صافي الإيرادات (حصّتك)"
              value={formatCurrency(latestStatement.netRevenue)}
              sub={formatMonthLabel(latestMonth)}
            />
            <StatCard
              icon={Wallet}
              tone="amber"
              label="التكاليف (حصّتك)"
              value={formatCurrency(latestStatement.totalCosts)}
              sub="مباشرة وتشغيلية"
            />
            <StatCard
              icon={HandCoins}
              tone={latestStatement.netAfterReserve >= 0 ? 'emerald' : 'slate'}
              label={latestStatement.netAfterReserve < 0 ? 'مبلغ إضافي مطلوب منك' : 'حصتك التحليلية من نتيجة الشركة'}
              value={formatCurrency(Math.max(0, latestStatement.netAfterReserve || 0))}
              sub={latestStatement.netAfterReserve < 0
                ? 'الرسوم اللي دفعتها من قبل ما نطلبها منك مرة ثانية؛ هذي النتيجة مو مطالبة'
                : (momText(mom) || 'حسب حصتك في التشغيل')}
            />
          </div>
        )}
      </Card>

      {/* ── منذ بداية السنة، وغسلاتك ──────────────────────────── */}
      {hasShare && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            icon={CalendarRange}
            tone="indigo"
            label={`حصتك التحليلية من نتيجة ${latestMonth.slice(0, 4)}`}
            value={formatCurrency(ytd)}
            sub="مجموع نتائج حصتك بعد المصروفات واحتياطي التجديد هذه السنة"
          />
          <StatCard
            icon={Droplets}
            tone="primary"
            label="غسلات تعادل حصّتك"
            value={washShare ? formatNumber(washShare.shareCount) : '—'}
            sub={washShare
              ? formatMonthLabel(washShare.month)
              : 'نحسبه من سجل الغسلات إذا صار متاح'}
          />
        </div>
      )}

      {/* ── استرداد رأس المال ─────────────────────────────────── */}
      {hasShare && roi && (
        <Card className="p-5">
          <SectionHeader
            title="مقارنة نتائج الشركة برأس مالك"
            subtitle="هذا مؤشر تحليلي لنتائج التشغيل مقابل اللي دفعته، مو استرداد ولا توزيع نقدي"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <StatCard
              icon={PiggyBank}
              tone="emerald"
              label="حصتك التحليلية من النتائج منذ البداية"
              value={formatCurrency(roi.cumulativeProfit)}
              sub={roi.firstMonth ? `منذ ${formatMonthLabel(roi.firstMonth)} — ${formatNumber(roi.monthsCounted)} شهراً` : 'للحين ما فيه أشهر مُرحّلة'}
            />
            <StatCard
              icon={TrendingUp}
              tone={roi.recovered ? 'emerald' : 'primary'}
              label="نسبة التعادل التحليلي"
              value={roi.paid > 0 ? `${Math.max(0, roi.recoveredPercent).toFixed(1)}%` : '—'}
              sub={roi.paid > 0 ? (roi.recovered ? 'النتائج التراكمية تعادل اللي دفعته؛ مو دفعة استلمتها' : `الفارق التحليلي ${formatCurrency(roi.remaining)}`) : 'للحين ما تسجّلت دفعات'}
            />
            <StatCard
              icon={Calendar}
              tone={roi.recovered ? 'emerald' : (roi.monthsToRecover === null ? 'slate' : 'amber')}
              label="المتوقع للتعادل"
              value={roi.recovered ? '✓ تعادل' : (roi.monthsToRecover === null ? 'غير محدد' : `~${formatNumber(roi.monthsToRecover)} شهراً`)}
              sub={roi.recovered
                ? 'هذا تعادل محاسبي، وما يثبت توزيع أو استرداد نقدي'
                : (roi.monthsToRecover === null
                  ? 'متوسط الأشهر الأخيرة صفر أو سالب'
                  : `بمتوسط ${formatCurrency(roi.avgRecent)} شهرياً (آخر ${formatNumber(roi.monthsAveraged)} أشهر)`)}
            />
          </div>
          <ProgressBar
            value={Math.min(roi.cumulativeProfit, roi.paid || 1)}
            max={roi.paid || 1}
            color={roi.recovered ? 'emerald' : 'primary'}
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
            هذا تقدير، مو وعد. يعتمد على نتائج التشغيل والالتزامات المسجلة، ومو قرار توزيع أرباح.
          </p>
        </Card>
      )}
    </>
  );
}

/** يظهر اختلاف الترحيل فقط؛ التطابق لا يحتاج ملخصاً مكرراً. */
export function CapitalLedgerNotice({ summary }) {
  if (!summary?.ledgerAvailable || !(Math.abs(summary.unposted) > 0.005)) return null;
  const pending = summary.unposted > 0;
  return <Card className="p-5">
    <SectionHeader title="رصيدك في الدفاتر" subtitle="فيه فرق بين سنداتك والدفاتر، بس ما يغيّر مبلغ السداد اللي فوق" />
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <StatCard icon={BookOpen} label="المُرحَّل في الدفاتر" value={formatCurrency(summary.ledgerBalance)}
        sub="رصيد حساب رأس مالك من القيود المُرحّلة" />
      <StatCard icon={Clock3} tone="amber" label={pending ? 'قيد الترحيل' : 'فرق يحتاج مراجعة'}
        value={formatCurrency(Math.abs(summary.unposted))}
        sub={pending ? 'دفعات مسجلة بالسندات، بس للحين ما ترحّلت للدفاتر' : 'رصيد الدفاتر أعلى من سنداتك؛ تواصل مع الإدارة عشان يراجعونه'} />
    </div>
  </Card>;
}

/** «رأس مالي» — السندات وكشف الحساب والتحصيل الشهري. */
function CapitalView({
  partner, required, paid, remaining, settled, myReceipts, receiptsTrend, onPrint, paidSummary = null,
}) {
  return (
    <>
      <CapitalSummary
        partner={partner}
        required={required}
        paid={paid}
        remaining={remaining}
        settled={settled}
        receiptsCount={myReceipts.length}
      />

      <CapitalLedgerNotice summary={paidSummary} />

      <Card className="p-5">
        <SectionHeader
          title="سندات قبضك"
          subtitle="الدفعات المسجّلة باسمك"
          action={(
            <SecondaryButton icon={Printer} onClick={onPrint}>
              كشف حساب (طباعة / PDF)
            </SecondaryButton>
          )}
        />
        {myReceipts.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="للحين ما فيه دفعات مسجّلة"
            hint="كل دفعة رأس مال تتسجّل باسمك، بتشوفها هنا."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 dark:text-slate-400 text-xs border-b border-slate-100 dark:border-slate-800">
                  <th className="py-2.5 px-3 text-right font-semibold">التاريخ</th>
                  <th className="py-2.5 px-3 text-right font-semibold">المبلغ</th>
                  <th className="py-2.5 px-3 text-right font-semibold">الطريقة</th>
                  <th className="py-2.5 px-3 text-right font-semibold">البيان</th>
                </tr>
              </thead>
              <tbody>
                {myReceipts.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className="py-3 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300 tabular-nums">
                      {formatDate(p.paymentDate)}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {METHOD_LABEL[p.method] || '—'}
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400">{p.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <td className="py-3 px-3 font-bold text-slate-900 dark:text-slate-100">إجمالي المسدّد</td>
                  <td className="py-3 px-3 font-extrabold text-slate-900 dark:text-slate-100 tabular-nums" colSpan={3}>
                    {formatCurrency(paid)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionHeader title="تحصيل رأس المال شهرياً" subtitle="سنداتك خلال آخر ٦ أشهر" />
        {receiptsTrend.total === 0 ? (
          <EmptyState compact icon={Calendar} title="ما فيه سندات قبض في آخر ٦ أشهر" />
        ) : (
          <ColumnTrend
            months={receiptsTrend.months}
            values={receiptsTrend.values}
            formatValue={formatCurrency}
            valueName="التحصيل"
          />
        )}
      </Card>
    </>
  );
}

/** «اتجاه ٦ أشهر» — ستّ قوائم دخلٍ مصغّرة في رسمٍ واحد. */
function TrendsView({ hasShare, profitTrend, washTrend = null }) {
  if (!hasShare) {
    return (
      <Card className="p-6">
        <SectionHeader title="حصتك من نتيجة الشركة شهرياً" subtitle="آخر ٦ أشهر" />
        <EmptyState
          icon={TrendingUp}
          title="للحين ما تسجّل لك عدد عمال"
          hint="تواصل مع الإدارة عشان يسجّلون عدد عمالك، لأن النسبة تنحسب عليه."
        />
      </Card>
    );
  }

  return (
    <>
    <Card className="p-5">
      {/* لا يُعاد عنوان الشريط العلوي هنا: عنوانان متطابقان فوق بعضهما
          يأكلان أول شاشةٍ على الجوال ولا يضيفان حرفاً. */}
      <SectionHeader title="حصتك من نتيجة الشركة شهرياً" subtitle="الإيرادات والتكاليف وصافي النتيجة، بحصّتك التحليلية" />
      {profitTrend.total === 0 ? (
        <EmptyState
          compact
          icon={TrendingUp}
          title="ما فيه حركة مُرحّلة في آخر ٦ أشهر"
        />
      ) : (
        <LineTrend
          months={profitTrend.months}
          formatValue={formatCurrency}
          series={[
            {
              id: 'revenue', label: 'الإيرادات', values: profitTrend.revenue,
              stroke: 'stroke-[#4f46e5] dark:stroke-[#6366f1]',
              dot: 'fill-[#4f46e5] dark:fill-[#6366f1]',
              swatch: 'bg-[#4f46e5] dark:bg-[#6366f1]',
            },
            {
              id: 'costs', label: 'التكاليف', values: profitTrend.costs,
              stroke: 'stroke-[#e63946]', dot: 'fill-[#e63946]', swatch: 'bg-[#e63946]',
            },
            {
              id: 'net', label: 'صافي النتيجة', values: profitTrend.net,
              stroke: 'stroke-[#059669]', dot: 'fill-[#059669]', swatch: 'bg-[#059669]',
            },
          ]}
        />
      )}
    </Card>

    {/* ── غسلاتك شهرياً ─────────────────────────────────────── */}
    {washTrend && washTrend.months.length > 0 && (
      <Card className="p-5">
        <SectionHeader
          title="غسلات تعادل حصّتك شهرياً"
          subtitle={`حصتك من الغسلات المكتملة — آخر ${formatNumber(washTrend.months.length)} أشهر`}
        />
        {washTrend.total === 0 ? (
          <EmptyState compact icon={Droplets} title="ما فيه غسلات مكتملة في هالأشهر" />
        ) : (
          <ColumnTrend
            months={washTrend.months}
            values={washTrend.values}
            formatValue={(v) => `${formatNumber(v)} غسلة`}
            valueName="حصّتك"
          />
        )}
      </Card>
    )}
    </>
  );
}

/**
 * الغلاف الفعلي. مفصولٌ عن الحارس كي لا يُركَّب أيّ خطّاف بيانات على المسار
 * المسدود: حسابٌ لم تُتحقَّق هويته لا يُصدِر استعلاماً أصلاً.
 *
 * وما يُحسب هنا هو المشترك وحده — الهوية والسندات والأشهر المتاحة. أمّا
 * الحسابات الثقيلة (ستّ قوائم دخل للاتجاه) فداخل عرضها: الخيار الذي لا
 * يُفتح لا يُكلِّف شيئاً، وهذا نصف فائدة التقسيم.
 */
function InvestorPortal({ partner, view }) {
  const { language } = useLanguage();
  const { payments, loading: paymentsLoading, error: paymentsError } = usePartnerPayments();
  const {
    entries, lines, loading: ledgerLoading, error: ledgerError,
  } = useLedger();
  const { report: allocationReport, loading: allocationLoading, error: allocationError } = usePartnerStatement({
    partnerId: partner.id, enabled: ['overview', 'income', 'trends'].includes(view),
  });
  // عدّ الغسلات من الخادم لا من `washes`: صفُّ الغسلة يحمل اسم عامله.
  const { washMonths, insights } = usePartnerInsights({
    partnerId: partner.id, months: 12, enabled: view === 'overview' || view === 'trends',
  });

  const [selectedMonth, setSelectedMonth] = useState(todayMonth());
  const [statementOpen, setStatementOpen] = useState(false);

  // ── سندات قبضه وحده ──
  const myReceipts = useMemo(
    () => payments.filter((p) => p.partnerId === partner.id),
    [payments, partner.id],
  );

  const required = (partner.workersCount || 0) * PER_WORKER_FEE;
  // يُجمع من السندات المعروضة أدناه لا من المجموع المخزَّن: رقمٌ وبنودُه
  // معروضان معاً لا يجوز أن يختلفا، والمخزَّن قد ينحرف. نفس اختيار
  // `PartnerStatementModal`.
  const paid = useMemo(
    () => myReceipts.reduce((s, p) => s + (Number(p.amount) || 0), 0),
    [myReceipts],
  );
  const remaining = Math.max(0, required - paid);
  const settled = required > 0 && remaining === 0;

  // ── الأشهر التي للدفاتر فيها قول ──
  // من القيود وحدها، لا من السجلّات التشغيلية: شهرٌ يظهر في القائمة بسبب
  // نشاطٍ لم يُرحَّل بعد يَعِد المستثمر بأرقامٍ لا يستطيع أحد تفسيرها له.
  const availableMonths = useMemo(() => {
    if (allocationReport) return allocationReport.statements.map(s => s.periodKey).sort().reverse();
    const set = new Set();
    for (const e of entries) {
      const key = String(e.periodKey || String(e.entryDate || '').slice(0, 7));
      if (/^\d{4}-\d{2}$/.test(key)) set.add(key);
    }
    const months = [...set].sort().reverse();
    return months.length ? months : [todayMonth()];
  }, [entries, allocationReport]);

  const activeMonth = availableMonths.includes(selectedMonth)
    ? selectedMonth
    : availableMonths[0];

  // القسمة بالنسبة تقع داخل `monthlyStatement` مرة واحدة — كل سطر خطّيٌّ في
  // العامل، فلا حساب جديد هنا ولا فرصة لاختلاف رقمٍ عن رقم.
  //
  // و«نظرة عامة» تقرأ آخر شهرٍ للدفاتر فيه قول لا شهر اليوم: شهرٌ لم يُرحَّل
  // بعد يُظهر صفراً يبدو خسارة، وهو أسوأ من ألا يُعرض.
  const statementMonth = view === 'overview' ? availableMonths[0] : activeMonth;
  const statement = useMemo(
    () => (view === 'overview' || view === 'income'
      ? allocationReport?.statements.find(s => s.periodKey === statementMonth) || EMPTY_STATEMENT
      : EMPTY_STATEMENT),
    [allocationReport, statementMonth, view],
  );

  const foundingStatus = useMemo(
    () => (view === 'overview' || view === 'income'
      ? allocationReport?.statements.find(s => s.periodKey === statementMonth)?.founding || null
      : null),
    [allocationReport, statementMonth, view],
  );

  // ── تحصيل رأس المال، آخر ٦ أشهر ──
  const receiptsTrend = useMemo(() => {
    if (view !== 'capital') return { months: [], values: [], total: 0 };
    const months = lastMonths(6, language);
    const byMonth = new Map(months.map((m) => [m.key, 0]));
    for (const p of myReceipts) {
      const key = String(p.paymentDate || '').slice(0, 7);
      if (byMonth.has(key)) byMonth.set(key, byMonth.get(key) + (Number(p.amount) || 0));
    }
    const values = months.map((m) => byMonth.get(m.key));
    return { months, values, total: values.reduce((s, v) => s + v, 0) };
  }, [myReceipts, view, language]);

  // ── اتجاه النتيجة، آخر ٦ أشهر، بحصّته ──
  const profitTrend = useMemo(() => {
    if (view !== 'trends') {
      return { months: [], revenue: [], costs: [], net: [], total: 0 };
    }
    const months = lastMonths(6, language);
    const rows = months.map(m => allocationReport?.statements.find(s => s.periodKey === m.key)
      || { netRevenue: 0, totalAllocation: 0, netAfterReserve: 0 });
    return {
      months,
      revenue: rows.map((r) => r.netRevenue),
      costs:   rows.map((r) => r.totalAllocation),
      net:     rows.map((r) => r.netAfterReserve),
      total:   rows.reduce((s, r) => s + Math.abs(r.netRevenue) + Math.abs(r.totalAllocation), 0),
    };
  }, [allocationReport, view, language]);

  // ── حصّته شهراً بشهر منذ أول قيد — للاسترداد والتغيّر ومنذ بداية السنة ──
  // تُحسب في «نظرة عامة» وحدها: قائمةٌ لكل شهرٍ مُرحَّل ليست رخيصة، والخيار
  // الذي لا يُفتح لا يكلّف.
  const nets = useMemo(() => {
    if (view !== 'overview') return [];
    return [...availableMonths].sort().map((k) => {
      const st = allocationReport?.statements.find(s => s.periodKey === k) || EMPTY_STATEMENT;
      return { month: k, netProfit: st.netAfterReserve || 0, hasActivity: st.hasActivity };
    });
  }, [view, availableMonths, allocationReport]);

  const roi = useMemo(() => (view === 'overview' ? roiSummary({ nets, paid }) : null), [view, nets, paid]);
  const mom = useMemo(() => {
    const active = nets.filter((n) => n.hasActivity);
    if (active.length < 2) return null;
    return momChange(active[active.length - 1].netProfit, active[active.length - 2].netProfit);
  }, [nets]);
  const ytd = useMemo(() => ytdTotal(nets, String(statementMonth).slice(0, 4)), [nets, statementMonth]);

  // غسلات آخر شهرٍ مُرحَّل بحصّته، وأشهر الاتجاه.
  const washShare = useMemo(
    () => washMonths.find((m) => m.month === statementMonth) ?? null,
    [washMonths, statementMonth],
  );
  const washTrend = useMemo(() => {
    if (view !== 'trends' || !insights) return null;
    const last6 = washMonths.slice(-6);
    const fmt = new Intl.DateTimeFormat(getLocale(language), { month: 'short', numberingSystem: 'latn' });
    return {
      months: last6.map((m) => ({ key: m.month, label: fmt.format(new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)) - 1, 1)) })),
      values: last6.map((m) => m.shareCount),
      total: last6.reduce((s, m) => s + m.shareCount, 0),
    };
  }, [view, insights, washMonths, language]);

  // رصيده في الدفاتر مقابل سنداته — لعرض «رأس مالي».
  const paidSummary = useMemo(
    () => (view === 'capital' ? partnerPaidSummary(partner.id, { payments: myReceipts, entries, lines }) : null),
    [view, partner.id, myReceipts, entries, lines],
  );

  const anyError = paymentsError || ledgerError || allocationError;
  const loading = paymentsLoading || ledgerLoading || allocationLoading;
  const hasShare = (partner.workersCount || 0) > 0;
  const meta = metaFor(view);

  if (loading && isFirebaseConfigured) {
    return (
      <>
        <TopBar title={meta.title} subtitle={meta.subtitle} />
        <LoadingState message="نحمّل بياناتك..." />
      </>
    );
  }

  // Never silently fall back to the old, incomplete salary-only view.
  if (allocationError && ['overview', 'income', 'trends'].includes(view)) {
    return <><TopBar title={meta.title} subtitle={meta.subtitle} /><main className="p-4 sm:p-6"><ErrorState title="ما قدرنا نتأكد من المصروفات ورصيد التأسيس" error={allocationError} /></main></>;
  }

  return (
    <>
      <TopBar title={meta.title} subtitle={meta.subtitle} />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
        {anyError && <ErrorState title="ما قدرنا نحمّل بياناتك" error={anyError} />}

        {['overview', 'income', 'trends'].includes(view) && <PartnerEligibilityNotice eligibility={allocationReport?.statements.find(s => s.periodKey === statementMonth)?.eligibility} periodKey={statementMonth} />}

        {view === 'overview' && (
          <OverviewView
            partner={partner}
            required={required}
            paid={paid}
            remaining={remaining}
            settled={settled}
            receiptsCount={myReceipts.length}
            hasShare={hasShare}
            latestMonth={statementMonth}
            latestStatement={statement}
            mom={mom}
            ytd={ytd}
            washShare={washShare}
            roi={roi}
            foundingStatus={foundingStatus}
          />
        )}

        {view === 'capital' && (
          <CapitalView
            partner={partner}
            required={required}
            paid={paid}
            remaining={remaining}
            settled={settled}
            myReceipts={myReceipts}
            receiptsTrend={receiptsTrend}
            onPrint={() => setStatementOpen(true)}
            paidSummary={paidSummary}
          />
        )}

        {view === 'income' && (
          <>
          <IncomeStatementCard
            hasShare={hasShare}
            paid={paid}
            foundingStatus={foundingStatus}
            availableMonths={availableMonths}
            activeMonth={activeMonth}
            onMonthChange={setSelectedMonth}
            statement={statement}
          />
          <PartnerComparisonCard key={partner.id} report={allocationReport} activeMonth={activeMonth} />
          </>
        )}

        {view === 'trends' && (
          <TrendsView hasShare={hasShare} profitTrend={profitTrend} washTrend={washTrend} />
        )}
      </main>

      <PartnerStatementModal
        isOpen={statementOpen}
        onClose={() => setStatementOpen(false)}
        partner={partner}
      />
    </>
  );
}

/**
 * الحارس. `view` يأتي من التبويب المختار عبر `investorViewFor` — وقيمةٌ لا
 * يعرفها الجدول تسقط على «نظرة عامة» لا على شاشةٍ فارغة.
 */
export default function InvestorPage({ view = 'overview' }) {
  const {
    viewedPartner, investorLinkMissing, partnerLinkLoading, partnerLinkError, recheckPartnerLink,
  } = usePartnerView();
  const safeView = VIEW_META[view] ? view : 'overview';
  const meta = metaFor(safeView);

  if (partnerLinkLoading || partnerLinkError) {
    return (
      <>
        <TopBar title={meta.title} subtitle={meta.subtitle} />
        <main className="p-4 sm:p-6 lg:p-8">
          {partnerLinkLoading
            ? <LoadingState message="نتأكد من ربط حسابك..." />
            : <ErrorState title="ما قدرنا نتأكد من ربط حسابك" error={partnerLinkError} onRetry={recheckPartnerLink} />}
        </main>
      </>
    );
  }

  if (investorLinkMissing || !viewedPartner) {
    return (
      <>
        <TopBar title={meta.title} subtitle={meta.subtitle} />
        <main className="p-4 sm:p-6 lg:p-8">
          <LinkMissingCard />
        </main>
      </>
    );
  }

  // صفحة الرابط لا تقرأ الدفاتر ولا السندات، فلا تُركَّب خطّافاتها: مكوّنٌ
  // مستقل تحت الحارس نفسه، لا عرضٌ خامس داخل `InvestorPortal`.
  if (safeView === 'assistant') return <PartnerAssistantPage partner={viewedPartner} meta={meta} />;
  if (safeView === 'journey') return <PartnerCapitalJourneyPage partner={viewedPartner} meta={meta} />;

  return <InvestorPortal partner={viewedPartner} view={safeView} />;
}
