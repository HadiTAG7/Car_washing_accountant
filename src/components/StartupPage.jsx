import { useMemo, useState } from 'react';
import {
  Plus, Wallet, TrendingDown, PiggyBank, Truck, Download, Trash2,
  Pencil, X, Check, Target, CircleDollarSign,
} from 'lucide-react';
import {
  calcAnnualDepreciation,
  calcBookValue,
  formatCurrency,
  formatNumber,
  exportToCSV,
} from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, ProgressBar,
  PrimaryButton, SecondaryButton, StatusBadge,
} from './UI';
import AddItemModal from './AddItemModal';
import AddAssetModal from './AddAssetModal';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import { useStartupCosts } from '../hooks/useStartupCosts';
import { useAssets } from '../hooks/useAssets';
import { useCategories } from '../hooks/useCategories';
import { useSettings } from '../hooks/useSettings';

// ─── Master budget tracker ──────────────────────────────────────────────────
function BudgetTracker({ totalBudget, spent, onSetBudget }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const remaining = totalBudget - spent;
  const pct       = totalBudget > 0 ? Math.min((spent / totalBudget) * 100, 100) : 0;
  const overBudget = remaining < 0;

  function handleSave() {
    const val = parseFloat(draft);
    if (val > 0) onSetBudget(val);
    setEditing(false);
  }

  return (
    <Card className="p-6 bg-gradient-to-l from-primary-50/60 to-white border-primary-100">
      <div className="flex flex-col md:flex-row md:items-center gap-6">
        {/* Budget amount */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Target size={18} className="text-primary-600" />
            <span className="text-sm font-bold text-slate-700">ميزانية المشروع</span>
          </div>
          {editing ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-48 px-3 py-2 border border-primary-300 rounded-xl text-lg font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400"
                autoFocus
                placeholder="0"
                min="0"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
              />
              <span className="text-sm text-slate-500">ر.س</span>
              <button onClick={handleSave} className="text-emerald-600 hover:text-emerald-800 p-1"><Check size={18} /></button>
              <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-3xl font-extrabold text-slate-900 tabular-nums">
                {totalBudget > 0 ? formatCurrency(totalBudget) : '—'}
              </span>
              <button
                onClick={() => { setDraft(totalBudget > 0 ? String(totalBudget) : ''); setEditing(true); }}
                className="text-slate-400 hover:text-primary-600 p-1 rounded-lg hover:bg-primary-50 transition-colors"
                title="تعديل الميزانية"
              >
                <Pencil size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Spent */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <CircleDollarSign size={16} className="text-amber-500" />
            <span className="text-xs font-semibold text-slate-500">تم صرفه</span>
          </div>
          <p className="text-xl font-extrabold text-slate-800 tabular-nums">{formatCurrency(spent)}</p>
        </div>

        {/* Remaining */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <PiggyBank size={16} className={overBudget ? 'text-red-500' : 'text-emerald-500'} />
            <span className="text-xs font-semibold text-slate-500">
              {overBudget ? 'تجاوز' : 'المتبقي'}
            </span>
          </div>
          <p className={`text-xl font-extrabold tabular-nums ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
            {formatCurrency(Math.abs(remaining))}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {totalBudget > 0 && (
        <div className="mt-5">
          <div className="flex justify-between text-[11px] text-slate-500 mb-1.5">
            <span>صُرف {pct.toFixed(1)}% من الميزانية</span>
            <span>{overBudget ? 'تجاوز الميزانية!' : `باقي ${formatCurrency(remaining)}`}</span>
          </div>
          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                overBudget ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {totalBudget === 0 && (
        <p className="text-sm text-slate-400 mt-3">
          اضغط على أيقونة القلم لتحديد ميزانية المشروع الإجمالية
        </p>
      )}
    </Card>
  );
}

// ─── Category group progress card ────────────────────────────────────────────
function CategoryGroupCard({ label, budgeted, actual, onEdit, onDelete }) {
  const [editing, setEditing]     = useState(false);
  const [editLabel, setEditLabel] = useState(label);
  const variance = budgeted - actual;
  const pct      = budgeted > 0 ? Math.min((actual / budgeted) * 100, 100) : 0;
  const over     = variance < 0;
  const color    = over ? 'red' : pct >= 90 ? 'amber' : 'emerald';

  function handleSave() {
    if (editLabel.trim() && editLabel.trim() !== label) {
      onEdit(editLabel.trim());
    }
    setEditing(false);
  }

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-1.5 mb-1">
              <input
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="px-2 py-0.5 border border-primary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 w-full"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
              />
              <button onClick={handleSave} className="text-emerald-600 hover:text-emerald-800 p-0.5"><Check size={14} /></button>
              <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-600 p-0.5"><X size={14} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-xs text-slate-500">{label}</p>
              {onEdit && (
                <button onClick={() => { setEditLabel(label); setEditing(true); }} className="text-slate-300 hover:text-primary-600 p-0.5 rounded transition-colors">
                  <Pencil size={11} />
                </button>
              )}
              {onDelete && (
                <button onClick={onDelete} className="text-slate-300 hover:text-red-500 p-0.5 rounded transition-colors">
                  <X size={11} />
                </button>
              )}
            </div>
          )}
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

export default function StartupPage() {
  const {
    items, loading: itemsLoading, error: itemsError,
    addItem, updateActual, deleteItem, refetch: refetchItems,
  } = useStartupCosts();

  const {
    assets, loading: assetsLoading, error: assetsError,
    addAsset, deleteAsset, refetch: refetchAssets,
  } = useAssets();

  const {
    categories,
    addCategory, updateCategory, deleteCategory, getCategoryLabel,
  } = useCategories();

  const { value: budgetSettings, setValue: saveBudgetSettings } = useSettings('project_budget', { total: 0 });

  const [isItemModalOpen,  setIsItemModalOpen]  = useState(false);
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [mutationError,    setMutationError]    = useState(null);

  // ── Totals ───────────────────────────────────────────────────
  const totals = useMemo(() => {
    const budgeted = items.reduce((s, i) => s + i.budgeted, 0);
    const actual   = items.reduce((s, i) => s + i.actual,   0);
    return { budgeted, actual, savings: budgeted - actual };
  }, [items]);

  const totalSpent = useMemo(() => {
    const itemsActual  = items.reduce((s, i) => s + i.actual, 0);
    const assetsActual = assets.reduce((s, a) => s + a.purchaseCost, 0);
    return itemsActual + assetsActual;
  }, [items, assets]);

  // ── Category groupings ───────────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map();
    items.forEach((i) => {
      const cur = map.get(i.category) || { budgeted: 0, actual: 0 };
      map.set(i.category, { budgeted: cur.budgeted + i.budgeted, actual: cur.actual + i.actual });
    });
    return categories
      .map((cat) => ({ ...cat, ...(map.get(cat.id) || { budgeted: 0, actual: 0 }) }))
      .filter((g) => g.budgeted > 0);
  }, [items, categories]);

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

  // ── Mutation wrappers that surface errors in the UI ──────────
  async function handleAddItem(newItem) {
    try { await addItem(newItem); }
    catch (e) { setMutationError(e); }
  }
  async function handleUpdateActual(id, value) {
    try { await updateActual(id, value); }
    catch (e) { setMutationError(e); }
  }
  async function handleDeleteItem(id) {
    try { await deleteItem(id); }
    catch (e) { setMutationError(e); }
  }
  async function handleAddAsset(newAsset) {
    try { await addAsset(newAsset); }
    catch (e) { setMutationError(e); }
  }
  async function handleDeleteAsset(id) {
    try { await deleteAsset(id); }
    catch (e) { setMutationError(e); }
  }
  async function handleAddCategory(cat) {
    try { await addCategory(cat); }
    catch (e) { setMutationError(e); }
  }
  async function handleUpdateCategory(id, label) {
    try { await updateCategory(id, label); }
    catch (e) { setMutationError(e); }
  }
  async function handleDeleteCategory(id) {
    try { await deleteCategory(id); }
    catch (e) { setMutationError(e); }
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
        {mutationError && (
          <ErrorState
            title="تعذّر حفظ التغييرات"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}

        {/* ── Master budget tracker ──────────────────────────── */}
        <BudgetTracker
          totalBudget={budgetSettings.total}
          spent={totalSpent}
          onSetBudget={(val) => saveBudgetSettings({ ...budgetSettings, total: val })}
        />

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
            sub={totals.budgeted > 0 ? `${((totals.actual / totals.budgeted) * 100).toFixed(1)}% من الميزانية` : '—'}
          />
          <StatCard
            icon={PiggyBank}
            iconBg={totals.savings >= 0 ? 'bg-emerald-50' : 'bg-red-50'}
            iconColor={totals.savings >= 0 ? 'text-emerald-600' : 'text-red-600'}
            label={totals.savings >= 0 ? 'الوفورات المحققة' : 'تجاوز الميزانية'}
            value={formatCurrency(Math.abs(totals.savings))}
            trend={totals.budgeted > 0 ? `${((Math.abs(totals.savings) / totals.budgeted) * 100).toFixed(1)}%` : undefined}
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
          {itemsError && <ErrorState error={itemsError} onRetry={refetchItems} />}
          {itemsLoading && !items.length
            ? <LoadingState rows={3} />
            : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {grouped.map((g) => (
                  <CategoryGroupCard
                    key={g.id}
                    label={g.label}
                    budgeted={g.budgeted}
                    actual={g.actual}
                    onEdit={(newLabel) => handleUpdateCategory(g.id, newLabel)}
                    onDelete={() => handleDeleteCategory(g.id)}
                  />
                ))}
              </div>
            )}
        </Card>

        {/* ── Detailed line-item table ─────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="تفاصيل البنود"
            subtitle="تحرير الإنفاق الفعلي لكل بند أو حذف البنود غير الضرورية"
          />
          {itemsLoading && !items.length ? <LoadingState rows={5} /> : (
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
                            defaultValue={i.actual}
                            onBlur={(e) => {
                              const next = parseFloat(e.target.value) || 0;
                              if (next !== i.actual) handleUpdateActual(i.id, next);
                            }}
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
                            onClick={() => handleDeleteItem(i.id)}
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
          )}
        </Card>

        {/* ── Depreciation table ─────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="جدول إهلاك الأصول الثابتة"
            subtitle="طريقة القسط الثابت — القيمة الدفترية تُحسب تلقائياً من تاريخ الشراء والعمر الإنتاجي"
            action={
              <PrimaryButton icon={Plus} onClick={() => setIsAssetModalOpen(true)}>
                إضافة أصل جديد
              </PrimaryButton>
            }
          />
          {assetsError && <ErrorState error={assetsError} onRetry={refetchAssets} />}
          {assetsLoading && !assets.length ? <LoadingState rows={4} /> : (
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
                            onClick={() => handleDeleteAsset(a.id)}
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
          )}
        </Card>
      </main>

      {/* Modals */}
      <AddItemModal
        isOpen={isItemModalOpen}
        onClose={() => setIsItemModalOpen(false)}
        onAdd={handleAddItem}
        categories={categories}
        onAddCategory={handleAddCategory}
      />
      <AddAssetModal
        isOpen={isAssetModalOpen}
        onClose={() => setIsAssetModalOpen(false)}
        onAdd={handleAddAsset}
      />
    </>
  );
}
