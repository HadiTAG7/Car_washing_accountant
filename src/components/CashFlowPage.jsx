import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Download, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Wallet, Calendar, BarChart3, Percent,
} from 'lucide-react';
import {
  initialCashSummary,
  initialCashTransactions,
  formatCurrency,
  formatCompact,
  formatNumber,
  formatPercent,
  exportToCSV,
  generateRunwayProjection,
} from '../data/initialData';
import TopBar from './TopBar';
import { Card, SectionHeader, SecondaryButton } from './UI';

export default function CashFlowPage({ items, assets }) {
  // Current cash / burn derived from mock summary (but we also show some items context)
  const summary = initialCashSummary;

  const runwayData = useMemo(
    () => generateRunwayProjection(summary.currentCash, summary.monthlyBurn),
    [summary.currentCash, summary.monthlyBurn],
  );

  const txTotals = useMemo(() => {
    let inSum = 0, outSum = 0;
    initialCashTransactions.forEach((t) => {
      if (t.type === 'in') inSum += t.amount;
      else outSum += t.amount;
    });
    return { inSum, outSum, net: inSum - outSum };
  }, []);

  function handleExport() {
    exportToCSV(
      'monster-wash-cashflow.csv',
      ['التاريخ', 'الوصف', 'النوع', 'المبلغ'],
      initialCashTransactions.map((t) => [
        t.date,
        t.description,
        t.type === 'in' ? 'داخل' : 'خارج',
        t.amount,
      ]),
    );
  }

  return (
    <>
      <TopBar
        title="التدفق النقدي والتقارير"
        subtitle="مراقبة الرصيد النقدي، فترة الاستمرارية، والعائد على الاستثمار"
        actions={
          <SecondaryButton icon={Download} onClick={handleExport} className="hidden md:inline-flex">
            تصدير CSV
          </SecondaryButton>
        }
      />

      <main className="p-8 space-y-6">
        {/* ── Hero: Runway chart + Investment side-cards ─────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Chart (2/3 width) */}
          <Card className="lg:col-span-2 p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="text-xs text-slate-500 mb-1">فترة الاستمرارية (Runway)</p>
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-extrabold text-slate-900 tabular-nums">
                    {summary.runwayMonths.toFixed(1)}
                  </span>
                  <span className="text-sm font-semibold text-slate-500">شهراً متبقياً</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  بمعدل حرق شهري {formatCurrency(summary.monthlyBurn)} — رصيد حالي {formatCurrency(summary.currentCash)}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                <ArrowUpRight size={13} /> +2.3 شهر
              </span>
            </div>

            <div className="h-64 chart-ltr">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={runwayData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
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
                  <Area
                    type="monotone"
                    dataKey="cash"
                    stroke="#2a3c70"
                    strokeWidth={2.5}
                    fill="url(#runwayGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Investment metrics stack (1/3 width) */}
          <div className="space-y-4">
            <InvestmentCard
              icon={Wallet}
              iconBg="bg-emerald-50"
              iconColor="text-emerald-600"
              label="صافي القيمة الحالية"
              sub="NPV — معدل خصم 10%"
              value={`$${(summary.npv / 1_000_000).toFixed(2)}م`}
              trend="+8.4%"
              positive
            />
            <InvestmentCard
              icon={Percent}
              iconBg="bg-primary-50"
              iconColor="text-primary-700"
              label="معدل العائد الداخلي"
              sub="IRR — على مدى 60 شهر"
              value={formatPercent(summary.irr, 1)}
              trend="+3.2%"
              positive
            />
            <InvestmentCard
              icon={Calendar}
              iconBg="bg-amber-50"
              iconColor="text-amber-600"
              label="فترة الاسترداد"
              sub="PBP — من رأس المال"
              value={`${summary.paybackMonths.toFixed(1)} شهر`}
              trend="−1.4 شهر"
              positive
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
            subtitle={`${formatNumber(initialCashTransactions.length)} حركة خلال الأيام الماضية`}
          />
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-[11px] font-bold text-slate-500 uppercase border-b border-slate-100">
                  <th className="py-3 px-4">التاريخ</th>
                  <th className="py-3 px-4">الوصف</th>
                  <th className="py-3 px-4">النوع</th>
                  <th className="py-3 px-4 text-left tabular-nums">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {initialCashTransactions.map((t) => {
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <p className="text-[11px] text-slate-400 pt-2">
          * التدفق النقدي مبني على {formatNumber(items?.length || 0)} بند تأسيس و {formatNumber(assets?.length || 0)} أصل ثابت مسجل.
        </p>
      </main>
    </>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────
function InvestmentCard({ icon: Icon, iconBg, iconColor, label, sub, value, trend, positive }) {
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
          {trend}
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
