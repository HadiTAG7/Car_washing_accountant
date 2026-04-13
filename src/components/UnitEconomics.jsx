import { useState } from 'react';
import { Calculator, Target, TrendingUp, DollarSign } from 'lucide-react';
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

        {/* Gauge bar */}
        <div className="relative w-full bg-gray-100 rounded-full h-6 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              isReached
                ? 'bg-gradient-to-l from-emerald-400 to-emerald-600'
                : 'bg-gradient-to-l from-primary-400 to-primary-600'
            }`}
            style={{ width: `${ratio}%` }}
          />
          {/* Break-even marker */}
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

export default function UnitEconomics() {
  const [inputs, setInputs] = useState(defaultUnitEconomics);
  const [estimatedOrders, setEstimatedOrders] = useState(200);

  function handleChange(e) {
    setInputs({ ...inputs, [e.target.name]: parseFloat(e.target.value) || 0 });
  }

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
    </div>
  );
}
