import { useMemo, useState } from 'react';
import {
  Wallet, TrendingDown, TrendingUp, Calendar, ListFilter, Download,
} from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, SecondaryButton } from './UI';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import FinancialDetailsModal from './FinancialDetailsModal';
import { LineTrend } from './charts/TrendCharts';
import { useWashes } from '../hooks/useWashes';
import { useVariableExpenses } from '../hooks/useVariableExpenses';
import { useVariableExpenseCategories } from '../hooks/useVariableExpenseCategories';
import { useMonthlyExpenses } from '../hooks/useMonthlyExpenses';
import { useMonthlyExpenseCategories } from '../hooks/useMonthlyExpenseCategories';
import { useAnnualExpenses } from '../hooks/useAnnualExpenses';
import { usePartnerView } from '../contexts/PartnerViewContext';
import {
  todayMonth,
  formatMonthLabel,
  listAvailableMonths,
  variableItemsForMonth,
} from '../lib/variableExpenseTotals';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';

// ─── Income statement row ────────────────────────────────────────────────
// `kind`: 'plus' (revenue) | 'minus' (cost) | 'subtotal' (gross profit)
//       | 'expenseSubtotal' (total outflow tally) | 'final' (net profit)
//       — drives sign, color, and emphasis.
// `onClick`: when provided, the row becomes a button-styled drill-down
// trigger (cursor + hover tint + leading filter icon).
function StatementRow({ label, amount, kind = 'minus', tone = 'auto', onClick }) {
  const isPlus            = kind === 'plus';
  const isSubtotal        = kind === 'subtotal';
  const isExpenseSubtotal = kind === 'expenseSubtotal';
  const isFinal           = kind === 'final';

  // tone='auto' lets the final row pick emerald/rose from amount sign.
  const positive   = amount >= 0;
  const finalGood  = isFinal && positive;
  const finalBad   = isFinal && !positive;

  // Expense subtotals are tallies of outflow, so always show the minus
  // sign — they should never be confused with a profit subtotal.
  const sign = isPlus
    ? '+'
    : (isSubtotal || isFinal)
      ? '='
      : '−';

  // `=` alone erases the sign of a losing subtotal/final row — restore
  // the minus inside the amount so the figure matches the KPI and CSV.
  const negMark = (isSubtotal || isFinal) && amount < 0 ? '−' : '';

  // Plain line items get the standard table hairline. Banner rows (both
  // subtotals + the final row) are skipped on purpose: they carry their own
  // coloured `border-t-2`, and a second border-colour utility on the same
  // element would fight it.
  let rowClass = (isSubtotal || isExpenseSubtotal || isFinal)
    ? ''
    : 'border-b border-slate-50 dark:border-slate-800/60';
  // Both subtotal kinds share the same slate banner styling — the gross
  // profit subtotal and the expenses tally read as parallel structural
  // dividers in the statement.
  if (isSubtotal || isExpenseSubtotal) {
    rowClass = 'border-t-2 border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800';
  }
  if (finalGood) {
    rowClass = 'border-t-2 border-emerald-100 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30';
  }
  if (finalBad) {
    rowClass = 'border-t-2 border-rose-100 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30';
  }

  let amountClass = 'text-rose-700 dark:text-rose-400';
  if (isPlus)            amountClass = 'text-emerald-700 dark:text-emerald-400';
  if (isSubtotal)        amountClass = positive
    ? 'text-slate-900 dark:text-slate-100'
    : 'text-rose-700 dark:text-rose-400';
  // Expense subtotal mirrors the gross-profit subtotal's high-contrast
  // slate text so the figure is clearly readable against the slate banner.
  // The leading `−` sign carries the outflow semantics without needing red.
  if (isExpenseSubtotal) amountClass = 'text-slate-900 dark:text-slate-100';
  if (finalGood)         amountClass = 'text-emerald-600 dark:text-emerald-400';
  if (finalBad)          amountClass = 'text-rose-600 dark:text-rose-400';
  if (tone === 'slate' && !isFinal && !isSubtotal && !isExpenseSubtotal) {
    amountClass = 'text-slate-700 dark:text-slate-300';
  }

  let labelClass = 'text-slate-700 dark:text-slate-300';
  if (isSubtotal || isExpenseSubtotal) {
    labelClass = 'font-bold text-slate-900 dark:text-slate-100';
  }
  if (finalGood) labelClass = 'font-black text-emerald-600 dark:text-emerald-400';
  if (finalBad)  labelClass = 'font-black text-rose-600 dark:text-rose-400';

  const amountWeight = isFinal
    ? 'font-black text-lg'
    : (isSubtotal || isExpenseSubtotal)
      ? 'font-extrabold'
      : 'font-bold';

  const clickable = typeof onClick === 'function';
  const interactiveClass = clickable
    ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group'
    : '';

  return (
    <tr
      className={`${rowClass} ${interactiveClass}`.trim()}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable
        ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }
        : undefined}
      aria-label={clickable ? `عرض تفاصيل: ${label}` : undefined}
    >
      <td className={`py-3 px-4 whitespace-nowrap ${labelClass}`}>
        <span className="inline-flex items-center gap-2">
          {clickable && (
            <ListFilter
              size={13}
              strokeWidth={2.2}
              className="text-slate-500 dark:text-slate-400 group-hover:text-primary-700 dark:group-hover:text-primary-400 transition-colors shrink-0"
              aria-hidden="true"
            />
          )}
          <span>{label}</span>
        </span>
      </td>
      <td className={`py-3 px-4 whitespace-nowrap text-left tabular-nums ${amountWeight} ${amountClass}`}>
        {sign}{negMark}{formatCurrency(Math.abs(amount))}
      </td>
    </tr>
  );
}

