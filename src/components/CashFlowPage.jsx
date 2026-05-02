import { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  Download, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Wallet, Calendar, BarChart3, Percent, Plus, Trash2,
} from 'lucide-react';
import {
  formatCurrency,
  formatCompact,
  formatNumber,
  formatPercent,
  exportToCSV,
} from '../data/initialData';
import TopBar from './TopBar';
import { Card, SectionHeader, SecondaryButton, PrimaryButton } from './UI';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import AddTransactionModal from './AddTransactionModal';
import { useTransactions } from '../hooks/useTransactions';
import { useAssets } from '../hooks/useAssets';
import { useStartupCosts } from '../hooks/useStartupCosts';

const MONTH_LABELS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function monthKey(dateStr) {
  // Accepts 'YYYY-MM-DD' or ISO. Returns 'YYYY-MM'.
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym) {
  if (!ym) return '';
  const [, m] = ym.split('-');
  return MONTH_LABELS_AR[parseInt(m, 10) - 1] || ym;
}

export default function CashFlowPage({ pendingEntry, onClearPendingEntry }) {
  const {
    transactions,
    loading: txLoading,
    error:   txError,
    addTransaction,
    deleteTransaction,
    refetch: refetchTx,
  } = useTransactions();

  const { items } = useStartupCosts();
  const { assets } = useAssets();

  const [localTxOpen, setLocalTxOpen] = useState(false);
  const [mutationError, setMutationError] = useState(null);

  const isTxModalOpen = localTxOpen || pendingEntry === 'transaction';

  function closeTxModal() { setLocalTxOpen(false); if (pendingEntry) onClearPendingEntry(); }

  async function handleAddTransaction(tx) {
    try { await addTransaction(tx); }
    catch (e) { setMutationError(e); }
  }
  async function handleDeleteTransaction(id) {
    try { await deleteTransaction(id); }
    catch (e) { setMutationError(e); }
  }

  // ── Bucket transactions per month ───────────────────────────
  const monthlyBuckets = useMemo(() => {
    const map = new Map();
    transactions.forEach((t) => {
      const k = monthKey(t.date);
      if (!k) return;
      if (!map.has(k)) map.set(k, { key: k, in: 0, out: 0 });
      const b = map.get(k);
      if (t.type === 'in') b.in += t.amount;
      else                 b.out += t.amount;
    });
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [transactions]);

  // ── Totals ──────────────────────────────────────────────────
  const txTotals = useMemo(() => {
    let inSum = 0, outSum = 0;
    transactions.forEach((t) => {
      if (t.type === 'in') inSum += t.amount;
      else                 outSum += t.amount;
    });
    return { inSum, outSum, net: inSum - outSum };
  }, [transactions]);

  // ── Running cash balance (historical) + forward runway ──────
  const { chartData, currentCash, monthlyBurn, runwayMonths } = useMemo(() => {
    const cumulativeCash = monthlyBuckets.reduce((sums, b) => {
      const prev = sums.length > 0 ? sums[sums.length - 1] : 0;
      return [...sums, prev + b.in - b.out];
    }, []);
    const historical = monthlyBuckets.map((b, i) => ({
      month:     monthLabel(b.key),
      cash:      cumulativeCash[i],
      inflow:    b.in,
      outflow:   b.out,
      net:       b.in - b.out,
      projected: false,
    }));

    const cashNow = historical.length > 0 ? historical[historical.length - 1].cash : 0;

    // Average monthly burn from the last ≤3 months (net negative only)
    const last3   = monthlyBuckets.slice(-3);
    const netSum  = last3.reduce((s, b) => s + (b.out - b.in), 0);
    const burn    = last3.length > 0 ? Math.max(0, netSum / last3.length) : 0;

    const runway = burn > 0 ? cashNow / burn : Infinity;

    // Project forward 6 months (if burn > 0)
    const projected = burn > 0
      ? Array.from({ length: 6 }, (_, i) => {
          const lastKey = monthlyBuckets.length > 0
            ? monthlyBuckets[monthlyBuckets.length - 1].key
            : monthKey(new Date().toISOString());
          const [y, mo] = lastKey.split('-').map(Number);
          const d = new Date(y, (mo - 1) + i + 1, 1);
          return {
            month:     MONTH_LABELS_AR[d.getMonth()],
            cash:      Math.max(0, cashNow - burn * (i + 1)),
            projected: true,
          };
        })
      : [];

    return {
      chartData:    [...historical, ...projected],
      currentCash:  cashNow,
      monthlyBurn:  burn,
      runwayMonths: runway,
    };
  }, [monthlyBuckets]);

  // ── Investment metrics (derived from startup/asset totals) ──
  const investmentTotals = useMemo(() => {
    const totalInvestment =
      items.reduce((s, i) => s + (i.actual || 0), 0) +
      assets.reduce((s, a) => s + (a.purchaseCost || 0), 0);
    const netMonthly      = txTotals.net / Math.max(1, monthlyBuckets.length);
    const paybackMonths   = netMonthly > 0 ? totalInvestment / netMonthly : null;
    const annualNet       = netMonthly * 12;
    const irr             = totalInvestment > 0 ? annualNet / totalInvestment : 0;
    const npv             = totalInvestment > 0 ? (annualNet * 5) - totalInvestment : 0;
    return { totalInvestment, netMonthly, paybackMonths, irr, npv };
  }, [items, assets, txTotals.net, monthlyBuckets.length]);

  function handleExport() {
    exportToCSV(
      'monster-wash-cashflow.csv',
      ['التاريخ', 'الوصف', 'النوع', 'المبلغ'],
      transactions.map((t) => [
        t.date,
        t.description,
        t.type === 'in' ? 'داخل' : 'خارج',
        t.amount,
      ]),
    );
  }

  const runwayDisplay = Number.isFinite(runwayMonths)
    ? runwayMonths.toFixed(1)
    : '∞';

  return (
    <>
      <TopBar
        title="التدفق النقدي والتقارير"
        subtitle="مراقبة الرصيد النقدي، فترة الاستمرارية، والعائد على الاستثمار"
        actions={
          <div className="flex items-center gap-2">
            <PrimaryButton icon={Plus} onClick={() => setLocalTxOpen(true)}>
              إضافة حركة
            </PrimaryButton>
            <SecondaryButton icon={Download} onClick={handleExport} className="hidden md:inline-flex">
              تصدير CSV
            </SecondaryButton>
          </div>
        }
      />

      <main className="p-8 space-y-6">
        {mutationError && (
          <ErrorState
            title="تعذّر حفظ التغييرات"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}
        {txError && (
          <ErrorState
            title="تعذّر تحميل الحركات النقدية"
            error={txError}
            onRetry={refetchTx}
          />
        )}
        {txLoading && transactions.length === 0 && (
          <LoadingState message="جارٍ تحميل الحركات النقدية..." />
        )}

        {/* ── Hero: Runway chart + Investment side-cards ─────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Chart (2/3 width) */}
          <Card className="lg:col-span-2 p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="text-xs text-slate-500 mb-1">فترة الاستمرارية (Runway)</p>
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-extrabold text-slate-900 tabular-nums">
                    {runwayDisplay}
                  </span>
                  <span className="text-sm font-semibold text-slate-500">
                    {Number.isFinite(runwayMonths) ? 'شهراً متبقياً' : 'تدفق نقدي موجب'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  بمعدل حرق شهري {formatCurrency(monthlyBurn)} — رصيد حالي {formatCurrency(currentCash)}
                </p>
              </div>
              {currentCash > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                  <ArrowUpRight size={13} /> رصيد نشط
                </span>
              )}
            </div>

            <div className="h-64 chart-ltr">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="runwayGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"  stopColor="#3f528a" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#3f528a" stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => formatCompact(v)}
                    />
                    <Tooltip
                      formatter={(v) => [formatCurrency(v), 'الرصيد']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontFamily: 'Tajawal' }}
                      labelStyle={{ fontFamily: 'Tajawal' }}
                    />
                    <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />
                    <Area
                      type="monotone"
                      dataKey="cash"
                      stroke="#2a3c70"
                      strokeWidth={2.5}
                      fill="url(#runwayGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-slate-400">
                  لا توجد حركات نقدية بعد لعرض المنحنى
                </div>
              )}
            </div>
          </Card>

          {/* Investment metrics stack (1/3 width) */}
          <div className="space-y-4">
            <InvestmentCard
              icon={Wallet}
              iconBg="bg-emerald-50"
              iconColor="text-emerald-600"
              label="صافي القيمة الحالية"
              sub="NPV — بناءً على الصافي الشهري"
              value={formatCompact(investmentTotals.npv)}
              positive={investmentTotals.npv >= 0}
            />
            <InvestmentCard
              icon={Percent}
              iconBg="bg-primary-50"
              iconColor="text-primary-700"
              label="معدل العائد الداخلي"
              sub="IRR — تقديري سنوي"
              value={formatPercent(investmentTotals.irr, 1)}
              positive={investmentTotals.irr >= 0}
            />
            <InvestmentCard
              icon={Calendar}
              iconBg="bg-amber-50"
              iconColor="text-amber-600"
              label="فترة الاسترداد"
              sub="PBP — من الصافي الشهري"
              value={
                investmentTotals.paybackMonths && Number.isFinite(investmentTotals.paybackMonths)
                  ? `${investmentTotals.paybackMonths.toFixed(1)} شهر`
                  : '—'
              }
              positive={
                !!investmentTotals.paybackMonths &&
                investmentTotals.paybackMonths < 36
              }
            />
          </div>
        </div>

        {/* ── Transaction summary row ──────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <MiniStat
            icon={TrendingUp}
            label="إجمالي الإيرادات"
            value={formatCurrency(txTotals.inSum)}
            color="emerald"
          />
          <MiniStat
            icon={TrendingDown}
            label="إجمالي المصروفات"
            value={formatCurrency(txTotals.outSum)}
            color="red"
          />
          <MiniStat
            icon={BarChart3}
            label="صافي التدفق"
            value={formatCurrency(txTotals.net)}
            color={txTotals.net >= 0 ? 'primary' : 'red'}
          />
        </div>

        {/* ── Transactions table ──────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="آخر الحركات النقدية"
            subtitle={`${formatNumber(transactions.length)} حركة خلال الأيام الماضية`}
            action={
              <PrimaryButton icon={Plus} onClick={() => setLocalTxOpen(true)}>
                إضافة حركة
              </PrimaryButton>
            }
          />
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-[11px] font-bold text-slate-500 uppercase border-b border-slate-100">
                  <th className="py-3 px-4">التاريخ</th>
                  <th className="py-3 px-4">الوصف</th>
                  <th className="py-3 px-4">النوع</th>
                  <th className="py-3 px-4 text-left tabular-nums">المبلغ</th>
                  <th className="py-3 px-4 text-left w-16">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 && !txLoading && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-sm text-slate-400">
                      لا توجد حركات نقدية مسجّلة بعد
                    </td>
                  </tr>
                )}
                {transactions.map((t) => {
                  const isIn = t.type === 'in';
                  return (
                    <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 text-slate-500 tabular-nums">{t.date}</td>
                      <td className="py-3 px-4 font-medium text-slate-800">{t.description}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                            isIn
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              : 'bg-red-50 text-red-700 border-red-100'
                          }`}
                        >
                          {isIn ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                          {isIn ? 'إيراد' : 'مصروف'}
                        </span>
                      </td>
                      <td
                        className={`py-3 px-4 text-left tabular-nums font-bold ${
                          isIn ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {isIn ? '+' : '−'}{formatCurrency(t.amount)}
                      </td>
                      <td className="py-3 px-4 text-left">
                        <button
                          onClick={() => handleDeleteTransaction(t.id)}
                          className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                          aria-label="حذف"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <p className="text-[11px] text-slate-400 pt-2">
          * الحسابات محسوبة من {formatNumber(transactions.length)} حركة نقدية + {formatNumber(items.length)} بند تأسيس + {formatNumber(assets.length)} أصل ثابت.
        </p>
      </main>

      <AddTransactionModal
        isOpen={isTxModalOpen}
        onClose={closeTxModal}
        onAdd={handleAddTransaction}
      />
    </>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────
function InvestmentCard({ icon: Icon, iconBg, iconColor, label, sub, value, positive }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className={`${iconBg} ${iconColor} w-11 h-11 rounded-xl flex items-center justify-center`}>
          <Icon size={20} strokeWidth={2.2} />
        </div>
        <span
          className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
            positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {positive ? '▲' : '▼'}
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900 tabular-nums leading-tight">{value}</p>
      <p className="text-[11px] text-slate-400 mt-1">{sub}</p>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, color }) {
  const colors = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-600' },
    red:     { bg: 'bg-red-50',     text: 'text-red-700',     icon: 'text-red-600'     },
    primary: { bg: 'bg-primary-50', text: 'text-primary-800', icon: 'text-primary-700' },
  }[color];
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm flex items-center gap-4">
      <div className={`${colors.bg} ${colors.icon} w-12 h-12 rounded-xl flex items-center justify-center`}>
        <Icon size={22} strokeWidth={2.2} />
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1">{label}</p>
        <p className={`text-xl font-extrabold tabular-nums ${colors.text}`}>{value}</p>
      </div>
    </div>
  );
}
