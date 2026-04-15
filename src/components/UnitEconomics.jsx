import { useState } from 'react';
import { Calculator, Target, TrendingUp, DollarSign, SlidersHorizontal, Fuel, ShoppingCart } from 'lucide-react';
import { formatCurrency, formatNumber, defaultUnitEconomics } from '../data/initialData';

function MetricCard({ icon: Icon, iconBg, iconColor, label, value, sub }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <div className={`${iconBg} ${iconColor} p-3 rounded-xl`}>
          <Icon size={24} />
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function BreakEvenGauge({ breakEvenOrders, currentEstimate }) {
  const ratio = breakEvenOrders > 0 ? Math.min((currentEstimate / breakEvenOrders) * 100, 100) : 0;
  const isReached = currentEstimate >= breakEvenOrders;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mt-6">
      <h3 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
        <Target size={20} className="text-primary-600" />
        مؤشر نقطة التعادل
      </h3>

      <div className="mb-3">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-500">التقدم نحو نقطة التعادل</span>
          <span className={`font-semibold ${isReached ? 'text-emerald-600' : 'text-primary-600'}`}>
            {ratio.toFixed(0)}%
          </span>
        </div>

        <div className="relative w-full bg-gray-100 rounded-full h-6 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              isReached
                ? 'bg-gradient-to-l from-emerald-400 to-emerald-600'
                : 'bg-gradient-to-l from-primary-400 to-primary-600'
            }`}
            style={{ width: `${ratio}%` }}
          />
          <div className="absolute top-0 left-0 right-0 h-full flex items-center justify-center">
            <span className="text-xs font-bold text-white drop-shadow">
              {formatNumber(currentEstimate)} / {formatNumber(breakEvenOrders)} طلب
            </span>
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-500 mt-3">
        {isReached
          ? '✅ أنت تتجاوز نقطة التعادل — المشروع يحقق ربحاً!'
          : `تحتاج إلى ${formatNumber(breakEvenOrders)} طلب شهرياً لتغطية جميع التكاليف.`}
      </p>
    </div>
  );
}

// ─── Scenario Analysis Slider ───────────────────────────────────────────────
function ScenarioSlider({ label, value, onChange, min, max, step, unit, icon: Icon }) {
  const isPositive = value > 0;
  const isNegative = value < 0;

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">{label}</span>
        </div>
        <span
          className={`text-sm font-bold px-2 py-0.5 rounded-lg ${
            isPositive
              ? 'bg-red-100 text-red-700'
              : isNegative
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-200 text-gray-600'
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
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600"
      />
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>{min}{unit}</span>
        <span>0{unit}</span>
        <span>+{max}{unit}</span>
      </div>
    </div>
  );
}

function ScenarioResultCard({ label, baseValue, stressedValue, formatFn, betterWhenLower }) {
  const diff = stressedValue - baseValue;
  const improved = betterWhenLower ? diff < 0 : diff > 0;
  const worsened = betterWhenLower ? diff > 0 : diff < 0;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-800">{formatFn(stressedValue)}</p>
      {diff !== 0 && (
        <p className={`text-xs font-semibold mt-1 ${improved ? 'text-emerald-600' : worsened ? 'text-red-600' : 'text-gray-500'}`}>
          {diff > 0 ? '▲' : '▼'} {formatFn(Math.abs(diff))} عن الأساس
        </p>
      )}
    </div>
  );
}

