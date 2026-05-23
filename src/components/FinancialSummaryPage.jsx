import { useMemo, useState } from 'react';
import {
  Wallet, TrendingDown, TrendingUp, Calendar,
} from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard } from './UI';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { useWashes } from '../hooks/useWashes';
import { useVariableExpenses } from '../hooks/useVariableExpenses';
import { useVariableExpenseCategories } from '../hooks/useVariableExpenseCategories';
import { useMonthlyExpenses } from '../hooks/useMonthlyExpenses';
import { useAnnualExpenses } from '../hooks/useAnnualExpenses';
import {
  todayMonth,
  formatMonthLabel,
  listAvailableMonths,
  variableItemsForMonth,
} from '../lib/variableExpenseTotals';
import { isSupabaseConfigured, missingEnvNames } from '../lib/supabaseClient';

// ─── Income statement row ────────────────────────────────────────────────
// `kind`: 'plus' (revenue) | 'minus' (cost) | 'subtotal' (gross profit)
//       | 'final' (net profit) — drives sign, color, and emphasis.
function StatementRow({ label, amount, kind = 'minus', tone = 'auto' }) {
  const isPlus     = kind === 'plus';
  const isSubtotal = kind === 'subtotal';
  const isFinal    = kind === 'final';

  // tone='auto' lets the final row pick emerald/rose from amount sign.
  const positive   = amount >= 0;
  const finalGood  = isFinal && positive;
  const finalBad   = isFinal && !positive;

  const sign = isPlus ? '+' : (isSubtotal || isFinal) ? '=' : '−';

  let rowClass = '';
  if (isSubtotal) rowClass = 'border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50';
  if (finalGood)  rowClass = 'border-t-2 border-emerald-200 bg-emerald-50';
  if (finalBad)   rowClass = 'border-t-2 border-rose-200 bg-rose-50';

  let amountClass = 'text-rose-700';
  if (isPlus)     amountClass = 'text-emerald-700';
  if (isSubtotal) amountClass = positive ? 'text-slate-900 dark:text-slate-100' : 'text-rose-700';
  if (finalGood)  amountClass = 'text-emerald-700';
  if (finalBad)   amountClass = 'text-rose-700';
  if (tone === 'slate' && !isFinal && !isSubtotal) amountClass = 'text-slate-700 dark:text-slate-300';

  const labelClass = isFinal
    ? 'font-extrabold text-slate-900 dark:text-slate-100'
    : isSubtotal
      ? 'font-bold text-slate-900 dark:text-slate-100'
      : 'text-slate-700 dark:text-slate-300';
  const amountWeight = isFinal
    ? 'font-extrabold text-lg'
    : isSubtotal
      ? 'font-extrabold'
      : 'font-bold';

  return (
    <tr className={rowClass}>
      <td className={`py-3 px-4 whitespace-nowrap ${labelClass}`}>{label}</td>
      <td className={`py-3 px-4 whitespace-nowrap text-left tabular-nums ${amountWeight} ${amountClass}`}>
        {sign}{formatCurrency(Math.abs(amount))}
      </td>
    </tr>
  );
}

