import { useMemo } from 'react';
import { Wallet, TrendingDown, TrendingUp } from 'lucide-react';
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
import { sumVariableTotal, sumCompletedWashQuantity } from '../lib/variableExpenseTotals';
import { isSupabaseConfigured, missingEnvNames } from '../lib/supabaseClient';

// ─── Revenue-to-expense ratio progress bar ────────────────────────────────
function RevenueExpenseBar({ revenue, expenses }) {
  if (!revenue || revenue <= 0) {
    return (
      <div className="space-y-2">
        <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden" />
        <p className="text-[12px] text-slate-500 leading-relaxed">
          لم تُسجَّل إيرادات بعد — أضف غسلات لرؤية نسبة المصاريف ومعدّل هامش الربح.
        </p>
      </div>
    );
  }

  const expenseRatio = (expenses / revenue) * 100;
  const isLoss       = expenses > revenue;
  const expensePct   = Math.min(100, expenseRatio);
  const profitPct    = Math.max(0, 100 - expensePct);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-[11px] font-semibold">
        <span className={isLoss ? 'text-rose-700' : 'text-slate-600'}>
          نسبة المصاريف: <span className="tabular-nums">{expenseRatio.toFixed(1)}%</span>
        </span>
        <span className="text-emerald-700">
          هامش الربح: <span className="tabular-nums">{profitPct.toFixed(1)}%</span>
        </span>
      </div>
      <div
        className="w-full h-4 bg-slate-100 rounded-full overflow-hidden flex"
        dir="ltr"
        aria-label="نسبة المصاريف إلى الإيرادات"
      >
        <div
          className={`h-full ${isLoss ? 'bg-rose-500' : 'bg-slate-500'} transition-all duration-500`}
          style={{ width: `${expensePct}%` }}
        />
        <div
          className="h-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${profitPct}%` }}
        />
      </div>
      {isLoss && (
        <p className="text-[12px] text-rose-700 font-semibold leading-relaxed">
          تجاوزت المصاريف الإيرادات بنسبة{' '}
          <span className="tabular-nums">{(expenseRatio - 100).toFixed(1)}%</span> — راجع بنود التكاليف لاحتواء الخسارة.
        </p>
      )}
    </div>
  );
}