export default function UnitEconomics() {
  const [inputs, setInputs] = useState(defaultUnitEconomics);
  const [estimatedOrders, setEstimatedOrders] = useState(200);

  // Scenario analysis adjustments (percentages)
  const [fuelAdjust, setFuelAdjust] = useState(0);
  const [ordersAdjust, setOrdersAdjust] = useState(0);
  const [priceAdjust, setPriceAdjust] = useState(0);

  function handleChange(e) {
    setInputs({ ...inputs, [e.target.name]: parseFloat(e.target.value) || 0 });
  }

  // ── Base calculations ─────────────────────────────────────
  const contributionMargin = inputs.avgOrderPrice - inputs.variableCostPerOrder;
  const contributionMarginPercent =
    inputs.avgOrderPrice > 0
      ? ((contributionMargin / inputs.avgOrderPrice) * 100).toFixed(1)
      : 0;
  const breakEvenOrders =
    contributionMargin > 0
      ? Math.ceil(inputs.monthlyFixedCosts / contributionMargin)
      : 0;
  const monthlyProfit = contributionMargin * estimatedOrders - inputs.monthlyFixedCosts;

  // ── Stressed calculations ─────────────────────────────────
  const stressedVariableCost = inputs.variableCostPerOrder * (1 + fuelAdjust / 100);
  const stressedPrice = inputs.avgOrderPrice * (1 + priceAdjust / 100);
  const stressedOrders = Math.round(estimatedOrders * (1 + ordersAdjust / 100));

  const stressedContribution = stressedPrice - stressedVariableCost;
  const stressedBreakEven =
    stressedContribution > 0
      ? Math.ceil(inputs.monthlyFixedCosts / stressedContribution)
      : 0;
  const stressedProfit = stressedContribution * stressedOrders - inputs.monthlyFixedCosts;

  return (
    <div>
      {/* Input form */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
        <h2 className="text-lg font-bold text-gray-800 mb-1 flex items-center gap-2">
          <Calculator size={22} className="text-primary-600" />
          حاسبة اقتصاديات الوحدة ونقطة التعادل
        </h2>
        <p className="text-xs text-gray-400 mb-6">أدخل المعطيات لحساب نقطة التعادل وهامش المساهمة</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              متوسط سعر الطلب (ر.س)
            </label>
            <input
              type="number"
              name="avgOrderPrice"
              value={inputs.avgOrderPrice}
              onChange={handleChange}
              min="0"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              التكلفة المتغيرة للطلب (ر.س)
            </label>
            <input
              type="number"
              name="variableCostPerOrder"
              value={inputs.variableCostPerOrder}
              onChange={handleChange}
              min="0"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">صابون، ماء، وقود</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              التكاليف الثابتة الشهرية (ر.س)
            </label>
            <input
              type="number"
              name="monthlyFixedCosts"
              value={inputs.monthlyFixedCosts}
              onChange={handleChange}
              min="0"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">رواتب، تسويق، اشتراكات</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              الطلبات الشهرية المتوقعة
            </label>
            <input
              type="number"
              value={estimatedOrders}
              onChange={(e) => setEstimatedOrders(parseInt(e.target.value) || 0)}
              min="0"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Output cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <MetricCard
          icon={DollarSign}
          iconBg="bg-primary-50"
          iconColor="text-primary-600"
          label="هامش المساهمة لكل طلب"
          value={formatCurrency(contributionMargin)}
          sub={`${contributionMarginPercent}% من سعر الطلب`}
        />
        <MetricCard
          icon={Target}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          label="نقطة التعادل (طلبات/شهر)"
          value={contributionMargin > 0 ? `${formatNumber(breakEvenOrders)} طلب` : '—'}
          sub={contributionMargin <= 0 ? 'هامش المساهمة سالب' : null}
        />
        <MetricCard
          icon={TrendingUp}
          iconBg={monthlyProfit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}
          iconColor={monthlyProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}
          label="الربح الشهري المتوقع"
          value={formatCurrency(monthlyProfit)}
          sub={`بناءً على ${formatNumber(estimatedOrders)} طلب`}
        />
        <MetricCard
          icon={Calculator}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
          label="الإيراد الشهري المتوقع"
          value={formatCurrency(inputs.avgOrderPrice * estimatedOrders)}
          sub={`${formatNumber(estimatedOrders)} × ${formatCurrency(inputs.avgOrderPrice)}`}
        />
      </div>

      {/* Break-even gauge */}
      <BreakEvenGauge breakEvenOrders={breakEvenOrders} currentEstimate={estimatedOrders} />

      {/* ── Scenario / Sensitivity Analysis ──────────────────── */}
      <div className="mt-10 pt-8 border-t-2 border-gray-200">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-1 flex items-center gap-2">
            <SlidersHorizontal size={22} className="text-primary-600" />
            تحليل الحساسية والسيناريوهات
          </h2>
          <p className="text-xs text-gray-400 mb-6">
            اختبر تأثير التغييرات المحتملة على ربحية المشروع ونقطة التعادل
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <ScenarioSlider
              label="تكاليف الوقود والمتغيرات"
              value={fuelAdjust}
              onChange={setFuelAdjust}
              min={-30}
              max={30}
              step={5}
              unit="%"
              icon={Fuel}
            />
            <ScenarioSlider
              label="عدد الطلبات اليومية"
              value={ordersAdjust}
              onChange={setOrdersAdjust}
              min={-30}
              max={30}
              step={5}
              unit="%"
              icon={ShoppingCart}
            />
            <ScenarioSlider
              label="سعر الطلب"
              value={priceAdjust}
              onChange={setPriceAdjust}
              min={-20}
              max={20}
              step={5}
              unit="%"
              icon={DollarSign}
            />
          </div>
        </div>

        {/* Stressed results */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-base font-bold text-gray-800 mb-4">نتائج السيناريو المعدّل</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <ScenarioResultCard
              label="هامش المساهمة (معدّل)"
              baseValue={contributionMargin}
              stressedValue={stressedContribution}
              formatFn={formatCurrency}
              betterWhenLower={false}
            />
            <ScenarioResultCard
              label="نقطة التعادل (معدّلة)"
              baseValue={breakEvenOrders}
              stressedValue={stressedBreakEven}
              formatFn={(v) => (v > 0 ? `${formatNumber(v)} طلب` : '—')}
              betterWhenLower={true}
            />
            <ScenarioResultCard
              label="الطلبات المتوقعة (معدّلة)"
              baseValue={estimatedOrders}
              stressedValue={stressedOrders}
              formatFn={(v) => `${formatNumber(v)} طلب`}
              betterWhenLower={false}
            />
            <ScenarioResultCard
              label="الربح الشهري (معدّل)"
              baseValue={monthlyProfit}
              stressedValue={stressedProfit}
              formatFn={formatCurrency}
              betterWhenLower={false}
            />
          </div>

          {/* Stressed gauge */}
          <BreakEvenGauge breakEvenOrders={stressedBreakEven} currentEstimate={stressedOrders} />
        </div>
      </div>
    </div>
  );
}
