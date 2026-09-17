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

import { useMemo, useState } from 'react';
import {
  Calendar, HandCoins, Printer, TrendingUp, Wallet, Link2Off,
} from 'lucide-react';

import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, ProgressBar, SecondaryButton } from './UI';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import StatementRow from './statement/StatementRow';
import PartnerStatementModal from './PartnerStatementModal';
import PartnerAssistantPage from './PartnerAssistantPage';
import { ColumnTrend, LineTrend } from './charts/TrendCharts';

import { usePartnerView } from '../contexts/PartnerViewContext';
import { usePartnerPayments } from '../hooks/usePartnerPayments';
import { useLedger } from '../hooks/useLedger';
import { useFeeRules } from '../hooks/useFeeRules';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import { monthlyStatement } from '../lib/accounting/monthlyStatement';
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
  income:   { title: 'قائمة الدخل',  subtitle: 'نتيجة الشهر مقسومة بنسبتك' },
  trends:   { title: 'اتجاه ٦ أشهر', subtitle: 'إيراداتك وتكاليفك وصافي ربحك' },
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

/** رأس المال في ثلاثة أرقام وشريط. يُعاد في «نظرة عامة» و«رأس مالي». */
function CapitalSummary({ partner, required, paid, remaining, settled, receiptsCount }) {
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
      <Card className="p-5">
        <ProgressBar value={paid} max={required || 1} color={settled ? 'emerald' : 'primary'} />
      </Card>
    </>
  );
}

/**
 * قائمة الدخل بحصّته.
 *
 * القسمة بالنسبة تقع داخل `monthlyStatement` مرة واحدة — كل سطر خطّيٌّ في
 * العامل، فلا حساب جديد هنا ولا فرصة لاختلاف رقمٍ عن رقم.
 */
function IncomeStatementCard({
  sharePercent, hasShare, availableMonths, activeMonth, onMonthChange, statement,
}) {
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
        )}
      />

      {!statement.hasActivity ? (
        <EmptyState
          icon={Calendar}
          title="لا توجد حركة مُرحّلة في هذا الشهر"
          hint="اختر شهراً آخر — القائمة تُبنى من القيود المُرحّلة في الدفاتر."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              <StatementRow label="إيرادات المبيعات" amount={statement.grossRevenue} kind="plus" />
              {statement.salesReturns !== 0 && (
                <StatementRow
                  label="يُخصم منه: مردودات وخصومات المبيعات (إشعارات دائنة)"
                  amount={statement.salesReturns}
                />
              )}
              {statement.otherRevenue !== 0 && (
                <StatementRow label="إيرادات أخرى" amount={statement.otherRevenue} kind="plus" />
              )}
              <StatementRow label="= صافي الإيرادات" amount={statement.netRevenue} kind="subtotal" />
              <StatementRow
                label="يُخصم منه: التكاليف المباشرة والعمولات"
                amount={statement.directCosts}
              />
              <StatementRow label="= مجمل الربح التشغيلي" amount={statement.grossProfit} kind="subtotal" />
              <StatementRow
                label="يُخصم منه: المصاريف التشغيلية"
                amount={statement.operatingExpenses}
                kind="expenseSubtotal"
              />
              <StatementRow
                label="= صافي الربح قبل الرسوم"
                amount={statement.netProfitBeforeFees}
                kind="subtotal"
              />
              {(statement.fees || []).map((f) => (
                <StatementRow key={f.key} label={`يُخصم منه: ${f.label}`} amount={f.amount} />
              ))}
              {/* «للشركاء» في الصفحة الإدارية تعني المجموع؛ هنا الرقم
                  حصّةُ قارئه وحده، فيقول ذلك. */}
              <StatementRow label="= صافي ربحك من هذا الشهر" amount={statement.netProfit} kind="final" />
            </tbody>
          </table>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
            الأرقام أعلاه حصّتك ({sharePercent.toFixed(1)}%) من نتائج الشركة الشهرية،
            محسوبة على عدد العمالة، ومبنيّة على القيود المُرحّلة في الدفاتر.
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
  receiptsCount, hasShare, latestMonth, latestStatement,
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

      <Card className="p-5">
        <SectionHeader
          title="نتيجة آخر شهر"
          subtitle={`صافي ربحك من ${formatMonthLabel(latestMonth)}`}
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
              tone={latestStatement.netProfit >= 0 ? 'emerald' : 'amber'}
              label="صافي ربحك"
              value={formatCurrency(latestStatement.netProfit)}
              sub={`نسبتك ${sharePercent.toFixed(1)}%`}
            />
          </div>
        )}
      </Card>
    </>
  );
}

