import { useState } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import {
  Download,
  TrendingDown,
  Banknote,
  CalendarRange,
  BadgeDollarSign,
  Clock,
  Percent,
  TrendingUp,
} from 'lucide-react';
import {
  formatCurrency,
  formatNumber,
  generateCashFlowProjection,
  exportToCSV,
  calcAnnualDepreciation,
  calcBookValue,
  getCategoryLabel,
  calcPaybackPeriod,
  calcNPV,
  calcIRR,
} from '../data/initialData';

function CashFlowTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm" dir="rtl">
      <p className="font-semibold text-gray-800 mb-1">{label}</p>
      <p className="text-primary-600 font-semibold">
        رأس المال المتبقي: {formatCurrency(payload[0].value)}
      </p>
    </div>
  );
}

export default function CashFlowReport({ items, assets }) {
  const totalActual = items.reduce((s, i) => s + i.actual, 0);

  const [startingCapital, setStartingCapital] = useState(
    totalActual > 0 ? Math.round(totalActual * 1.3) : 350000
  );
  const [monthlyBurn, setMonthlyBurn] = useState(25000);
  const [monthlyRevenue, setMonthlyRevenue] = useState(45000);
  const [discountRate, setDiscountRate] = useState(10);

  const projectionData = generateCashFlowProjection(startingCapital, monthlyBurn);
  const monthsUntilZero = projectionData.filter((d) => d.remaining > 0).length;

  // ── Investment metrics ────────────────────────────────────
  const monthlyNetCashFlow = monthlyRevenue - monthlyBurn;
  const projectionMonths = 36; // 3-year horizon

  const paybackMonths = calcPaybackPeriod(totalActual, monthlyNetCashFlow);
  const monthlyCashFlows = Array(projectionMonths).fill(monthlyNetCashFlow);
  const npv = calcNPV(totalActual, monthlyCashFlows, discountRate / 100);
  const irr = calcIRR(totalActual, monthlyCashFlows);

  // ── Export handlers ───────────────────────────────────────
  function handleExportCosts() {
    const headers = ['التصنيف', 'اسم البند', 'الميزانية المحددة', 'التكلفة الفعلية', 'الفرق'];
    const rows = items.map((i) => [
      getCategoryLabel(i.category),
      i.itemName,
      i.budgeted,
      i.actual,
      i.budgeted - i.actual,
    ]);
    exportToCSV('startup_costs.csv', headers, rows);
  }

  function handleExportAssets() {
    const headers = [
      'اسم الأصل',
      'تاريخ الشراء',
      'تكلفة الشراء',
      'القيمة التخريدية',
      'العمر الإنتاجي',
      'الإهلاك السنوي',
      'القيمة الدفترية',
    ];
    const rows = assets.map((a) => [
      a.assetName,
      a.purchaseDate,
      a.purchaseCost,
      a.salvageValue,
      a.usefulLife,
      Math.round(calcAnnualDepreciation(a.purchaseCost, a.salvageValue, a.usefulLife)),
      Math.round(calcBookValue(a.purchaseCost, a.salvageValue, a.usefulLife, a.purchaseDate)),
    ]);
    exportToCSV('assets_depreciation.csv', headers, rows);
  }

  return (
    <div>
      {/* ── Cash Flow Summary Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-primary-50 text-primary-600 p-3 rounded-xl">
              <Banknote size={24} />
            </div>
          </div>
          <p className="text-sm text-gray-500 mb-1">رأس المال الابتدائي</p>
          <p className="text-2xl font-bold text-gray-800">{formatCurrency(startingCapital)}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-amber-50 text-amber-600 p-3 rounded-xl">
              <TrendingDown size={24} />
            </div>
          </div>
          <p className="text-sm text-gray-500 mb-1">معدل الحرق الشهري</p>
          <p className="text-2xl font-bold text-gray-800">{formatCurrency(monthlyBurn)}</p>
        </div>

        <div
          className={`rounded-2xl shadow-sm border p-6 hover:shadow-md transition-shadow ${
            monthsUntilZero <= 3
              ? 'bg-red-50 border-red-100'
              : monthsUntilZero <= 6
                ? 'bg-amber-50 border-amber-100'
                : 'bg-emerald-50 border-emerald-100'
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <div
              className={`p-3 rounded-xl ${
                monthsUntilZero <= 3
                  ? 'bg-red-100 text-red-600'
                  : monthsUntilZero <= 6
                    ? 'bg-amber-100 text-amber-600'
                    : 'bg-emerald-100 text-emerald-600'
              }`}
            >
              <CalendarRange size={24} />
            </div>
          </div>
          <p className="text-sm text-gray-500 mb-1">المدة المالية المتاحة</p>
          <p
            className={`text-2xl font-bold ${
              monthsUntilZero <= 3
                ? 'text-red-700'
                : monthsUntilZero <= 6
                  ? 'text-amber-700'
                  : 'text-emerald-700'
            }`}
          >
            {monthsUntilZero >= 12 ? '+١٢' : monthsUntilZero} شهر
          </p>
        </div>
      </div>

      {/* ── Input controls ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
        <h2 className="text-lg font-bold text-gray-800 mb-4">إعدادات التدفق النقدي</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              رأس المال الابتدائي (ر.س)
            </label>
            <input
              type="number"
              value={startingCapital}
              onChange={(e) => setStartingCapital(parseFloat(e.target.value) || 0)}
              min="0"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              معدل الحرق الشهري (ر.س)
            </label>
            <input
              type="number"
              value={monthlyBurn}
              onChange={(e) => setMonthlyBurn(parseFloat(e.target.value) || 0)}
              min="0"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">المصروفات التشغيلية الشهرية المتوقعة</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              الإيرادات الشهرية المتوقعة (ر.س)
            </label>
            <input
              type="number"
              value={monthlyRevenue}
              onChange={(e) => setMonthlyRevenue(parseFloat(e.target.value) || 0)}
              min="0"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">لحساب مقاييس الاستثمار</p>
          </div>
        </div>
      </div>

      {/* ── Cash Flow Chart ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
        <h2 className="text-lg font-bold text-gray-800 mb-6">توقعات رأس المال المتبقي (١٢ شهر)</h2>

        <div className="w-full h-80" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={projectionData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <defs>
                <linearGradient id="capitalGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12, fill: '#6b7280' }}
                axisLine={{ stroke: '#d1d5db' }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: '#6b7280' }}
                axisLine={{ stroke: '#d1d5db' }}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<CashFlowTooltip />} />
              <Area
                type="monotone"
                dataKey="remaining"
                stroke="#3b82f6"
                strokeWidth={3}
                fill="url(#capitalGradient)"
                dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Investment Metrics ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <BadgeDollarSign size={22} className="text-primary-600" />
            مقاييس الاستثمار
          </h2>
        </div>
        <p className="text-xs text-gray-400 mb-6">
          على أساس استثمار أولي {formatCurrency(totalActual)} وأفق ٣ سنوات
        </p>

        {/* Discount rate control */}
        <div className="mb-6 max-w-xs">
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            معدل الخصم السنوي (%)
          </label>
          <input
            type="number"
            value={discountRate}
            onChange={(e) => setDiscountRate(parseFloat(e.target.value) || 0)}
            min="0"
            max="50"
            step="0.5"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Payback Period */}
          <div
            className={`rounded-2xl border p-6 ${
              paybackMonths <= 24
                ? 'bg-emerald-50 border-emerald-100'
                : paybackMonths <= 36
                  ? 'bg-amber-50 border-amber-100'
                  : 'bg-red-50 border-red-100'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div
                className={`p-3 rounded-xl ${
                  paybackMonths <= 24
                    ? 'bg-emerald-100 text-emerald-600'
                    : paybackMonths <= 36
                      ? 'bg-amber-100 text-amber-600'
                      : 'bg-red-100 text-red-600'
                }`}
              >
                <Clock size={24} />
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-1">فترة الاسترداد</p>
            <p className="text-2xl font-bold text-gray-800">
              {monthlyNetCashFlow <= 0
                ? '∞'
                : paybackMonths < 1
                  ? 'أقل من شهر'
                  : `${formatNumber(Math.round(paybackMonths))} شهر`}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {monthlyNetCashFlow > 0
                ? `صافي التدفق الشهري: ${formatCurrency(monthlyNetCashFlow)}`
                : 'التدفق النقدي الشهري سالب'}
            </p>
          </div>

          {/* NPV */}
          <div
            className={`rounded-2xl border p-6 ${
              npv >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div
                className={`p-3 rounded-xl ${
                  npv >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
                }`}
              >
                <TrendingUp size={24} />
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-1">صافي القيمة الحالية (NPV)</p>
            <p
              className={`text-2xl font-bold ${npv >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {formatCurrency(Math.round(npv))}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              بمعدل خصم {discountRate}% على ٣٦ شهر
            </p>
          </div>

          {/* IRR */}
          <div
            className={`rounded-2xl border p-6 ${
              irr !== null && irr > 0
                ? 'bg-emerald-50 border-emerald-100'
                : 'bg-gray-50 border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div
                className={`p-3 rounded-xl ${
                  irr !== null && irr > 0
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                <Percent size={24} />
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-1">معدل العائد الداخلي (IRR)</p>
            <p
              className={`text-2xl font-bold ${
                irr !== null && irr > 0 ? 'text-emerald-700' : 'text-gray-700'
              }`}
            >
              {irr !== null ? `${(irr * 100).toFixed(1)}%` : '—'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {irr !== null
                ? irr > discountRate / 100
                  ? 'أعلى من معدل الخصم ✅'
                  : 'أقل من معدل الخصم ⚠️'
                : 'غير قابل للحساب'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Export Buttons ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Download size={20} className="text-primary-600" />
          تصدير البيانات
        </h2>
        <p className="text-sm text-gray-500 mb-5">
          تصدير جداول التكاليف والأصول كملفات CSV للاستخدام في Excel أو Google Sheets.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExportCosts}
            className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
          >
            <Download size={16} />
            تصدير التكاليف التأسيسية (CSV)
          </button>
          <button
            onClick={handleExportAssets}
            className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
          >
            <Download size={16} />
            تصدير سجل الإهلاك (CSV)
          </button>
        </div>
      </div>
    </div>
  );
}