export default function FinancialSummaryPage() {
  const { items: washes,    loading: washesLoading,   error: washesError,   refetch: refetchWashes }   = useWashes();
  const { items: variables, loading: varLoading,      error: varError,      refetch: refetchVariables } = useVariableExpenses();
  const { categories: varCategories } = useVariableExpenseCategories();
  const { items: monthlies, loading: monthlyLoading,  error: monthlyError,  refetch: refetchMonthly }  = useMonthlyExpenses();
  const { items: annuals,   loading: annualLoading,   error: annualError,   refetch: refetchAnnual }   = useAnnualExpenses();

  const [selectedMonth, setSelectedMonth] = useState(todayMonth());

  const availableMonths = useMemo(
    () => listAvailableMonths(washes, variables),
    [washes, variables],
  );

  // Build the same display list the Variable Expenses page uses for this
  // month — manual non-dynamic rows logged in the month PLUS one virtual
  // row per (dynamic category × biker). The helper consumes raw `washes`
  // and handles the per-biker grouping, so the variable line of the P&L
  // automatically reflects every biker's commission contribution.
  const periodVariableItems = useMemo(
    () => variableItemsForMonth({
      manualItems: variables,
      categories:  varCategories,
      selectedMonth,
      washes,
    }),
    [variables, varCategories, selectedMonth, washes],
  );

  const revenue = useMemo(
    () => washes
      .filter((w) => w.status === 'مكتملة' && (w.washDate || '').slice(0, 7) === selectedMonth)
      .reduce((s, w) => s + (w.quantity || 0) * (w.price || 0), 0),
    [washes, selectedMonth],
  );

  const variableTotal = useMemo(
    () => periodVariableItems.reduce((s, r) => s + (r.totalVariableCost || 0), 0),
    [periodVariableItems],
  );

  // Recurring monthly rows count every month; one_time rows count only in
  // the month their loggedDate falls in. Keeps the income statement honest
  // when the user records a one-off payment under the monthly tab.
  const monthlyFixed = useMemo(
    () => monthlies.reduce((s, m) => {
      if (m.recurrence === 'one_time') {
        const ym = String(m.loggedDate || '').slice(0, 7);
        if (ym !== selectedMonth) return s;
      }
      return s + (m.totalMonthlyCost || 0);
    }, 0),
    [monthlies, selectedMonth],
  );

  const annualAmortized = useMemo(
    () => annuals.reduce((s, a) => s + (a.annualCost || 0), 0) / 12,
    [annuals],
  );

  const grossProfit = revenue - variableTotal;
  const totalCosts  = variableTotal + monthlyFixed + annualAmortized;
  const netProfit   = grossProfit - monthlyFixed - annualAmortized;
  const isProfit    = netProfit >= 0;

  const monthLabel = formatMonthLabel(selectedMonth);

  const anyError    = washesError || varError || monthlyError || annualError;
  const anyLoading  = washesLoading || varLoading || monthlyLoading || annualLoading;
  const noData      = !washes.length && !variables.length && !monthlies.length && !annuals.length;

  function retryAll() {
    refetchWashes?.();
    refetchVariables?.();
    refetchMonthly?.();
    refetchAnnual?.();
  }

  return (
    <>
      <TopBar
        title="قائمة الدخل الشهرية"
        subtitle="عرض محاسبي للإيرادات والتكاليف وصافي الربح وفق فترة شهرية محددة"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isSupabaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {anyError && (
          <ErrorState
            title="تعذّر تحميل بعض البيانات المالية"
            error={anyError}
            onRetry={retryAll}
          />
        )}

        {/* ── Period selector ─────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm dark:shadow-slate-950/40 p-5 transition-colors duration-200">
          <div className="flex items-start gap-4">
            <div className="bg-primary-700 dark:bg-primary-600 text-white w-12 h-12 rounded-2xl flex items-center justify-center shrink-0">
              <Calendar size={22} strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0">
              <label
                htmlFor="period-selector"
                className="block text-xs text-primary-700 dark:text-primary-300 font-bold tracking-wide"
              >
                فترة التقرير (الشهر)
              </label>
              <select
                id="period-selector"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="mt-1.5 w-full max-w-xs px-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-300 dark:focus:ring-primary-500/40 transition-colors duration-200"
              >
                {availableMonths.map((ym) => (
                  <option key={ym} value={ym}>{formatMonthLabel(ym)}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                اختر الشهر لعرض قائمة الدخل المخصصة له. المصاريف الثابتة الشهرية والسنوية موزّعة بالتساوي على كل شهر.
              </p>
            </div>
          </div>
        </div>

        {anyLoading && noData ? (
          <LoadingState rows={4} />
        ) : (
          <>
            {/* ── Top 3 KPI cards ─────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
              <StatCard
                icon={Wallet}
                iconBg="bg-primary-50"
                iconColor="text-primary-700"
                label="إجمالي الإيرادات"
                value={formatCurrency(revenue)}
                sub={`إيرادات الغسلات المكتملة لشهر ${monthLabel}`}
              />
              <StatCard
                icon={TrendingDown}
                iconBg="bg-slate-100 dark:bg-slate-800"
                iconColor="text-slate-700 dark:text-slate-300"
                label="إجمالي تكاليف الشهر"
                value={formatCurrency(totalCosts)}
                sub="متغيّرة + شهرية ثابتة + مخصص سنوي"
              />
              <StatCard
                icon={isProfit ? TrendingUp : TrendingDown}
                iconBg={isProfit ? 'bg-emerald-50' : 'bg-rose-50'}
                iconColor={isProfit ? 'text-emerald-600' : 'text-rose-600'}
                label="صافي الربح الشهري النظيف"
                value={`${isProfit ? '' : '−'}${formatCurrency(Math.abs(netProfit))}`}
                sub="صافي ربح الفترة بعد الإطفاء والتوزيع المحاسبي"
              />
            </div>

            {/* ── Vertical Income Statement table ─────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title={`هيكل قائمة الدخل — ${monthLabel}`}
                subtitle="بيان رسمي للإيرادات التشغيلية، التكاليف، وصافي الربح للفترة"
              />
              <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                      <th className="py-3 px-4 whitespace-nowrap">البند</th>
                      <th className="py-3 px-4 whitespace-nowrap text-left">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <StatementRow
                      label="الإيرادات التشغيلية"
                      amount={revenue}
                      kind="plus"
                    />
                    <StatementRow
                      label="يُخصم منه: التكاليف المتغيرة والعمولات"
                      amount={variableTotal}
                      kind="minus"
                    />
                    <StatementRow
                      label="= مجمل الربح التشغيلي"
                      amount={grossProfit}
                      kind="subtotal"
                    />
                    <StatementRow
                      label="يُخصم منه: المصاريف التشغيلية الشهرية الثابتة"
                      amount={monthlyFixed}
                      kind="minus"
                    />
                    <StatementRow
                      label="يُخصم منه: مخصص المصاريف السنوية الموزعة (سنوي ÷ ١٢)"
                      amount={annualAmortized}
                      kind="minus"
                    />
                    <StatementRow
                      label="= صافي الربح أو الخسارة للفترة"
                      amount={netProfit}
                      kind="final"
                    />
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </main>
    </>
  );
}
