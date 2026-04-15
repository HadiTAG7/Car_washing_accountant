import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  MapPin, TrendingUp, Award, Trash2, Plus, X, Download,
} from 'lucide-react';
import {
  formatCurrency, formatNumber, formatPercent, exportToCSV,
} from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, PrimaryButton, SecondaryButton, ProgressBar,
} from './UI';

const ROUTE_COLORS = ['#2a3c70', '#3f528a', '#5f70a8', '#8b9bcb'];

// ─── Inline Add-Vehicle Modal ───────────────────────────────────────────────
function AddVehicleModal({ isOpen, onClose, onAdd }) {
  const [form, setForm] = useState({
    vehicleName: '', route: '', monthlyRevenue: '', directCosts: '',
    allocatedFixedCosts: '', assetCost: '',
  });

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.vehicleName.trim() || !form.route.trim()) return;
    onAdd({
      vehicleName: form.vehicleName.trim(),
      route:       form.route.trim(),
      monthlyRevenue:      parseFloat(form.monthlyRevenue)      || 0,
      directCosts:         parseFloat(form.directCosts)         || 0,
      allocatedFixedCosts: parseFloat(form.allocatedFixedCosts) || 0,
      assetCost:           parseFloat(form.assetCost)           || 0,
    });
    setForm({
      vehicleName: '', route: '', monthlyRevenue: '', directCosts: '',
      allocatedFixedCosts: '', assetCost: '',
    });
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Plus size={20} className="text-primary-700" />
            إضافة مركبة جديدة
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <ModalField label="اسم المركبة" name="vehicleName" value={form.vehicleName} onChange={handleChange} required />
            <ModalField label="المسار"      name="route"       value={form.route}       onChange={handleChange} required />
            <ModalField label="الإيراد الشهري (ر.س)"  name="monthlyRevenue"      value={form.monthlyRevenue}      onChange={handleChange} type="number" />
            <ModalField label="التكاليف المباشرة (ر.س)" name="directCosts"        value={form.directCosts}        onChange={handleChange} type="number" />
            <ModalField label="التكاليف الثابتة المخصصة" name="allocatedFixedCosts" value={form.allocatedFixedCosts} onChange={handleChange} type="number" />
            <ModalField label="تكلفة الأصل (ر.س)"       name="assetCost"          value={form.assetCost}          onChange={handleChange} type="number" />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 bg-primary-800 hover:bg-primary-900 text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={18} /> إضافة المركبة
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalField({ label, name, value, onChange, type = 'text', required }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        min={type === 'number' ? '0' : undefined}
        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
      />
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function RoutesPage({ vehicles, onAddVehicle, onDeleteVehicle }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // ── Derived metrics ────────────────────────────────────
  const enriched = useMemo(
    () =>
      vehicles
        .map((v) => {
          const totalCost = v.directCosts + v.allocatedFixedCosts;
          const profit    = v.monthlyRevenue - totalCost;
          const margin    = v.monthlyRevenue > 0 ? profit / v.monthlyRevenue : 0;
          const roa       = v.assetCost > 0 ? (profit * 12) / v.assetCost : 0;
          return { ...v, totalCost, profit, margin, roa };
        })
        .sort((a, b) => b.profit - a.profit),
    [vehicles],
  );

  const mostProfitable = enriched[0];
  const totalRevenue   = enriched.reduce((s, v) => s + v.monthlyRevenue, 0);
  const totalProfit    = enriched.reduce((s, v) => s + v.profit, 0);
  const overallMargin  = totalRevenue > 0 ? totalProfit / totalRevenue : 0;

  const chartData = enriched.map((v) => ({
    name:    v.route,
    الإيراد: v.monthlyRevenue,
    الربح:   v.profit,
  }));

  function handleExport() {
    exportToCSV(
      'monster-wash-routes.csv',
      ['المركبة', 'المسار', 'الإيراد', 'التكلفة', 'الربح', 'الهامش', 'ROA'],
      enriched.map((v) => [
        v.vehicleName, v.route, v.monthlyRevenue, v.totalCost,
        v.profit, formatPercent(v.margin, 1), formatPercent(v.roa, 1),
      ]),
    );
  }

  return (
    <>
      <TopBar
        title="ربحية المسارات والأسطول"
        subtitle="مقارنة الأداء المالي لكل مركبة ومسار — وتحديد المسارات الأكثر ربحاً"
        actions={
          <SecondaryButton icon={Download} onClick={handleExport} className="hidden md:inline-flex">
            تصدير CSV
          </SecondaryButton>
        }
      />

      <main className="p-8 space-y-6">
        {/* ── Hero grid: Most profitable card + chart ────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Most profitable — dark card */}
          {mostProfitable && (
            <div className="bg-gradient-to-br from-primary-800 to-primary-950 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
              <div className="absolute -top-10 -left-10 w-40 h-40 bg-white/5 rounded-full blur-2xl" />
              <div className="absolute -bottom-16 -right-10 w-48 h-48 bg-primary-500/10 rounded-full blur-3xl" />

              <div className="relative">
                <div className="flex items-center gap-2 mb-4">
                  <span className="bg-white/10 w-10 h-10 rounded-xl flex items-center justify-center">
                    <Award size={20} className="text-amber-300" />
                  </span>
                  <div>
                    <p className="text-xs text-primary-200">أعلى مسار ربحاً</p>
                    <p className="text-[11px] text-primary-300">الأداء الشهري</p>
                  </div>
                </div>

                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <MapPin size={17} className="text-primary-300" />
                  {mostProfitable.route}
                </h3>
                <p className="text-[11px] text-primary-300 mb-6">{mostProfitable.vehicleName}</p>

                <div className="mb-4">
                  <p className="text-[11px] text-primary-300 mb-1">إجمالي الإيراد الشهري</p>
                  <p className="text-3xl font-extrabold tabular-nums">
                    {formatNumber(mostProfitable.monthlyRevenue)}
                    <span className="text-base font-semibold text-primary-200 mr-2">ر.س</span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                    <p className="text-[10px] text-primary-300 mb-1">صافي الربح</p>
                    <p className="text-base font-bold tabular-nums">
                      {formatCurrency(mostProfitable.profit)}
                    </p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                    <p className="text-[10px] text-primary-300 mb-1">هامش الربح</p>
                    <p className="text-base font-bold tabular-nums text-emerald-300">
                      {formatPercent(mostProfitable.margin, 1)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Comparison chart */}
          <Card className="lg:col-span-2 p-6">
            <SectionHeader
              title="مقارنة الإيرادات والأرباح حسب المسار"
              subtitle="أعمدة الإيراد مقابل الربح الصافي لكل مسار"
            />
            <div className="h-72 chart-ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}ك`}
                  />
                  <Tooltip
                    formatter={(v) => [formatCurrency(v), '']}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontFamily: 'Tajawal' }}
                    labelStyle={{ fontFamily: 'Tajawal' }}
                  />
                  <Bar dataKey="الإيراد" radius={[6, 6, 0, 0]} maxBarSize={40}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={ROUTE_COLORS[i % ROUTE_COLORS.length]} />
                    ))}
                  </Bar>
                  <Bar dataKey="الربح" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 mt-4 text-xs">
              <Legend color="#2a3c70" label="الإيراد الشهري" />
              <Legend color="#10b981" label="الربح الصافي" />
            </div>
          </Card>
        </div>

        {/* ── Summary strip ────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <SummaryStrip
            label="إجمالي الإيراد الشهري"
            value={formatCurrency(totalRevenue)}
            sub={`عبر ${formatNumber(enriched.length)} مسار نشط`}
            color="primary"
          />
          <SummaryStrip
            label="إجمالي الربح الصافي"
            value={formatCurrency(totalProfit)}
            sub="بعد التكاليف المباشرة والثابتة"
            color={totalProfit >= 0 ? 'emerald' : 'red'}
          />
          <SummaryStrip
            label="هامش الربح العام"
            value={formatPercent(overallMargin, 1)}
            sub="مؤشر الكفاءة الإجمالي للأسطول"
            color={overallMargin >= 0.2 ? 'emerald' : overallMargin >= 0 ? 'amber' : 'red'}
          />
        </div>

        {/* ── ROA / Details table ──────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="تفاصيل الربحية حسب المركبة"
            subtitle="العائد على الأصل (ROA) والهامش وصافي الربح لكل مركبة في الأسطول"
            action={
              <PrimaryButton icon={Plus} onClick={() => setIsModalOpen(true)}>
                إضافة مركبة
              </PrimaryButton>
            }
          />
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-[11px] font-bold text-slate-500 uppercase border-b border-slate-100">
                  <th className="py-3 px-4">المركبة</th>
                  <th className="py-3 px-4">المسار</th>
                  <th className="py-3 px-4 text-left tabular-nums">الإيراد</th>
                  <th className="py-3 px-4 text-left tabular-nums">التكلفة</th>
                  <th className="py-3 px-4 text-left tabular-nums">صافي الربح</th>
                  <th className="py-3 px-4 text-left tabular-nums">الهامش</th>
                  <th className="py-3 px-4 text-left">ROA (سنوي)</th>
                  <th className="py-3 px-4 text-left w-16">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {enriched.map((v, idx) => (
                  <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-8 rounded-sm"
                          style={{ backgroundColor: ROUTE_COLORS[idx % ROUTE_COLORS.length] }}
                        />
                        {v.vehicleName}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <span className="inline-flex items-center gap-1 text-slate-700">
                        <MapPin size={13} /> {v.route}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-left tabular-nums text-slate-800">
                      {formatCurrency(v.monthlyRevenue)}
                    </td>
                    <td className="py-3 px-4 text-left tabular-nums text-slate-500">
                      {formatCurrency(v.totalCost)}
                    </td>
                    <td
                      className={`py-3 px-4 text-left tabular-nums font-bold ${
                        v.profit >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {formatCurrency(v.profit)}
                    </td>
                    <td className="py-3 px-4 text-left tabular-nums">
                      <span className={`font-semibold ${
                        v.margin >= 0.3 ? 'text-emerald-600' : v.margin >= 0.15 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {formatPercent(v.margin, 1)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-left min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-[60px]">
                          <ProgressBar
                            value={Math.max(0, Math.min(100, v.roa * 100))}
                            color={v.roa >= 0.4 ? 'emerald' : v.roa >= 0.15 ? 'amber' : 'red'}
                          />
                        </div>
                        <span className="tabular-nums text-slate-800 font-semibold text-xs">
                          {formatPercent(v.roa, 1)}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-left">
                      <button
                        onClick={() => onDeleteVehicle(v.id)}
                        className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        aria-label="حذف"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </main>

      <AddVehicleModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={onAddVehicle}
      />
    </>
  );
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-2 text-slate-600">
      <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </div>
  );
}

function SummaryStrip({ label, value, sub, color }) {
  const ring = {
    primary: 'ring-primary-100 text-primary-800',
    emerald: 'ring-emerald-100 text-emerald-700',
    amber:   'ring-amber-100 text-amber-700',
    red:     'ring-red-100 text-red-700',
  }[color];
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 p-5 shadow-sm ring-4 ${ring?.split(' ')[0]}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-extrabold tabular-nums ${ring?.split(' ')[1] || ''}`}>
        {value}
      </p>
      <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
        <TrendingUp size={11} /> {sub}
      </p>
    </div>
  );
}
