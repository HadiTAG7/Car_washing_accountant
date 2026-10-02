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
  Calendar, HandCoins, Printer, TrendingUp, Wallet, Link2Off, Droplets, Lock, Clock3,
  PiggyBank, BookOpen, CalendarRange, CircleHelp, ChevronDown,
} from 'lucide-react';

import TopBar from './TopBar';
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
  capital:  { title: 'رأس مالي',     subtitle: 'سنداتك وما تبقّى من حصّتك' },
  journey:  { title: 'رحلة رأس مالي', subtitle: 'تفاصيل صرف التأسيس ثم مصاريف التشغيل والرصيد المتبقي' },
  income:   { title: 'قائمة الدخل',  subtitle: 'نتيجة الشهر مقسومة بنسبتك' },
  trends:   { title: 'اتجاه ٦ أشهر', subtitle: 'حصتك التحليلية من إيرادات الشركة وتكاليفها ونتيجتها' },
  assistant: { title: 'المساعد الذكي', subtitle: 'رابطك الخاص لتسأل Claude أو ChatGPT عن حصّتك' },
};

const metaFor = (view) => VIEW_META[view] || VIEW_META.overview;

// ما يُمرَّر بدل قائمة الدخل للعروض التي لا تعرضها: ثابتٌ واحد لا كائنٌ
// جديد في كل تصيير، فلا يُبطِل مذكّرةً تحته.
const EMPTY_STATEMENT = { hasActivity: false, fees: [] };

const todayMonth = () => new Date().toISOString().slice(0, 7);

// آخر n شهراً كـ { key, label } — نفس مُولِّد `OverviewPage` حرفياً كي
// يقرأ محورا الرسمين في الصفحتين الشيء نفسه.
function lastMonths(n) {
  const fmt = new Intl.DateTimeFormat('ar', { month: 'short', numberingSystem: 'latn' });
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
  return new Intl.DateTimeFormat('ar-SA', { year: 'numeric', month: 'long' }).format(date);
}

/**
 * علامة حال الشهر: مُقفَل = نهائي، مفتوح = مبدئي.
 *
 * الأرقام تتغيّر حتى يُقفل الشهر، وشريكٌ يرى رقم الشهر الماضي يتبدّل يسأل
 * «لماذا؟». العلامة تجيب قبل السؤال — ولا تُعرض حين لا سجل للفترة أصلاً.
 */
