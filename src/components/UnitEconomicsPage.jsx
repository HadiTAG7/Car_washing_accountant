import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  Calculator, Target, TrendingUp, DollarSign,
  SlidersHorizontal, Fuel, ShoppingCart, Wallet,
} from 'lucide-react';
import {
  defaultUnitEconomics,
  defaultEstimatedOrders,
  formatCurrency,
  formatNumber,
  generateBreakEvenProjection,
} from '../data/initialData';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard } from './UI';

// ─── Scenario slider (dark card) ────────────────────────────────────────────
function DarkSlider({ label, value, onChange, min, max, step, unit, icon: Icon }) {
  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-primary-300" />
          <span className="text-[13px] font-semibold text-primary-100">{label}</span>
        </div>
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded-md tabular-nums ${
            value > 0
              ? 'bg-red-500/20 text-red-200'
              : value < 0
                ? 'bg-emerald-500/20 text-emerald-200'
                : 'bg-white/10 text-primary-200'
          }`}
        >
          {value > 0 ? '+' : ''}{value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-primary-400"
      />
      <div className="flex justify-between text-[10px] text-primary-300 mt-2">
        <span>{min}{unit}</span>
        <span>{max > 0 ? '0' : ''}{unit}</span>
        <span>+{max}{unit}</span>
      </div>
    </div>
  );
}

export default function UnitEconomicsPage() {
  const [inputs, setInputs] = useState(defaultUnitEconomics);
  const [estimatedOrders, setEstimatedOrders] = useState(defaultEstimatedOrders);

  // Scenario adjustments
  const [fuelAdjust,   setFuelAdjust]   = useState(15);   // default +15 like mockup
  const [ordersAdjust, setOrdersAdjust] = useState(0);
  const [priceAdjust,  setPriceAdjust]  = useState(0);

  function handleChange(e) {
    setInputs((prev) => ({ ...prev, [e.target.name]: parseFloat(e.target.value) || 0 }));
  }

  // ── Base calculations ───────────────────────────────────
  const contribution = inputs.avgOrderPrice - inputs.variableCostPerOrder;
  const marginPct    = inputs.avgOrderPrice > 0 ? (contribution / inputs.avgOrderPrice) * 100 : 0;
  const breakEven    = contribution > 0 ? Math.ceil(inputs.monthlyFixedCosts / contribution) : 0;
  const profit       = contribution * estimatedOrders - inputs.monthlyFixedCosts;
  const revenue      = inputs.avgOrderPrice * estimatedOrders;

  // ── Stressed calculations ───────────────────────────────
  const sVar       = inputs.variableCostPerOrder * (1 + fuelAdjust / 100);
  const sPrice     = inputs.avgOrderPrice * (1 + priceAdjust / 100);
  const sOrders    = Math.round(estimatedOrders * (1 + ordersAdjust / 100));
  const sContrib   = sPrice - sVar;
  const sBreakEven = sContrib > 0 ? Math.ceil(inputs.monthlyFixedCosts / sContrib) : 0;
  const sProfit    = sContrib * sOrders - inputs.monthlyFixedCosts;

  // ── Chart data ──────────────────────────────────────────
  const chartData = useMemo(
    () => generateBreakEvenProjection(contribution, inputs.monthlyFixedCosts, estimatedOrders),
    [contribution, inputs.monthlyFixedCosts, estimatedOrders],
  );

  return (
    <>
      <TopBar
        title="اقتصاديات الوحدة ونقطة التعادل"
        subtitle="احسب هامش المساهمة ونقطة التعادل واختبر حساسية المشروع للتغيرات"
      />

      <main className="p-8 space-y-6">
        {/* ── KPI row ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard
            icon={TrendingUp}
            iconBg={profit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}
            iconColor={profit >= 0 ? 'text-emerald-600' : 'text-red-600'}
            label="الربح الشهري المتوقع"
            value={formatCurrency(profit)}
            sub={`عند ${formatNumber(estimatedOrders)} طلب شهرياً`}
          />
          <StatCard
            icon={DollarSign}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="هامش المساهمة"
            value={`${marginPct.toFixed(1)}%`}
            sub={`${formatCurrency(contribution)} لكل طلب`}
          />
          <StatCard
            icon={Target}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            label="نقطة التعادل"
            value={contribution > 0 ? `${formatNumber(breakEven)} طلب` : '—'}
            sub={contribution <= 0 ? 'هامش المساهمة سالب' : 'طلبات شهرياً لتغطية التكاليف'}
          />
          <StatCard
            icon={Wallet}
            iconBg="bg-violet-50"
            iconColor="text-violet-600"
            label="الإيراد الشهري"
            value={formatCurrency(revenue)}
            sub={`${formatNumber(estimatedOrders)} × ${formatCurrency(inputs.avgOrderPrice)}`}
          />
        </div>

        {/* ── Inputs ──────────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="معطيات الحاسبة"
            subtitle="عدّل القيم أدناه لإعادة احتساب نقطة التعادل والربح الشهري"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <Field
              label="متوسط سعر الطلب (ر.س)"
              name="avgOrderPrice"
              value={inputs.avgOrderPrice}
              onChange={handleChange}
            />
            <Field
              label="التكلفة المتغيرة للطلب (ر.س)"
              name="variableCostPerOrder"
              value={inputs.variableCostPerOrder}
              onChange={handleChange}
              hint="صابون، ماء، وقود، تشغيل"
            />
            <Field
              label="التكاليف الثابتة الشهرية (ر.س)"
              name="monthlyFixedCosts"
              value={inputs.monthlyFixedCosts}
              onChange={handleChange}
              hint="رواتب، تسويق، اشتراكات"
            />
            <Field
              label="الطلبات الشهرية المتوقعة"
              value={estimatedOrders}
              onChange={(e) => setEstimatedOrders(parseInt(e.target.value) || 0)}
            />
          </div>
        </Card>

        {/* ── Break-even chart ────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="منحنى الربح مقابل نقطة التعادل"
            subtitle="إسقاط 12 شهراً يوضّح متى يتجاوز الربح التراكمي خط التعادل"
          />
          <div className="h-80 chart-ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="profitStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"  stopColor="#2a3c70" />
                    <stop offset="100%" stopColor="#3f528a" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}ك`}
                />
                <Tooltip
                  formatter={(v, name) => [formatCurrency(v), name === 'profit' ? 'الربح' : 'نقطة التعادل']}
                  labelStyle={{ fontFamily: 'Tajawal' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontFamily: 'Tajawal' }}
                />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="profit"
                  stroke="url(#profitStroke)"
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#2a3c70' }}
                  activeDot={{ r: 6 }}
                  name="الربح الشهري"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* ── Dark sensitivity card ───────────────────────── */}
        <div className="bg-gradient-to-br from-primary-900 to-primary-950 rounded-2xl p-6 text-white shadow-xl">
          <div className="flex items-center gap-2 mb-1">
            <SlidersHorizontal size={20} className="text-primary-300" />
            <h2 className="text-base font-bold">تحليل الحساسية والسيناريوهات</h2>
          </div>
          <p className="text-xs text-primary-300 mb-6">
            حرّك المقابض لاختبار تأثير التغيرات في الوقود، الطلبات، والأسعار على ربحية المشروع
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <DarkSlider
              label="تكاليف الوقود والمتغيرات"
              value={fuelAdjust}
              onChange={setFuelAdjust}
              min={-30} max={30} step={5} unit="%"
              icon={Fuel}
            />
            <DarkSlider
              label="عدد الطلبات"
              value={ordersAdjust}
              onChange={setOrdersAdjust}
              min={-30} max={30} step={5} unit="%"
              icon={ShoppingCart}
            />
            <DarkSlider
              label="سعر الطلب"
              value={priceAdjust}
              onChange={setPriceAdjust}
              min={-20} max={20} step={5} unit="%"
              icon={DollarSign}
            />
          </div>

          {/* Stressed results */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DarkResult
              label="هامش المساهمة"
              value={formatCurrency(sContrib)}
              diff={sContrib - contribution}
              betterLower={false}
            />
            <DarkResult
              label="نقطة التعادل"
              value={sBreakEven > 0 ? `${formatNumber(sBreakEven)} طلب` : '—'}
              diff={sBreakEven - breakEven}
              betterLower={true}
            />
            <DarkResult
              label="الطلبات المعدّلة"
              value={`${formatNumber(sOrders)} طلب`}
              diff={sOrders - estimatedOrders}
              betterLower={false}
            />
            <DarkResult
              label="الربح الشهري"
              value={formatCurrency(sProfit)}
              diff={sProfit - profit}
              betterLower={false}
            />
          </div>
        </div>
      </main>
    </>
  );
}

// ─── Small subcomponents ────────────────────────────────────────────────────
function Field({ label, name, value, onChange, hint }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
      <input
        type="number"
        name={name}
        value={value}
        onChange={onChange}
        min="0"
        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
      />
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function DarkResult({ label, value, diff, betterLower }) {
  const improved = betterLower ? diff < 0 : diff > 0;
  const worse    = betterLower ? diff > 0 : diff < 0;
  return (
    <div className="bg-white/5 border border-white/5 rounded-xl p-4">
      <p className="text-[11px] text-primary-300 mb-1">{label}</p>
      <p className="text-lg font-extrabold tabular-nums">{value}</p>
      {diff !== 0 && (
        <p
          className={`text-[11px] font-semibold mt-1 ${
            improved ? 'text-emerald-300' : worse ? 'text-red-300' : 'text-primary-200'
          }`}
        >
          {diff > 0 ? '▲' : '▼'} {formatNumber(Math.abs(Math.round(diff)))}
        </p>
      )}
    </div>
  );
}
