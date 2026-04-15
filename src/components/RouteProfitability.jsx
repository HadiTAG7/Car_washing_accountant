import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  MapPin,
  Trash2,
  TrendingUp,
  CircleDollarSign,
  Percent,
  Plus,
  X,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';

// ─── Chart Tooltip ──────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm" dir="rtl">
      <p className="font-semibold text-gray-800 mb-2">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 py-0.5">
          <span
            className="w-3 h-3 rounded-full inline-block"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-600">{entry.name}:</span>
          <span className="font-semibold text-gray-800">{formatCurrency(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Add Vehicle Performance Modal ──────────────────────────────────────────
function AddVehicleModal({ isOpen, onClose, onAdd }) {
  const [form, setForm] = useState({
    vehicleName: '',
    route: '',
    monthlyRevenue: '',
    directCosts: '',
    allocatedFixedCosts: '',
    assetCost: '',
  });

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.vehicleName.trim() || !form.route.trim() || !form.monthlyRevenue || !form.assetCost)
      return;

    onAdd({
      vehicleName: form.vehicleName.trim(),
      route: form.route.trim(),
      monthlyRevenue: parseFloat(form.monthlyRevenue),
      directCosts: parseFloat(form.directCosts) || 0,
      allocatedFixedCosts: parseFloat(form.allocatedFixedCosts) || 0,
      assetCost: parseFloat(form.assetCost),
    });

    setForm({
      vehicleName: '',
      route: '',
      monthlyRevenue: '',
      directCosts: '',
      allocatedFixedCosts: '',
      assetCost: '',
    });
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Plus size={20} className="text-primary-600" />
            إضافة أداء مركبة
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">اسم المركبة</label>
              <input
                type="text"
                name="vehicleName"
                value={form.vehicleName}
                onChange={handleChange}
                placeholder="مثال: فان تويوتا"
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">نطاق العمل</label>
              <input
                type="text"
                name="route"
                value={form.route}
                onChange={handleChange}
                placeholder="مثال: غرب الرياض"
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                الإيرادات الشهرية (ر.س)
              </label>
              <input
                type="number"
                name="monthlyRevenue"
                value={form.monthlyRevenue}
                onChange={handleChange}
                placeholder="0"
                required
                min="0"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                التكاليف المباشرة (ر.س)
              </label>
              <input
                type="number"
                name="directCosts"
                value={form.directCosts}
                onChange={handleChange}
                placeholder="0"
                min="0"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                التكاليف الموزعة (ر.س)
              </label>
              <input
                type="number"
                name="allocatedFixedCosts"
                value={form.allocatedFixedCosts}
                onChange={handleChange}
                placeholder="0"
                min="0"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                تكلفة الأصل (ر.س)
              </label>
              <input
                type="number"
                name="assetCost"
                value={form.assetCost}
                onChange={handleChange}
                placeholder="0"
                required
                min="0"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">لحساب العائد على الأصل</p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              إضافة الأداء
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function RouteProfitability({ vehicles, onAddVehicle, onDeleteVehicle }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Compute derived data
  const vehiclesWithMetrics = vehicles.map((v) => {
    const netProfit = v.monthlyRevenue - v.directCosts - v.allocatedFixedCosts;
    const roa = v.assetCost > 0 ? ((netProfit * 12) / v.assetCost) * 100 : 0;
    return { ...v, netProfit, roa };
  });

  const totalRevenue = vehiclesWithMetrics.reduce((s, v) => s + v.monthlyRevenue, 0);
  const totalProfit = vehiclesWithMetrics.reduce((s, v) => s + v.netProfit, 0);
  const avgROA =
    vehiclesWithMetrics.length > 0
      ? vehiclesWithMetrics.reduce((s, v) => s + v.roa, 0) / vehiclesWithMetrics.length
      : 0;

  // Chart data
  const chartData = vehiclesWithMetrics.map((v) => ({
    name: v.vehicleName,
    'الإيرادات': v.monthlyRevenue,
    'التكاليف المباشرة': v.directCosts,
    'التكاليف الموزعة': v.allocatedFixedCosts,
    'الربح الصافي': v.netProfit,
  }));

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-primary-50 text-primary-600 p-3 rounded-xl">
              <CircleDollarSign size={24} />
            </div>
          </div>
          <p className="text-sm text-gray-500 mb-1">إجمالي الإيرادات الشهرية</p>
          <p className="text-2xl font-bold text-gray-800">{formatCurrency(totalRevenue)}</p>
        </div>

        <div
          className={`rounded-2xl shadow-sm border p-6 hover:shadow-md transition-shadow ${
            totalProfit >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <div
              className={`p-3 rounded-xl ${
                totalProfit >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
              }`}
            >
              <TrendingUp size={24} />
            </div>
          </div>
          <p className="text-sm text-gray-500 mb-1">إجمالي الربح الصافي</p>
          <p
            className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
          >
            {formatCurrency(totalProfit)}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-violet-50 text-violet-600 p-3 rounded-xl">
              <Percent size={24} />
            </div>
          </div>
          <p className="text-sm text-gray-500 mb-1">متوسط العائد على الأصل (ROA)</p>
          <p className="text-2xl font-bold text-gray-800">{avgROA.toFixed(1)}%</p>
          <p className="text-xs text-gray-400 mt-1">سنوي</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <MapPin size={20} className="text-primary-600" />
            ربحية المسارات والأسطول
          </h2>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
          >
            <Plus size={16} />
            إضافة أداء مركبة
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-4 py-3 text-right font-semibold">المركبة</th>
                <th className="px-4 py-3 text-right font-semibold">نطاق العمل</th>
                <th className="px-4 py-3 text-right font-semibold">الإيرادات الشهرية</th>
                <th className="px-4 py-3 text-right font-semibold">التكاليف المباشرة</th>
                <th className="px-4 py-3 text-right font-semibold">التكاليف الموزعة</th>
                <th className="px-4 py-3 text-right font-semibold">الربح الصافي</th>
                <th className="px-4 py-3 text-right font-semibold">ROA سنوي</th>
                <th className="px-4 py-3 text-center font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {vehiclesWithMetrics.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    لا توجد بيانات أداء بعد. أضف أداء مركبة للبدء.
                  </td>
                </tr>
              )}
              {vehiclesWithMetrics.map((v) => (
                <tr
                  key={v.id}
                  className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-gray-800">{v.vehicleName}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 text-xs font-medium px-2.5 py-1 rounded-lg">
                      <MapPin size={12} />
                      {v.route}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(v.monthlyRevenue)}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(v.directCosts)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatCurrency(v.allocatedFixedCosts)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-semibold ${v.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                    >
                      {formatCurrency(v.netProfit)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-semibold ${v.roa >= 15 ? 'text-emerald-600' : v.roa >= 0 ? 'text-amber-600' : 'text-red-600'}`}
                    >
                      {v.roa.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center">
                      <button
                        onClick={() => onDeleteVehicle(v.id)}
                        className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        title="حذف"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bar Chart */}
      {vehiclesWithMetrics.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-6">
            مقارنة أداء المركبات
          </h2>

          <div className="w-full h-80" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  axisLine={{ stroke: '#d1d5db' }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  axisLine={{ stroke: '#d1d5db' }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: '13px', paddingTop: '16px' }} />
                <Bar dataKey="الإيرادات" fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={28} />
                <Bar dataKey="التكاليف المباشرة" fill="#f59e0b" radius={[6, 6, 0, 0]} barSize={28} />
                <Bar dataKey="التكاليف الموزعة" fill="#94a3b8" radius={[6, 6, 0, 0]} barSize={28} />
                <Bar dataKey="الربح الصافي" fill="#10b981" radius={[6, 6, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Modal */}
      <AddVehicleModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={(v) => {
          onAddVehicle(v);
          setIsModalOpen(false);
        }}
      />
    </div>
  );
}