export default function FinancialSummaryPage() {
  const { items: washes,    loading: washesLoading,   error: washesError,   refetch: refetchWashes }   = useWashes();
  const { items: variables, loading: varLoading,      error: varError,      refetch: refetchVariables } = useVariableExpenses();
  const { categories: varCategories } = useVariableExpenseCategories();
  const { items: monthlies, loading: monthlyLoading,  error: monthlyError,  refetch: refetchMonthly }  = useMonthlyExpenses();
  const { categories: monthlyCats } = useMonthlyExpenseCategories();
  const { items: annuals,   loading: annualLoading,   error: annualError,   refetch: refetchAnnual }   = useAnnualExpenses();
  // isPartnerView also gates the drill-down modal: its rows are the RAW
  // company-level records (each row IS what it is — a 200 ر.س wash can't
  // honestly display as 72 ر.س), so opening it under a scaled headline
  // would both contradict the statement and leak full-company figures to
  // a partner. Partners get the scaled statement only.
  const { scalingFactor, isPartnerView } = usePartnerView();

  const [selectedMonth, setSelectedMonth] = useState(todayMonth());
  const [detailCategory, setDetailCategory] = useState(null);

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

  // Pro-rata: every input that feeds the P&L is multiplied by the
  // viewing partner's workforce share. Because the downstream math
  // (grossProfit, netProfitBeforeFees, management/supervisor fees,
  // finalNetProfit) is linear in these four inputs, scaling at the
  // source cascades correctly to every line below. Admin view →
  // scalingFactor=1 → identity arithmetic.
  const revenue = useMemo(
    () => washes
      .filter((w) => w.status === 'مكتملة' && (w.washDate || '').slice(0, 7) === selectedMonth)
      .reduce((s, w) => s + (w.quantity || 0) * (w.price || 0), 0) * scalingFactor,
    [washes, selectedMonth, scalingFactor],
  );

  const variableTotal = useMemo(
    () => periodVariableItems.reduce((s, r) => s + (r.totalVariableCost || 0), 0) * scalingFactor,
    [periodVariableItems, scalingFactor],
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
    }, 0) * scalingFactor,
    [monthlies, selectedMonth, scalingFactor],
  );

  const annualAmortized = useMemo(
    () => annuals.reduce((s, a) => s + (a.annualCost || 0), 0) / 12 * scalingFactor,
    [annuals, scalingFactor],
  );

  const grossProfit          = revenue - variableTotal;
  const fixedExpensesTotal   = monthlyFixed + annualAmortized;
  const totalCosts           = variableTotal + fixedExpensesTotal;
  const netProfitBeforeFees  = grossProfit - fixedExpensesTotal;

  // Performance-based deductions: only kick in when the period made a
  // profit. A losing month should not trigger an automatic management
  // fee or supervisor salary withdrawal.
  const managementFees   = netProfitBeforeFees > 0 ? netProfitBeforeFees * 0.10 : 0;
  const supervisorSalary = netProfitBeforeFees > 0 ? netProfitBeforeFees * 0.05 : 0;
  const finalNetProfit   = netProfitBeforeFees - managementFees - supervisorSalary;
  const isProfit         = finalNetProfit >= 0;

  const monthLabel = formatMonthLabel(selectedMonth);

  // ── 6-month trend ending at the selected month ────────────────────────
  // Re-runs the exact per-month P&L math above for each of the six months
  // so the chart can never disagree with the statement.
  const trend = useMemo(() => {
    const [yy, mm] = selectedMonth.split('-').map(Number);
    if (!yy || !mm) return null;
    const fmt = new Intl.DateTimeFormat('ar', { month: 'short', numberingSystem: 'latn' });
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(yy, mm - 1 - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: fmt.format(d),
      });
    }
    const annualPart = annuals.reduce((s, a) => s + (a.annualCost || 0), 0) / 12 * scalingFactor;
    const rows = months.map(({ key }) => {
      const rev = washes
        .filter((w) => w.status === 'مكتملة' && (w.washDate || '').slice(0, 7) === key)
        .reduce((s, w) => s + (w.quantity || 0) * (w.price || 0), 0) * scalingFactor;
      const varTotal = variableItemsForMonth({
        manualItems: variables, categories: varCategories, selectedMonth: key, washes,
      }).reduce((s, r) => s + (r.totalVariableCost || 0), 0) * scalingFactor;
      const fixed = monthlies.reduce((s, m) => {
        if (m.recurrence === 'one_time' && String(m.loggedDate || '').slice(0, 7) !== key) return s;
        return s + (m.totalMonthlyCost || 0);
      }, 0) * scalingFactor;
      const costs = varTotal + fixed + annualPart;
      const beforeFees = rev - costs;
      const fees = beforeFees > 0 ? beforeFees * 0.15 : 0;
      return { revenue: rev, costs, net: beforeFees - fees };
    });
    return {
      months,
      revenue: rows.map((r) => r.revenue),
      costs:   rows.map((r) => r.costs),
      net:     rows.map((r) => r.net),
      any:     rows.some((r) => r.revenue !== 0 || r.costs !== 0),
    };
  }, [selectedMonth, washes, variables, varCategories, monthlies, annuals, scalingFactor]);

  const anyError    = washesError || varError || monthlyError || annualError;
  const anyLoading  = washesLoading || varLoading || monthlyLoading || annualLoading;
  const noData      = !washes.length && !variables.length && !monthlies.length && !annuals.length;

  function retryAll() {
    refetchWashes?.();
    refetchVariables?.();
    refetchMonthly?.();
    refetchAnnual?.();
  }

  // ── Category-label maps for the drill-down modal ─────────────────────
  const varCategoryMap = useMemo(() => {
    const m = new Map(); varCategories.forEach((c) => m.set(c.id, c)); return m;
  }, [varCategories]);
  const monthlyCategoryMap = useMemo(() => {
    const m = new Map(); monthlyCats.forEach((c) => m.set(c.id, c)); return m;
  }, [monthlyCats]);

  // ── Pre-shaped row data for the drill-down modal ─────────────────────
  // Each table renders columns directly off these objects — no further
  // resolution / filtering happens inside the modal.
  const detailData = useMemo(() => {
    const revenue = washes
      .filter((w) => w.status === 'مكتملة' && (w.washDate || '').slice(0, 7) === selectedMonth)
      .map((w) => ({
        id:       w.id,
        date:     w.washDate,
        biker:    w.bikerName,
        quantity: w.quantity || 0,
        price:    w.price || 0,
        total:    (w.quantity || 0) * (w.price || 0),
      }));

    const variable = periodVariableItems.map((v) => ({
      id:        v.id,
      name:      v.expenseName,
      category:  varCategoryMap.get(v.categoryId)?.label || '—',
      quantity:  v.quantity || 0,
      unitCost:  v.unitCost || 0,
      total:     v.totalVariableCost || 0,
      isVirtual: Boolean(v.isVirtual),
    }));

    const monthly = monthlies
      .filter((m) => {
        if (m.recurrence !== 'one_time') return true;
        return String(m.loggedDate || '').slice(0, 7) === selectedMonth;
      })
      .map((m) => ({
        id:        m.id,
        name:      m.expenseName,
        category:  monthlyCategoryMap.get(m.categoryId)?.label || '—',
        status:    m.paymentStatus,
        amount:    m.totalMonthlyCost || 0,
        isOneTime: m.recurrence === 'one_time',
      }));

    const annual = annuals.map((a) => ({
      id:      a.id,
      name:    a.expenseName,
      annual:  a.annualCost || 0,
      monthly: (a.annualCost || 0) / 12,
    }));

    return { revenue, variable, monthly, annual };
  }, [
    washes, selectedMonth, periodVariableItems, varCategoryMap,
    monthlies, monthlyCategoryMap, annuals,
  ]);

  return (
    <>
      <TopBar
        title="قائمة الدخل الشهرية"
        subtitle="عرض محاسبي للإيرادات والتكاليف وصافي الربح وفق فترة شهرية محددة"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {anyError && (
          <ErrorState
            title="تعذّر تحميل بعض البيانات المالية"
            error={anyError}
            onRetry={retryAll}
          />
        )}

        {/* ── Period selector ─────────────────────────────────────── */}
        <div
          className="rounded-card border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-5 transition-colors duration-200"
          style={{ boxShadow: 'var(--sw-shadow-card)' }}
        >
          <div className="flex items-start gap-4">
            <div className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-12 h-12 rounded-control flex items-center justify-center shrink-0">
              <Calendar size={22} strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0">
              <label
                htmlFor="period-selector"
                className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                فترة التقرير (الشهر)
              </label>
              <select
                id="period-selector"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full max-w-xs px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-bold tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
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
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
              <StatCard
                className="col-span-2 md:col-span-1"
                icon={Wallet}
                tone="primary"
                label="إجمالي الإيرادات"
                value={formatCurrency(revenue)}
                sub={`إيرادات الغسلات المكتملة لشهر ${monthLabel}`}
              />
              <StatCard
                icon={TrendingDown}
                tone="slate"
                label="إجمالي تكاليف الشهر"
                value={formatCurrency(totalCosts)}
                sub="متغيّرة + شهرية ثابتة + مخصص سنوي"
              />
              <StatCard
                icon={isProfit ? TrendingUp : TrendingDown}
                tone={isProfit ? 'emerald' : 'rose'}
                label="صافي الربح النهائي للشركاء"
                value={`${isProfit ? '' : '−'}${formatCurrency(Math.abs(finalNetProfit))}`}
                sub="بعد خصم رسوم الإدارة (10%) وراتب المشرف (5%)"
              />
            </div>

            {/* ── Vertical Income Statement table ─────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title={`هيكل قائمة الدخل — ${monthLabel}`}
                subtitle="بيان رسمي للإيرادات التشغيلية، التكاليف، وصافي الربح للفترة"
                action={
                  <SecondaryButton
                    icon={Download}
                    onClick={() => downloadCsv(
                      `قائمة-الدخل-${selectedMonth}`,
                      ['البند', 'المبلغ'],
                      // Mirrors the on-screen statement line-for-line (plus
                      // the pre-fees net, which the screen folds into the
                      // fee percentages). Amounts are passed as numbers so
                      // the CSV layer's formula-injection guard (text-only)
                      // leaves them intact.
                      [
                        ['الإيرادات التشغيلية', Number(revenue.toFixed(2))],
                        ['التكاليف المتغيرة والعمولات', Number((-variableTotal).toFixed(2))],
                        ['مجمل الربح التشغيلي', Number(grossProfit.toFixed(2))],
                        ['المصاريف الشهرية الثابتة', Number((-monthlyFixed).toFixed(2))],
                        ['مخصص المصاريف السنوية الموزعة', Number((-annualAmortized).toFixed(2))],
                        ['إجمالي المصروفات الثابتة والموزعة', Number((-fixedExpensesTotal).toFixed(2))],
                        ['صافي الربح قبل الرسوم', Number(netProfitBeforeFees.toFixed(2))],
                        ['رسوم الإدارة (10%)', Number((-managementFees).toFixed(2))],
                        ['راتب المشرف (5%)', Number((-supervisorSalary).toFixed(2))],
                        ['صافي الربح النهائي', Number(finalNetProfit.toFixed(2))],
                      ],
                    )}
                  >
                    تصدير CSV
                  </SecondaryButton>
                }
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
                      onClick={isPartnerView ? undefined : () => setDetailCategory('revenue')}
                    />
                    <StatementRow
                      label="يُخصم منه: التكاليف المتغيرة والعمولات"
                      amount={variableTotal}
                      kind="minus"
                      onClick={isPartnerView ? undefined : () => setDetailCategory('variable')}
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
                      onClick={isPartnerView ? undefined : () => setDetailCategory('monthly')}
                    />
                    <StatementRow
                      label="يُخصم منه: مخصص المصاريف السنوية الموزعة (سنوي ÷ ١٢)"
                      amount={annualAmortized}
                      kind="minus"
                      onClick={isPartnerView ? undefined : () => setDetailCategory('annual')}
                    />
                    <StatementRow
                      label="إجمالي المصروفات الثابتة والموزعة"
                      amount={fixedExpensesTotal}
                      kind="expenseSubtotal"
                    />
                    <StatementRow
                      label="يُخصم منه: رسوم الإدارة (10% من صافي الربح)"
                      amount={managementFees}
                      kind="minus"
                    />
                    <StatementRow
                      label="يُخصم منه: راتب المشرف (5% من صافي الربح)"
                      amount={supervisorSalary}
                      kind="minus"
                    />
                    <StatementRow
                      label="= صافي الربح النهائي للشركاء"
                      amount={finalNetProfit}
                      kind="final"
                    />
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ── 6-month trend ─────────────────────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title="اتجاه ٦ أشهر"
                subtitle={`الإيرادات مقابل التكاليف وصافي الربح حتى ${monthLabel}`}
              />
              {trend?.any ? (
                <LineTrend
                  months={trend.months}
                  formatValue={formatCurrency}
                  series={[
                    {
                      id: 'revenue',
                      label: 'الإيرادات',
                      values: trend.revenue,
                      stroke: 'stroke-[#4f46e5] dark:stroke-[#6366f1]',
                      dot:    'fill-[#4f46e5] dark:fill-[#6366f1]',
                      swatch: 'bg-[#4f46e5] dark:bg-[#6366f1]',
                    },
                    {
                      id: 'costs',
                      label: 'التكاليف',
                      values: trend.costs,
                      stroke: 'stroke-[#e63946]',
                      dot:    'fill-[#e63946]',
                      swatch: 'bg-[#e63946]',
                    },
                    {
                      id: 'net',
                      label: 'صافي الربح',
                      values: trend.net,
                      stroke: 'stroke-[#059669]',
                      dot:    'fill-[#059669]',
                      swatch: 'bg-[#059669]',
                    },
                  ]}
                />
              ) : (
                <EmptyState
                  compact
                  icon={TrendingUp}
                  title="لا توجد حركة مالية في آخر ٦ أشهر"
                  hint="سجّل الغسلات والمصاريف وسيظهر الاتجاه الشهري هنا تلقائياً."
                />
              )}
            </Card>
          </>
        )}
      </main>

      <FinancialDetailsModal
        category={detailCategory}
        monthLabel={monthLabel}
        data={detailData}
        onClose={() => setDetailCategory(null)}
      />
    </>
  );
}
