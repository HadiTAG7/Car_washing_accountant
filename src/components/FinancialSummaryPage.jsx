import { useMemo, useState } from 'react';
import {
  Wallet, TrendingDown, TrendingUp, Calendar, ListFilter, Download, Scale,
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
import { useLedger } from '../hooks/useLedger';
import { useFeeRules } from '../hooks/useFeeRules';
import { monthlyStatement, reconcileOperational } from '../lib/accounting/monthlyStatement';
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
  // ── the statement's actual source ──
  // Everything on the face of the income statement comes from here: the chart,
  // the posted journal entries and their lines. The operational hooks above
  // stay for the drill-down and the reconciliation strip, which are a
  // different question and are labelled as one.
  const {
    accounts, entries, lines,
    loading: ledgerLoading, error: ledgerError, refetch: refetchLedger,
  } = useLedger();
  const { rules: feeRules } = useFeeRules();
  // isPartnerView also gates the drill-down modal: its rows are the RAW
  // company-level records (each row IS what it is — a 200 ر.س wash can't
  // honestly display as 72 ر.س), so opening it under a scaled headline
  // would both contradict the statement and leak full-company figures to
  // a partner. Partners get the scaled statement only.
  const { scalingFactor, isPartnerView } = usePartnerView();

  const [selectedMonth, setSelectedMonth] = useState(todayMonth());
  const [detailCategory, setDetailCategory] = useState(null);

  // Every month the statement could have something to say about. The ledger is
  // included alongside the operational registers: a standalone sales invoice
  // posts into a month that may hold no wash at all, and a month you cannot
  // select is a month whose figures nobody can read.
  const availableMonths = useMemo(() => {
    const set = new Set(listAvailableMonths(washes, variables));
    for (const e of entries) {
      const key = String(e.periodKey || String(e.entryDate || '').slice(0, 7));
      if (/^\d{4}-\d{2}$/.test(key)) set.add(key);
    }
    return [...set].sort().reverse();
  }, [washes, variables, entries]);

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

  // ── the statement itself ──────────────────────────────────────────────
  // One pure function over the ledger bundle. Pro-rata for the partner view is
  // applied inside it, once, because every line is linear in that factor.
  const statement = useMemo(
    () => monthlyStatement({
      accounts, entries, lines, periodKey: selectedMonth, feeRules, scalingFactor,
    }),
    [accounts, entries, lines, selectedMonth, feeRules, scalingFactor],
  );

  const netRevenue          = statement.netRevenue;
  const variableTotal       = statement.directCosts;
  const fixedExpensesTotal  = statement.operatingExpenses;
  const totalCosts          = statement.totalCosts;
  const grossProfit         = statement.grossProfit;
  const netProfitBeforeFees = statement.netProfitBeforeFees;
  const finalNetProfit      = statement.netProfit;
  const isProfit            = finalNetProfit >= 0;

  const monthLabel = formatMonthLabel(selectedMonth);

  // ── مطابقة التشغيل بالدفاتر ──
  // The operational revenue for the month, kept beside the ledger figure
  // rather than instead of it. A gap means washes were recorded but not
  // posted — an action to take, not a number to quietly average in.
  const reconciliation = useMemo(() => {
    const operationalRevenue = washes
      .filter((w) => w.status === 'مكتملة' && (w.washDate || '').slice(0, 7) === selectedMonth)
      .reduce((s, w) => s + (w.quantity || 0) * (w.price || 0), 0) * scalingFactor;
    return reconcileOperational({ operationalRevenue, statement });
  }, [washes, selectedMonth, scalingFactor, statement]);

  // ── 6-month trend ending at the selected month ────────────────────────
  // The SAME function, run six times, so the chart cannot disagree with the
  // statement above it.
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
    const rows = months.map(({ key }) => monthlyStatement({
      accounts, entries, lines, periodKey: key, feeRules, scalingFactor,
    }));
    return {
      months,
      revenue: rows.map((r) => r.netRevenue),
      costs:   rows.map((r) => r.totalCosts),
      net:     rows.map((r) => r.netProfit),
      any:     rows.some((r) => r.netRevenue !== 0 || r.totalCosts !== 0),
    };
  }, [selectedMonth, accounts, entries, lines, feeRules, scalingFactor]);

  const anyError    = ledgerError || washesError || varError || monthlyError || annualError;
  const anyLoading  = ledgerLoading || washesLoading || varLoading || monthlyLoading || annualLoading;
  const noData      = !entries.length && !washes.length && !variables.length && !monthlies.length && !annuals.length;

  function retryAll() {
    refetchLedger?.();
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
                label="صافي الإيرادات"
                value={formatCurrency(netRevenue)}
                sub={statement.salesReturns > 0
                  ? `بعد خصم مردودات بقيمة ${formatCurrency(statement.salesReturns)} لشهر ${monthLabel}`
                  : `إيرادات مُرحّلة في الدفاتر لشهر ${monthLabel}`}
              />
              <StatCard
                icon={TrendingDown}
                tone="slate"
                label="إجمالي تكاليف الشهر"
                value={formatCurrency(totalCosts)}
                sub="تكاليف مباشرة + مصاريف تشغيلية مُرحّلة"
              />
              <StatCard
                icon={isProfit ? TrendingUp : TrendingDown}
                tone={isProfit ? 'emerald' : 'rose'}
                label="صافي الربح النهائي للشركاء"
                value={`${isProfit ? '' : '−'}${formatCurrency(Math.abs(finalNetProfit))}`}
                sub={statement.fees.length
                  ? `بعد خصم ${statement.fees.map((f) => f.label).join(' و')}`
                  : 'بلا رسوم مُعرَّفة'}
              />
            </div>

            {/* ── مطابقة التشغيل بالدفاتر ───────────────────────────
                Stated whenever the two disagree. The statement above reads the
                journal; this says what the operational register says and by
                how much they differ, so an unposted wash is a task rather than
                a silent discrepancy between two screens. */}
            {!reconciliation.matched && (
              <div
                role="note"
                className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs px-4 py-3 rounded-control leading-relaxed"
              >
                <Scale size={16} className="shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-bold">
                    فرق بين سجل التشغيل والدفاتر: {formatCurrency(Math.abs(reconciliation.difference))}
                  </p>
                  <p className="mt-1 tabular-nums">
                    الغسلات المكتملة المسجّلة: {formatCurrency(reconciliation.operational)} ·
                    {' '}صافي الإيراد المُرحّل: {formatCurrency(reconciliation.ledger)}
                    {reconciliation.salesReturns > 0
                      && ` · منها مردودات ${formatCurrency(reconciliation.salesReturns)}`}
                  </p>
                  <p className="mt-1">
                    القائمة أدناه رسمية وتقرأ القيود المُرحّلة فقط. الفرق يعني غسلات مسجّلة لم تُرحّل
                    بعد — رحّلها من صفحة الغسلات لتظهر في الدفاتر.
                  </p>
                </div>
              </div>
            )}

            {/* ── Vertical Income Statement table ─────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title={`هيكل قائمة الدخل — ${monthLabel}`}
                subtitle="بيان رسمي مبني على القيود المُرحّلة في دفتر الأستاذ — يطابق ميزان المراجعة والمركز المالي"
                action={
                  <SecondaryButton
                    icon={Download}
                    onClick={() => downloadCsv(
                      `قائمة-الدخل-${selectedMonth}`,
                      ['البند', 'المبلغ'],
                      // Mirrors the on-screen statement line-for-line, off the
                      // same `statement` object — the screen and the file can
                      // only ever show the same number. Amounts are passed as
                      // numbers so the CSV layer's formula-injection guard
                      // (text-only) leaves them intact.
                      [
                        ['إيرادات المبيعات', Number(statement.grossRevenue.toFixed(2))],
                        ['يُخصم منه: مردودات وخصومات المبيعات', Number((-statement.salesReturns).toFixed(2))],
                        ...(statement.otherRevenue !== 0
                          ? [['إيرادات أخرى', Number(statement.otherRevenue.toFixed(2))]] : []),
                        ['صافي الإيرادات', Number(netRevenue.toFixed(2))],
                        ['التكاليف المباشرة والعمولات', Number((-variableTotal).toFixed(2))],
                        ['مجمل الربح التشغيلي', Number(grossProfit.toFixed(2))],
                        ['المصاريف التشغيلية', Number((-fixedExpensesTotal).toFixed(2))],
                        ['صافي الربح قبل الرسوم', Number(netProfitBeforeFees.toFixed(2))],
                        ...statement.fees.map((f) => [f.label, Number((-f.amount).toFixed(2))]),
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
                    {/* No drill-down on these rows any more. They are LEDGER
                        figures; the drill-down lists operational records, and
                        after a credit note the two legitimately differ. Wiring
                        a ledger number to an operational list would imply the
                        list adds up to it. The operational detail has its own
                        clearly-labelled row of buttons below. */}
                    <StatementRow
                      label="إيرادات المبيعات"
                      amount={statement.grossRevenue}
                      kind="plus"
                    />
                    {/* Shown only when there are returns — but shown on its own
                        line when there are, because netting a credit note into
                        the revenue figure is what hid it in the first place. */}
                    {statement.salesReturns !== 0 && (
                      <StatementRow
                        label="يُخصم منه: مردودات وخصومات المبيعات (إشعارات دائنة)"
                        amount={statement.salesReturns}
                        kind="minus"
                      />
                    )}
                    {statement.otherRevenue !== 0 && (
                      <StatementRow
                        label="إيرادات أخرى"
                        amount={statement.otherRevenue}
                        kind="plus"
                      />
                    )}
                    <StatementRow
                      label="= صافي الإيرادات"
                      amount={netRevenue}
                      kind="subtotal"
                    />
                    <StatementRow
                      label="يُخصم منه: التكاليف المباشرة والعمولات"
                      amount={variableTotal}
                      kind="minus"
                    />
                    <StatementRow
                      label="= مجمل الربح التشغيلي"
                      amount={grossProfit}
                      kind="subtotal"
                    />
                    <StatementRow
                      label="يُخصم منه: المصاريف التشغيلية"
                      amount={fixedExpensesTotal}
                      kind="expenseSubtotal"
                    />
                    <StatementRow
                      label="= صافي الربح قبل الرسوم"
                      amount={netProfitBeforeFees}
                      kind="subtotal"
                    />
                    {statement.fees.map((f) => (
                      <StatementRow
                        key={f.key}
                        label={`يُخصم منه: ${f.label}`}
                        amount={f.amount}
                        kind="minus"
                      />
                    ))}
                    <StatementRow
                      label="= صافي الربح النهائي للشركاء"
                      amount={finalNetProfit}
                      kind="final"
                    />
                  </tbody>
                </table>
              </div>
              {(statement.costRows.length > 0 || statement.expenseRows.length > 0) && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
                  التكاليف والمصاريف أعلاه مجمّعة من حسابات:
                  {' '}
                  {[...statement.costRows, ...statement.expenseRows]
                    .map((r) => `${r.code} ${r.nameArabic || ''}`.trim()).join(' · ')}.
                </p>
              )}

              {/* ── التفاصيل التشغيلية ─────────────────────────────────
                  Deliberately separated from the statement above and labelled
                  as what it is. These lists are the operational registers, not
                  the ledger: a wash typed in but not posted appears here and
                  not there, and a credit note appears there and not here. That
                  gap is the point of the reconciliation, so the two are never
                  presented as the same figure. */}
              {!isPartnerView && (
                <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2">
                    تفاصيل تشغيلية للمطابقة — سجلات مُدخَلة، وليست أرقام القائمة أعلاه
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ['revenue',  'الغسلات المكتملة'],
                      ['variable', 'التكاليف المتغيرة'],
                      ['monthly',  'المصاريف الشهرية'],
                      ['annual',   'المصاريف السنوية'],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDetailCategory(key)}
                        className="inline-flex items-center gap-1.5 min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-primary-700 dark:hover:text-primary-400 hover:border-primary-200 dark:hover:border-primary-500/40 transition-colors"
                      >
                        <ListFilter size={13} strokeWidth={2.2} aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