function PeriodBadge({ status }) {
  if (!status) return null;
  const closed = status === 'closed';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-control border ${
        closed
          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30'
          : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30'
      }`}
      title={status === 'allocation' ? 'تقرير تشغيلي حسب البنود المسجلة؛ ليس كشف توزيع معتمداً' : closed ? 'الشهر مُقفَل في الدفاتر — الأرقام نهائية' : 'الشهر مفتوح — قد تُضاف قيود فتتغيّر الأرقام'}
    >
      {closed ? <Lock size={12} /> : <Clock3 size={12} />}
      {closed ? 'نهائي' : 'مبدئي'}
    </span>
  );
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
        لم يُربط حسابك بسجل شريك بعد
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-md mx-auto">
        حسابك مُفعَّل، لكن الإدارة لم تربطه بعد بسجلّك في قائمة الشركاء — ولذلك
        لا يمكن عرض حصّتك ولا رأس مالك. تواصل مع الإدارة لإتمام الربط.
      </p>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// العروض الأربعة
// ═══════════════════════════════════════════════════════════════════════════

/** ترويسة الهوية: من أنت وكم نسبتك. تُعاد في «نظرة عامة» وحدها. */
function ShareCard({ partner, totalWorkers, sharePercent }) {
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">الشريك</p>
          <p className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
            {partner.partnerName}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {formatNumber(partner.workersCount || 0)} عامل من أصل {formatNumber(totalWorkers)}
          </p>
        </div>
        <div className="text-left">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">نسبتك</p>
          <p className="text-3xl font-black text-primary-700 dark:text-primary-300 tabular-nums">
            {sharePercent.toFixed(1)}%
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
          sub={settled ? 'اكتمل رأس مالك' : 'المتبقّي لاستكمال حصّتك'}
        />
      </div>
    </>
  );
}

function FoundingStageNotice({ status }) {
  if (!status?.available) return null;
  return (
    <div className="rounded-control border border-indigo-100 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 p-4 text-sm leading-relaxed text-indigo-900 dark:text-indigo-100">
      <p className="font-bold">رصيد مصاريف التأسيس</p>
      <p className="mt-1">ميزانيتك: {formatCurrency(status.budget)} — 20,000 ريال لكل بايكر.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        <div>المغطى من التأسيس هذا الشهر<p className="font-bold tabular-nums">{formatCurrency(status.covered)}</p></div>
        <div>رصيد التأسيس التحليلي المتبقي<p className="font-bold tabular-nums">{formatCurrency(status.remaining)}</p></div>
        <div>بعد نفاد رصيد التأسيس<p className="font-bold tabular-nums">{formatCurrency(status.uncovered)}</p></div>
      </div>
      <p className="mt-2 text-xs">رصيد تحليلي من مبالغك المسددة، بعد الصرف الأول واحتياطي التجديد. لا ينشئ مطالبة مالية أو تحويل أموال.</p>
      {status.fundingAsOf && <p className="mt-2 text-xs">دفعات التأسيس المسدّدة حتى {formatDate(status.fundingAsOf)} تغطي حصتك من المصاريف من الأقدم للأحدث، حتى لو كان السداد متأخراً. هذه تغطية من رصيد التأسيس، وليست تغييراً لتاريخ الدفع.</p>}
    </div>
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
          title="ما معنى احتياطي التجديد؟">
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
        <tr><td colSpan={2} className="py-2 text-xs text-slate-500 dark:text-slate-400">لا توجد بنود في هذه المجموعة لهذا الشهر.</td></tr>
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
  sharePercent, hasShare, paid, foundingStatus, availableMonths, activeMonth, onMonthChange, statement, periodStatus = null,
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
          title="لم تُسجَّل لك عمالة بعد — نسبتك ٠٪"
          hint="راجع الإدارة لتسجيل عدد عمالتك، فالنسبة تُحسب عليه."
        />
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <SectionHeader
        title={`قائمة الدخل — حصّتك (${sharePercent.toFixed(1)}%)`}
        subtitle="نتيجة الشهر مقسومة بنسبتك"
        action={(
          <div className="flex items-center gap-2">
            <PeriodBadge status={periodStatus} />
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
          title="لا توجد حركة مُرحّلة في هذا الشهر"
          hint="اختر شهراً آخر — لا توجد مصروفات أو إيرادات متاحة لهذه الفترة."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm [&_td]:px-2 [&_td:first-child]:whitespace-normal [&_td:first-child]:break-words [&_td:last-child]:text-xs sm:[&_td:last-child]:text-sm">
            <caption className="text-right text-xs text-slate-500 dark:text-slate-400 pb-3 leading-relaxed">
              تفصيل حصتك من المصروفات — البنود أدناه ضمن إجمالي مجموعتها، وليست خصماً إضافياً.
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
                  <p>نخصص جزءاً من ربح الشهر لتجديد المصاريف السنوية، مثل السكن والتأمين، في السنة القادمة. حصتك السنوية ÷ 12 هي الحصة الشهرية المخططة، وليست دفعة سنوية ثانية.</p>
                  <p>نحجز من الربح المتاح بعد المصروفات والرسوم فقط. شهر الخسارة أو التعادل لا نحجز فيه أي مبلغ؛ وإذا الربح أقل من المخطط، نحجز بقدره فقط. لا نحمل الأشهر التالية مبالغ الأشهر التي لم نحجز فيها.</p>
                  {reservePolicy && <>
                    <p>المخطط لهذا الشهر: {formatCurrency(reservePolicy.scheduledAmount)} · الربح المتاح: {formatCurrency(reservePolicy.availableProfit)} · المحتسب: {formatCurrency(statement.annualReserve || 0)}</p>
                    {reservePolicy.reason === 'no-profit' && <p className="font-semibold">لم يُحتسب هذا الشهر: لا يوجد ربح متاح.</p>}
                    {reservePolicy.reason === 'limited' && <p className="font-semibold">حُجز بقدر الربح المتاح فقط، أقل من الحصة الشهرية المخططة.</p>}
                    {reservePolicy.reason === 'no-schedule' && <p>لا توجد حصة سنوية مخططة لهذا الشهر.</p>}
                  </>}
                  <p className="text-xs">هذا احتساب في التقرير، وليس تحويل أموال فعلياً أو تغييراً في قيود الشركة.</p>
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
              <p>الشهري والمتغيّر يخصّان شهرهما. كل بند سنوي ÷ 12 لتجديد السنة القادمة، ويُحتسب من الربح المتاح فقط؛ الدفعة الأولى لا تُخصم مرة ثانية.</p>
            </div>
          )}
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
            الأرقام أعلاه حصّتك التحليلية ({sharePercent.toFixed(1)}%) من نتائج الشركة الشهرية،
            محسوبة على عدد العمالة، وتشمل المصروفات المسجلة والالتزامات الدورية واحتياطي التجديد.
            هذا تقرير حصتك التشغيلي؛ لا يغيّر قائمة الشركة المحاسبية.
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-200 mt-3 p-3 rounded-control bg-amber-50 dark:bg-amber-500/10 leading-relaxed">
            لا تُنشئ هذه النتيجة مطالبة مالية جديدة عليك ولا تعني توزيعاً نقدياً.
            المسجّل في سندات رأس مالك: {formatCurrency(paid)}، وتفاصيله في «رأس مالي».
            وظهور المصروف في حسابات الشركة لا يعني مطالبتك بدفعه مرة ثانية.
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
  partner, totalWorkers, sharePercent, required, paid, remaining, settled,
  receiptsCount, hasShare, latestMonth, latestStatement, latestStatus = null,
  mom = null, ytd = 0, washShare = null, roi = null, foundingStatus = null,
}) {
  return (
    <>
      <ShareCard partner={partner} totalWorkers={totalWorkers} sharePercent={sharePercent} />
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
          action={<PeriodBadge status={latestStatus} />}
        />
        {!hasShare ? (
          <EmptyState
            compact
            icon={TrendingUp}
            title="لم تُسجَّل لك عمالة بعد — نسبتك ٠٪"
            hint="راجع الإدارة لتسجيل عدد عمالتك، فالنسبة تُحسب عليه."
          />
        ) : !latestStatement.hasActivity ? (
          <EmptyState
            compact
            icon={Calendar}
            title="لا توجد حركة مُرحّلة بعد"
            hint="ستظهر نتيجتك هنا حالما تُرحَّل قيود الشهر."
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
                ? 'الرسوم المدفوعة مسبقاً لا تُطلب منك مرة أخرى؛ هذه النتيجة ليست مطالبة'
                : (momText(mom) || `نسبتك ${sharePercent.toFixed(1)}%`)}
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
              ? `من أصل ${formatNumber(washShare.companyCount)} غسلة مكتملة في ${formatMonthLabel(washShare.month)}`
              : 'يُحسب من سجل الغسلات عند توفّره'}
          />
        </div>
      )}

      {/* ── استرداد رأس المال ─────────────────────────────────── */}
      {hasShare && roi && (
        <Card className="p-5">
          <SectionHeader
            title="مقارنة نتائج الشركة برأس مالك"
            subtitle="مؤشر تحليلي لنتائج التشغيل مقابل ما دفعته، وليس استرداداً أو توزيعاً نقدياً"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <StatCard
              icon={PiggyBank}
              tone="emerald"
              label="حصتك التحليلية من النتائج منذ البداية"
              value={formatCurrency(roi.cumulativeProfit)}
              sub={roi.firstMonth ? `منذ ${formatMonthLabel(roi.firstMonth)} — ${formatNumber(roi.monthsCounted)} شهراً` : 'لا أشهر مُرحّلة بعد'}
            />
            <StatCard
              icon={TrendingUp}
              tone={roi.recovered ? 'emerald' : 'primary'}
              label="نسبة التعادل التحليلي"
              value={roi.paid > 0 ? `${Math.max(0, roi.recoveredPercent).toFixed(1)}%` : '—'}
              sub={roi.paid > 0 ? (roi.recovered ? 'النتائج التراكمية تعادل ما دفعته؛ ليست دفعة مستلمة' : `الفارق التحليلي ${formatCurrency(roi.remaining)}`) : 'لم تُسجَّل دفعات بعد'}
            />
            <StatCard
              icon={Calendar}
              tone={roi.recovered ? 'emerald' : (roi.monthsToRecover === null ? 'slate' : 'amber')}
              label="المتوقع للتعادل"
              value={roi.recovered ? '✓ تعادل' : (roi.monthsToRecover === null ? 'غير محدد' : `~${formatNumber(roi.monthsToRecover)} شهراً`)}
              sub={roi.recovered
                ? 'تعادلٌ محاسبي لا يثبت توزيعاً أو استرداداً نقدياً'
                : (roi.monthsToRecover === null
                  ? 'متوسط آخر الأشهر صفرٌ أو سالب'
                  : `بمتوسط ${formatCurrency(roi.avgRecent)} شهرياً (آخر ${formatNumber(roi.monthsAveraged)} أشهر)`)}
            />
          </div>
          <ProgressBar
            value={Math.min(roi.cumulativeProfit, roi.paid || 1)}
            max={roi.paid || 1}
            color={roi.recovered ? 'emerald' : 'primary'}
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
            تقديرٌ لا وعد: يُبنى على نتائج التشغيل والالتزامات المسجلة، وليس قرار توزيع أرباح.
          </p>
        </Card>
      )}
    </>
  );
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

      {/* ── رصيدك في الدفاتر ──────────────────────────────────────
          السندات ما دفعته؛ والدفاتر ما رُحِّل منه. الفرق بينهما «قيد
          الترحيل» — دفعةٌ لم تدخل الكتب بعد، لا دفعةٌ ضاعت. */}
      {paidSummary && paidSummary.ledgerAvailable && (
        <Card className="p-5">
          <SectionHeader
            title="رصيدك في الدفاتر"
            subtitle="حساب رأس مالك في دفتر الأستاذ مقابل سنداتك"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              icon={BookOpen}
              label="المُرحَّل في الدفاتر"
              value={formatCurrency(paidSummary.ledgerBalance)}
              sub="رصيد حساب رأس مالك من القيود المُرحّلة"
            />
            <StatCard
              icon={HandCoins}
              tone="emerald"
              label="المسدَّد بالسندات"
              value={formatCurrency(paidSummary.paid)}
              sub={`${formatNumber(myReceipts.length)} سند قبض`}
            />
            <StatCard
              icon={paidSummary.unposted > 0.005 ? Clock3 : Lock}
              tone={paidSummary.unposted > 0.005 ? 'amber' : 'emerald'}
              label="قيد الترحيل"
              value={paidSummary.unposted > 0.005 ? formatCurrency(paidSummary.unposted) : '✓ مطابق'}
              sub={paidSummary.unposted > 0.005
                ? 'دفعاتٌ سُجّلت ولم تدخل الدفاتر بعد — تظهر قريباً'
                : 'الدفاتر تطابق سنداتك'}
            />
          </div>
        </Card>
      )}

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
            title="لا توجد دفعات مسجّلة بعد"
            hint="ستظهر هنا كل دفعة رأس مال تُسجَّل باسمك."
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
          <EmptyState compact icon={Calendar} title="لا توجد سندات قبض في آخر ٦ أشهر" />
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
          title="لم تُسجَّل لك عمالة بعد — نسبتك ٠٪"
          hint="راجع الإدارة لتسجيل عدد عمالتك، فالنسبة تُحسب عليه."
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
          title="لا توجد حركة مُرحّلة في آخر ٦ أشهر"
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
          subtitle={`نسبتك ${washTrend.sharePercent.toFixed(1)}% من الغسلات المكتملة — آخر ${formatNumber(washTrend.months.length)} أشهر`}
        />
        {washTrend.total === 0 ? (
          <EmptyState compact icon={Droplets} title="لا غسلات مكتملة في هذه الأشهر" />
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
  const { totalWorkers } = usePartnerView();
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
  const sharePercent = totalWorkers > 0
    ? ((partner.workersCount || 0) / totalWorkers) * 100
    : 0;

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
    const months = lastMonths(6);
    const byMonth = new Map(months.map((m) => [m.key, 0]));
    for (const p of myReceipts) {
      const key = String(p.paymentDate || '').slice(0, 7);
      if (byMonth.has(key)) byMonth.set(key, byMonth.get(key) + (Number(p.amount) || 0));
    }
    const values = months.map((m) => byMonth.get(m.key));
    return { months, values, total: values.reduce((s, v) => s + v, 0) };
  }, [myReceipts, view]);

  // ── اتجاه النتيجة، آخر ٦ أشهر، بحصّته ──
  const profitTrend = useMemo(() => {
    if (view !== 'trends') {
      return { months: [], revenue: [], costs: [], net: [], total: 0 };
    }
    const months = lastMonths(6);
    const rows = months.map(m => allocationReport?.statements.find(s => s.periodKey === m.key)
      || { netRevenue: 0, totalAllocation: 0, netAfterReserve: 0 });
    return {
      months,
      revenue: rows.map((r) => r.netRevenue),
      costs:   rows.map((r) => r.totalAllocation),
      net:     rows.map((r) => r.netAfterReserve),
      total:   rows.reduce((s, r) => s + Math.abs(r.netRevenue) + Math.abs(r.totalAllocation), 0),
    };
  }, [allocationReport, view]);

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
    const fmt = new Intl.DateTimeFormat('ar', { month: 'short', numberingSystem: 'latn' });
    return {
      sharePercent: Number(insights.sharePercent) || 0,
      months: last6.map((m) => ({ key: m.month, label: fmt.format(new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)) - 1, 1)) })),
      values: last6.map((m) => m.shareCount),
      total: last6.reduce((s, m) => s + m.shareCount, 0),
    };
  }, [view, insights, washMonths]);

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
        <LoadingState message="جارٍ تحميل بياناتك..." />
      </>
    );
  }

  // Never silently fall back to the old, incomplete salary-only view.
  if (allocationError && ['overview', 'income', 'trends'].includes(view)) {
    return <><TopBar title={meta.title} subtitle={meta.subtitle} /><main className="p-4 sm:p-6"><ErrorState title="تعذّر تأكيد المصروفات ورصيد التأسيس" error={allocationError} /></main></>;
  }

  return (
    <>
      <TopBar title={meta.title} subtitle={meta.subtitle} />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
        {anyError && <ErrorState title="تعذّر تحميل بياناتك" error={anyError} />}

        {view === 'overview' && (
          <OverviewView
            partner={partner}
            totalWorkers={totalWorkers}
            sharePercent={sharePercent}
            required={required}
            paid={paid}
            remaining={remaining}
            settled={settled}
            receiptsCount={myReceipts.length}
            hasShare={hasShare}
            latestMonth={statementMonth}
            latestStatement={statement}
            latestStatus="allocation"
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
          <IncomeStatementCard
            sharePercent={sharePercent}
            hasShare={hasShare}
            paid={paid}
            foundingStatus={foundingStatus}
            availableMonths={availableMonths}
            activeMonth={activeMonth}
            onMonthChange={setSelectedMonth}
            statement={statement}
            periodStatus="allocation"
          />
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
            ? <LoadingState message="جارٍ التحقق من ربط حسابك..." />
            : <ErrorState title="تعذّر التحقق من ربط حسابك" error={partnerLinkError} onRetry={recheckPartnerLink} />}
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