// ─── A single P&L row ─────────────────────────────────────────────────────
function StatementRow({ label, amount, sign = '+', tone = 'emerald', emphasize = false }) {
  // tone: 'emerald' (revenue / profit), 'rose' (expense / loss), 'slate' (neutral)
  const amountClass = tone === 'rose'
    ? 'text-rose-700'
    : tone === 'slate'
      ? 'text-slate-700'
      : 'text-emerald-700';
  // Literal class strings so Tailwind's JIT scanner picks them up.
  let rowClass = '';
  if (emphasize) {
    rowClass = tone === 'rose'
      ? 'border-t-2 border-slate-200 bg-rose-50/60'
      : 'border-t-2 border-slate-200 bg-emerald-50/60';
  }
  return (
    <tr className={rowClass}>
      <td className={`py-3 px-4 ${emphasize ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
        {label}
      </td>
      <td className={`py-3 px-4 text-left tabular-nums ${emphasize ? 'font-extrabold text-lg' : 'font-bold'} ${amountClass}`}>
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

  const categoryMap = useMemo(() => {
    const m = new Map();
    varCategories.forEach((c) => m.set(c.id, c));
    return m;
  }, [varCategories]);

  const washCount = useMemo(() => sumCompletedWashQuantity(washes), [washes]);

  const revenue = useMemo(
    () => washes
      .filter((w) => w.status === 'مكتملة')
      .reduce((sum, w) => sum + (w.quantity || 0) * (w.price || 0), 0),
    [washes],
  );

  const variableTotal = useMemo(
    () => sumVariableTotal(variables, categoryMap, washCount),
    [variables, categoryMap, washCount],
  );
  const monthlyTotal  = useMemo(
    () => monthlies.reduce((sum, m) => sum + (m.totalMonthlyCost || 0), 0),
    [monthlies],
  );
  const annualTotal   = useMemo(
    () => annuals.reduce((sum, a) => sum + (a.annualCost || 0), 0),
    [annuals],
  );

  const totalExpenses = variableTotal + monthlyTotal + annualTotal;
  const netProfit     = revenue - totalExpenses;
  const isProfit      = netProfit >= 0;

  const anyError = washesError || varError || monthlyError || annualError;
  const anyLoading = washesLoading || varLoading || monthlyLoading || annualLoading;
  const noData = !washes.length && !variables.length && !monthlies.length && !annuals.length;

  function retryAll() {
    refetchWashes?.();
    refetchVariables?.();
    refetchMonthly?.();
    refetchAnnual?.();
  }

  return (
    <>
      <TopBar
        title="الملخص المالي وصافي الربح"
        subtitle="نظرة شاملة على الأداء المالي عبر كل الوحدات"
      />

      <main className="p-8 space-y-6">
        {!isSupabaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {anyError && (
          <ErrorState
            title="تعذّر تحميل بعض البيانات المالية"
            error={anyError}
            onRetry={retryAll}
          />
        )}

        {anyLoading && noData ? (
          <LoadingState rows={4} />
        ) : (
          <>
            {/* ── Top 3 KPI cards ─────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <StatCard
                icon={Wallet}
                iconBg="bg-primary-50"
                iconColor="text-primary-700"
                label="إجمالي الإيرادات"
                value={formatCurrency(revenue)}
                sub="من سجل الغسلات المكتملة"
              />
              <StatCard
                icon={TrendingDown}
                iconBg="bg-slate-100"
                iconColor="text-slate-700"
                label="إجمالي التكاليف والمصاريف"
                value={formatCurrency(totalExpenses)}
                sub="متغيّرة + شهرية + سنوية"
              />
              <StatCard
                icon={isProfit ? TrendingUp : TrendingDown}
                iconBg={isProfit ? 'bg-emerald-50' : 'bg-rose-50'}
                iconColor={isProfit ? 'text-emerald-600' : 'text-rose-600'}
                label="صافي الربح الفعلي"
                value={`${isProfit ? '' : '−'}${formatCurrency(Math.abs(netProfit))}`}
                sub="صافي الأرباح بعد خصم كافة التكاليف التشغيلية والثابتة"
              />
            </div>

            {/* ── P&L breakdown table ─────────────────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title="ملخص الهيكل المالي"
                subtitle="بيان مبسّط للإيرادات والمصاريف وصولاً إلى صافي الربح النظيف"
              />
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-[11px] font-bold text-slate-500 uppercase border-b border-slate-100">
                      <th className="py-3 px-4">البند</th>
                      <th className="py-3 px-4 text-left">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <StatementRow
                      label="الإيرادات التشغيلية (من سجل الغسلات)"
                      amount={revenue}
                      sign="+"
                      tone="emerald"
                    />
                    <StatementRow
                      label="المصاريف المتغيرة والعمولات"
                      amount={variableTotal}
                      sign="−"
                      tone="rose"
                    />
                    <StatementRow
                      label="المصاريف التشغيلية الشهرية الثابتة"
                      amount={monthlyTotal}
                      sign="−"
                      tone="rose"
                    />
                    <StatementRow
                      label="المصاريف السنوية الثابتة"
                      amount={annualTotal}
                      sign="−"
                      tone="rose"
                    />
                    <StatementRow
                      label="صافي الربح النظيف"
                      amount={netProfit}
                      sign={isProfit ? '=' : '−'}
                      tone={isProfit ? 'emerald' : 'rose'}
                      emphasize
                    />
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ── Revenue / Expense ratio ─────────────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title="نسبة المصاريف إلى الإيرادات"
                subtitle="ما الجزء الذي تستهلكه المصاريف من كل ريال إيراد، وما يتبقى كهامش ربح"
              />
              <RevenueExpenseBar revenue={revenue} expenses={totalExpenses} />

              {revenue > 0 && (
                <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <p className="text-[11px] text-slate-500">الإيرادات</p>
                    <p className="text-base font-extrabold text-slate-900 tabular-nums mt-0.5">
                      {formatCurrency(revenue)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <p className="text-[11px] text-slate-500">المصاريف</p>
                    <p className="text-base font-extrabold text-slate-900 tabular-nums mt-0.5">
                      {formatCurrency(totalExpenses)}
                    </p>
                  </div>
                  <div className={`rounded-xl border p-3 ${isProfit ? 'border-emerald-100 bg-emerald-50/60' : 'border-rose-100 bg-rose-50/60'}`}>
                    <p className={`text-[11px] ${isProfit ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {isProfit ? 'صافي الربح' : 'صافي الخسارة'}
                    </p>
                    <p className={`text-base font-extrabold tabular-nums mt-0.5 ${isProfit ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {isProfit ? '' : '−'}{formatCurrency(Math.abs(netProfit))}
                    </p>
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </>
  );
}
