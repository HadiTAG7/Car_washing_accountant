import { useMemo, useState } from 'react';
import {
  Plus, Wallet, TrendingDown, PiggyBank, Truck, Download, Trash2,
} from 'lucide-react';
import {
  calcAnnualDepreciation,
  calcBookValue,
  formatCurrency,
  formatNumber,
  getCategoryLabel,
  exportToCSV,
  CATEGORIES,
} from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, ProgressBar,
  PrimaryButton, SecondaryButton, StatusBadge,
} from './UI';
import AddItemModal from './AddItemModal';
import AddAssetModal from './AddAssetModal';

// ─── Category group progress card ────────────────────────────────────────────
function CategoryGroupCard({ label, budgeted, actual }) {
  const variance = budgeted - actual;
  const pct      = budgeted > 0 ? Math.min((actual / budgeted) * 100, 100) : 0;
  const over     = variance < 0;
  const color    = over ? 'red' : pct >= 90 ? 'amber' : 'emerald';

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs text-slate-500 mb-1">{label}</p>
          <p className="text-lg font-extrabold text-slate-900 tabular-nums">
            {formatCurrency(actual)}
          </p>
        </div>
        <span
          className={`text-[11px] font-bold px-2 py-1 rounded-lg ${
            over ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {over ? '▲' : '▼'} {formatCurrency(Math.abs(variance))}
        </span>
      </div>
      <ProgressBar value={pct} color={color} />
      <div className="flex justify-between text-[11px] text-slate-500 mt-2">
        <span>الفعلي {pct.toFixed(0)}%</span>
        <span>من أصل {formatCurrency(budgeted)}</span>
      </div>
    </div>
  );
}

export default function StartupPage({
  items, assets, onAddItem, onUpdateActual, onDeleteItem,
  onAddAsset, onDeleteAsset,
}) {
  const [isItemModalOpen,  setIsItemModalOpen]  = useState(false);
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);

  // ── Totals ───────────────────────────────────────────────────
  const totals = useMemo(() => {
    const budgeted = items.reduce((s, i) => s + i.budgeted, 0);
    const actual   = items.reduce((s, i) => s + i.actual,   0);
    return { budgeted, actual, savings: budgeted - actual };
  }, [items]);

  // ── Category groupings ───────────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map();
    items.forEach((i) => {
      const cur = map.get(i.category) || { budgeted: 0, actual: 0 };
      map.set(i.category, { budgeted: cur.budgeted + i.budgeted, actual: cur.actual + i.actual });
    });
    return CATEGORIES
      .map((cat) => ({ ...cat, ...(map.get(cat.id) || { budgeted: 0, actual: 0 }) }))
      .filter((g) => g.budgeted > 0);
  }, [items]);

  function handleExport() {
    exportToCSV(
      'monster-wash-startup-costs.csv',
      ['التصنيف', 'اسم البند', 'الميزانية', 'الفعلي', 'الفرق'],
      items.map((i) => [
        getCategoryLabel(i.category),
        i.itemName,
        i.budgeted,
        i.actual,
        i.budgeted - i.actual,
      ]),
    );
  }

  return (
    <>
      <TopBar
        title="التأسيس والأصول"
        subtitle="مراقبة تكاليف الإطلاق وإهلاك الأصول الثابتة"
        actions={
          <SecondaryButton icon={Download} onClick={handleExport} className="hidden md:inline-flex">
            تصدير CSV
          </SecondaryButton>
        }
      />

      <main className="p-8 space-y-6">
        {/* ── KPI Summary cards ───────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <StatCard
            icon={Wallet}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="إجمالي الميزانية المخططة"
            value={formatCurrency(totals.budgeted)}
            sub="الميزانية المعتمدة للإطلاق"
          />
          <StatCard
            icon={TrendingDown}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            label="الإنفاق الفعلي"
            value={formatCurrency(totals.actual)}
            sub={`${((totals.actual / totals.budgeted) * 100).toFixed(1)}% من الميزانية`}
          />
          <StatCard
            icon={PiggyBank}
            iconBg={totals.savings >= 0 ? 'bg-emerald-50' : 'bg-red-50'}
            iconColor={totals.savings >= 0 ? 'text-emerald-600' : 'text-red-600'}
            label={totals.savings >= 0 ? 'الوفورات المحققة' : 'تجاوز الميزانية'}
            value={formatCurrency(Math.abs(totals.savings))}
            trend={`${((Math.abs(totals.savings) / totals.budgeted) * 100).toFixed(1)}%`}
            trendPositive={totals.savings >= 0}
          />
        </div>

        {/* ── Progress by category ────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="التكاليف حسب الفئة"
            subtitle="نظرة مجمّعة على الميزانية الفعلية لكل فئة تأسيس"
            action={
              <PrimaryButton icon={Plus} onClick={() => setIsItemModalOpen(true)}>
                إضافة بند جديد
              </PrimaryButton>
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {grouped.map((g) => (
              <CategoryGroupCard
                key={g.id}
                label={g.label}
                budgeted={g.budgeted}
                actual={g.actual}
              />
            ))}
          </div>
        </Card>

        {/* ── Detailed line-item table ─────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="تفاصيل البنود"
            subtitle="تحرير الإنفاق الفعلي لكل بند أو حذف البنود غير الضرورية"
          />
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-[11px] font-bold text-slate-500 uppercase border-b border-slate-100">
                  <th className="py-3 px-4">التصنيف</th>
                  <th className="py-3 px-4">اسم البند</th>
                  <th className="py-3 px-4 text-left tabular-nums">الميزانية</th>
                  <th className="py-3 px-4 text-left tabular-nums">الفعلي</th>
                  <th className="py-3 px-4 text-left tabular-nums">الفرق</th>
                  <th className="py-3 px-4">الحالة</th>
                  <th className="py-3 px-4 text-left w-16">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const variance = i.budgeted - i.actual;
                  const status = variance > 0 ? 'under' : variance < 0 ? 'over' : 'on';
                  const label  = variance > 0 ? 'ضمن الميزانية' : variance < 0 ? 'تجاوز' : 'مطابق';
                  return (
                    <tr key={i.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4">
                        <span className="inline-flex text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
                          {getCategoryLabel(i.category)}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">{i.itemName}</td>
                      <td className="py-3 px-4 text-left tabular-nums text-slate-700">
                        {formatCurrency(i.budgeted)}
                      </td>
                      <td className="py-3 px-4 text-left">
                        <input
                          type="number"
                          value={i.actual}
                          onChange={(e) =>
                            onUpdateActual(i.id, parseFloat(e.target.value) || 0)
                          }
                          className="w-28 px-2 py-1 border border-slate-200 rounded-lg text-sm text-left tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-200"
                        />
                      </td>
                      <td
                        className={`py-3 px-4 text-left tabular-nums font-bold ${
                          variance > 0 ? 'text-emerald-600' : variance < 0 ? 'text-red-600' : 'text-slate-500'
                        }`}
                      >
                        {variance > 0 ? '−' : variance < 0 ? '+' : ''}
                        {formatCurrency(Math.abs(variance))}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={status}>{label}</StatusBadge>
                      </td>
                      <td className="py-3 px-4 text-left">
                        <button
                          onClick={() => onDeleteItem(i.id)}
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

        {/* ── Depreciation table ─────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="جدول إهلاك الأصول الثابتة"
            subtitle="طريقة القسط الثابت — يتم حساب القيمة الدفترية تلقائياً بناءً على تاريخ الشراء"
            action={
              <PrimaryButton icon={Plus} onClick={() => setIsAssetModalOpen(true)}>
                إضافة أصل جديد
              </PrimaryButton>
            }
          />
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-[11px] font-bold text-slate-500 uppercase border-b border-slate-100">
                  <th className="py-3 px-4">الأصل</th>
                  <th className="py-3 px-4">تاريخ الشراء</th>
                  <th className="py-3 px-4 text-left tabular-nums">تكلفة الشراء</th>
                  <th className="py-3 px-4 text-left tabular-nums">قيمة الخردة</th>
                  <th className="py-3 px-4 text-center">العمر الإنتاجي</th>
                  <th className="py-3 px-4 text-left tabular-nums">الإهلاك السنوي</th>
                  <th className="py-3 px-4 text-left tabular-nums">القيمة الدفترية</th>
                  <th className="py-3 px-4 text-left w-16">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const annual = calcAnnualDepreciation(a.purchaseCost, a.salvageValue, a.usefulLife);
                  const bv     = calcBookValue(a.purchaseCost, a.salvageValue, a.usefulLife, a.purchaseDate);
                  const used   = a.purchaseCost > a.salvageValue
                    ? ((a.purchaseCost - bv) / (a.purchaseCost - a.salvageValue)) * 100
                    : 0;
                  return (
                    <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-800 flex items-center gap-2">
                        <span className="bg-primary-50 text-primary-700 w-8 h-8 rounded-lg flex items-center justify-center">
                          <Truck size={14} />
                        </span>
                        {a.assetName}
                      </td>
                      <td className="py-3 px-4 text-slate-600 tabular-nums">{a.purchaseDate}</td>
                      <td className="py-3 px-4 text-left tabular-nums text-slate-700">
                        {formatCurrency(a.purchaseCost)}
                      </td>
                      <td className="py-3 px-4 text-left tabular-nums text-slate-500">
                        {formatCurrency(a.salvageValue)}
                      </td>
                      <td className="py-3 px-4 text-center text-slate-600">
                        {formatNumber(a.usefulLife)} سنة
                      </td>
                      <td className="py-3 px-4 text-left tabular-nums text-red-600 font-semibold">
                        −{formatCurrency(annual)}
                      </td>
                      <td className="py-3 px-4 text-left">
                        <div className="flex flex-col items-end gap-1">
                          <span className="tabular-nums font-bold text-slate-900">
                            {formatCurrency(bv)}
                          </span>
                          <div className="w-24">
                            <ProgressBar value={100 - used} color="primary" />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-left">
                        <button
                          onClick={() => onDeleteAsset(a.id)}
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
      </main>

      {/* Modals */}
      <AddItemModal
        isOpen={isItemModalOpen}
        onClose={() => setIsItemModalOpen(false)}
        onAdd={onAddItem}
      />
      <AddAssetModal
        isOpen={isAssetModalOpen}
        onClose={() => setIsAssetModalOpen(false)}
        onAdd={onAddAsset}
      />
    </>
  );
}