/** «رأس مالي» — السندات وكشف الحساب والتحصيل الشهري. */
function CapitalView({
  partner, required, paid, remaining, settled, myReceipts, receiptsTrend, onPrint,
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
function TrendsView({ hasShare, profitTrend }) {
  if (!hasShare) {
    return (
      <Card className="p-6">
        <SectionHeader title="صافي ربحك شهرياً" subtitle="آخر ٦ أشهر" />
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
      {/* لا يُعاد عنوان الشريط العلوي هنا: عنوانان متطابقان فوق بعضهما
          يأكلان أول شاشةٍ على الجوال ولا يضيفان حرفاً. */}
      <SectionHeader title="صافي ربحك شهرياً" subtitle="الإيرادات والتكاليف وصافي الربح، بحصّتك" />
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
              id: 'net', label: 'صافي ربحك', values: profitTrend.net,
              stroke: 'stroke-[#059669]', dot: 'fill-[#059669]', swatch: 'bg-[#059669]',
            },
          ]}
        />
      )}
    </Card>
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
  const { scalingFactor, totalWorkers } = usePartnerView();
  const { payments, loading: paymentsLoading, error: paymentsError } = usePartnerPayments();
  const {
    accounts, entries, lines, loading: ledgerLoading, error: ledgerError,
  } = useLedger();
  const { rules: feeRules } = useFeeRules();

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
    const set = new Set();
    for (const e of entries) {
      const key = String(e.periodKey || String(e.entryDate || '').slice(0, 7));
      if (/^\d{4}-\d{2}$/.test(key)) set.add(key);
    }
    const months = [...set].sort().reverse();
    return months.length ? months : [todayMonth()];
  }, [entries]);

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
      ? monthlyStatement({
        accounts, entries, lines, periodKey: statementMonth, feeRules, scalingFactor,
      })
      : EMPTY_STATEMENT),
    [accounts, entries, lines, statementMonth, feeRules, scalingFactor, view],
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
    const rows = months.map((m) => monthlyStatement({
      accounts, entries, lines, periodKey: m.key, feeRules, scalingFactor,
    }));
    return {
      months,
      revenue: rows.map((r) => r.netRevenue),
      costs:   rows.map((r) => r.totalCosts),
      net:     rows.map((r) => r.netProfit),
      total:   rows.reduce((s, r) => s + Math.abs(r.netRevenue) + Math.abs(r.totalCosts), 0),
    };
  }, [accounts, entries, lines, feeRules, scalingFactor, view]);

  const anyError = paymentsError || ledgerError;
  const loading = paymentsLoading || ledgerLoading;
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
          />
        )}

        {view === 'income' && (
          <IncomeStatementCard
            sharePercent={sharePercent}
            hasShare={hasShare}
            availableMonths={availableMonths}
            activeMonth={activeMonth}
            onMonthChange={setSelectedMonth}
            statement={statement}
          />
        )}

        {view === 'trends' && (
          <TrendsView hasShare={hasShare} profitTrend={profitTrend} />
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
  const { viewedPartner, investorLinkMissing } = usePartnerView();
  const safeView = VIEW_META[view] ? view : 'overview';
  const meta = metaFor(safeView);

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

  return <InvestorPortal partner={viewedPartner} view={safeView} />;
}
