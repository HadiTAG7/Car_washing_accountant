import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, Layers, Scale, CalendarClock, Activity,
  Check, X,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
} from './UI';
import AddVariableExpenseModal from './AddVariableExpenseModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useVariableExpenses } from '../hooks/useVariableExpenses';
import { useVariableExpenseCategories } from '../hooks/useVariableExpenseCategories';
import { useSettings } from '../hooks/useSettings';
import { isSupabaseConfigured, missingEnvNames, describeSupabaseError } from '../lib/supabaseClient';

// ─── Wash counter widget — single source of truth for dynamic rules ───────
function WashCounterCard({ washCount, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(String(washCount));
  const [saving, setSaving]   = useState(false);

  function start() {
    setDraft(String(washCount));
    setEditing(true);
  }
  function cancel() {
    setDraft(String(washCount));
    setEditing(false);
  }
  async function commit() {
    const n = Math.max(0, parseInt(draft, 10) || 0);
    if (n === washCount) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(n); setEditing(false); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-2xl border border-primary-100 bg-gradient-to-l from-primary-50 to-white shadow-sm p-5">
      <div className="flex items-start gap-4">
        <div className="bg-primary-700 text-white w-12 h-12 rounded-2xl flex items-center justify-center shrink-0">
          <Layers size={22} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-primary-700 font-bold tracking-wide">إجمالي الغسلات المحققة (الفترة الحالية)</p>
          <div className="flex items-baseline gap-3 mt-1">
            {editing ? (
              <>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
                    if (e.key === 'Escape') { cancel(); }
                  }}
                  autoFocus
                  className="w-40 px-3 py-1.5 border border-primary-200 rounded-lg text-2xl font-extrabold text-slate-900 tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
                />
                <button
                  type="button"
                  onClick={commit}
                  disabled={saving}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white transition-colors"
                  aria-label="حفظ"
                >
                  <Check size={16} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 transition-colors"
                  aria-label="إلغاء"
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <>
                <span className="text-3xl font-extrabold text-slate-900 tabular-nums">
                  {formatNumber(washCount)}
                </span>
                <span className="text-sm text-slate-500">غسلة</span>
                <button
                  type="button"
                  onClick={start}
                  className="text-primary-700 hover:text-primary-900 p-1.5 rounded-lg hover:bg-primary-100 transition-colors"
                  title="تعديل العداد"
                  aria-label="تعديل العداد"
                >
                  <Pencil size={15} />
                </button>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            تتغير تكلفة العمولات المرتبطة بالغسلات تلقائياً عند تعديل هذا العداد.
          </p>
        </div>
      </div>
    </div>
  );
}

// Compute the effective (display-time) quantity + total for a row,
// honoring the row's category-level is_dynamic flag.
function effectiveRow(item, categoryMap, washCount) {
  const cat    = categoryMap.get(item.categoryId);
  const isRule = Boolean(cat?.isDynamic);
  if (isRule) {
    return {
      quantity:           washCount,
      totalVariableCost:  washCount * item.unitCost,
      isRule:             true,
    };
  }
  return {
    quantity:           item.quantity,
    totalVariableCost:  item.totalVariableCost,
    isRule:             false,
  };
}

function EmptyState({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="bg-primary-50 text-primary-700 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
        <Activity size={26} />
      </div>
      <p className="text-base font-bold text-slate-800 mb-1">لا توجد مصاريف متغيرة بعد</p>
      <p className="text-sm text-slate-500 mb-5 max-w-sm">
        سجّل أول مصروف متغير (عمولات، مستلزمات لكل غسلة، حوافز...) لتبدأ متابعة تكلفة الوحدة.
      </p>
      <PrimaryButton icon={Plus} onClick={onAdd}>
        إضافة مصروف متغير
      </PrimaryButton>
    </div>
  );
}

function formatLoggedDate(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(d);
  } catch {
    return value;
  }
}

export default function VariableExpensesPage() {
  const {
    items, loading, error,
    addItem, updateItem, deleteItem, refetch,
  } = useVariableExpenses();

  const {
    categories, addCategory, getCategoryLabel,
  } = useVariableExpenseCategories();

  const { value: washSettings, setValue: saveWashSettings } =
    useSettings('total_achieved_washes', { count: 0 });
  const washCount = Math.max(0, parseInt(washSettings?.count, 10) || 0);

  const [localOpen, setLocalOpen]         = useState(false);
  const [editingItem, setEditingItem]     = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => {
    setToast((t) => ({ ...t, open: false }));
  }, []);

  const isModalOpen = localOpen || Boolean(editingItem);
  function openAddModal()      { setEditingItem(null); setLocalOpen(true); }
  function openEditModal(item) { setLocalOpen(false); setEditingItem(item); }
  function closeModal()        { setLocalOpen(false); setEditingItem(null); }

  // Categories keyed by id, so the table + KPI calc can cheaply look up
  // each row's dynamic flag.
  const categoryMap = useMemo(() => {
    const m = new Map();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  // Compose effective rows once — every other render branch reads from
  // here so the dashboard auto-scales when the wash counter changes.
  const effectiveItems = useMemo(
    () => items.map((i) => ({ ...i, _eff: effectiveRow(i, categoryMap, washCount) })),
    [items, categoryMap, washCount],
  );

  const totals = useMemo(() => {
    let cost = 0, units = 0;
    effectiveItems.forEach((row) => {
      cost  += row._eff.totalVariableCost;
      units += row._eff.quantity;
    });
    const weightedUnitCost = units > 0 ? cost / units : 0;
    return { cost, units, weightedUnitCost };
  }, [effectiveItems]);

  async function handleSaveWashCount(nextCount) {
    try {
      await saveWashSettings({ count: nextCount });
      showToast('تم تحديث عداد الغسلات');
    } catch (e) {
      console.error('Wash counter save error:', e);
      showToast(describeSupabaseError(e) || 'تعذّر تحديث العداد', 'error');
    }
  }

  async function handleAddItem(item) {
    try { await addItem(item); showToast('تم إضافة المصروف المتغير بنجاح'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateItem(id, updates) {
    try { await updateItem(id, updates); showToast('تم حفظ التعديلات'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleAddCategory(label) {
    try {
      const newId = await addCategory({ label });
      showToast('تم إضافة التصنيف الجديد بنجاح');
      return newId;
    } catch (e) {
      console.error('Supabase Category Error:', e, 'label:', label);
      showToast(describeSupabaseError(e) || 'تعذّر إضافة التصنيف الجديد', 'error');
      throw e;
    }
  }
  async function handleDelete(item) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`هل تريد حذف "${item.expenseName}"؟ لا يمكن التراجع.`)
      : true;
    if (!confirmed) return;
    try { await deleteItem(item.id); showToast('تم حذف المصروف'); }
    catch (e) { setMutationError(e); }
  }

  return (
    <>
      <TopBar
        title="المصاريف المتغيرة"
        subtitle="تتبّع تكاليف الغسلة الواحدة، العمولات، والمستلزمات المتغيرة"
      />

      <main className="p-8 space-y-6">
        {!isSupabaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {mutationError && (
          <ErrorState
            title="تعذّر حفظ التغييرات"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}

        {error && (
          <ErrorState
            title="تعذّر تحميل المصاريف المتغيرة"
            error={error}
            onRetry={refetch}
          />
        )}

        <WashCounterCard washCount={washCount} onSave={handleSaveWashCount} />

        {/* ── KPI summary ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <StatCard
            icon={Wallet}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="إجمالي المصاريف المتغيرة"
            value={formatCurrency(totals.cost)}
            sub={`${items.length} ${items.length === 1 ? 'بند' : 'بنود'}`}
          />
          <StatCard
            icon={Layers}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            label="عدد الغسلات / الوحدات المدعومة"
            value={formatNumber(totals.units)}
            sub={
              items.length === 0
                ? 'لم تُسجَّل وحدات بعد'
                : `موزّعة على ${items.length} ${items.length === 1 ? 'تسجيل' : 'تسجيلات'}`
            }
          />
          <StatCard
            icon={Scale}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            label="متوسط تكلفة الوحدة"
            value={formatCurrency(totals.weightedUnitCost)}
            sub={
              totals.units > 0
                ? `${formatCurrency(totals.cost)} ÷ ${formatNumber(totals.units)} وحدة`
                : 'يحسب تلقائياً بعد تسجيل أول وحدة'
            }
          />
        </div>

        {/* ── Main table ─────────────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="سجل المصاريف المتغيرة"
            subtitle="كل بند مسجّل بتاريخه — افتح بنداً للتعديل الكامل أو احذفه"
            action={
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة مصروف متغير
              </PrimaryButton>
            }
          />

          {loading && !items.length ? (
            <LoadingState rows={4} />
          ) : items.length === 0 ? (
            <EmptyState onAdd={openAddModal} />
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 uppercase border-b border-slate-100">
                    <th className="py-3 px-4">المصروف</th>
                    <th className="py-3 px-4">التصنيف</th>
                    <th className="py-3 px-4 text-center tabular-nums">عدد الغسلات / الوحدات</th>
                    <th className="py-3 px-4 text-left tabular-nums">تكلفة الوحدة</th>
                    <th className="py-3 px-4 text-left tabular-nums">الإجمالي المتغير</th>
                    <th className="py-3 px-4">تاريخ الصرف</th>
                    <th className="py-3 px-4 text-left w-20">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveItems.map((i) => (
                    <tr
                      key={i.id}
                      className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-slate-800 align-top">{i.expenseName}</td>
                      <td className="py-3 px-4 align-top">
                        <span className="inline-flex text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
                          {getCategoryLabel(i.categoryId)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center tabular-nums text-slate-700 align-top">
                        <span className="inline-flex items-center justify-center gap-1.5">
                          <span>{formatNumber(i._eff.quantity)}</span>
                          {i._eff.isRule && (
                            <span
                              className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 border border-primary-100 text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                              title="يُحسب تلقائياً من عداد الغسلات"
                            >
                              <Activity size={9} strokeWidth={2.5} />
                              تلقائي
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left tabular-nums text-slate-700 align-top">
                        {formatCurrency(i.unitCost)}
                      </td>
                      <td className="py-3 px-4 text-left tabular-nums font-bold text-slate-900 align-top">
                        {formatCurrency(i._eff.totalVariableCost)}
                      </td>
                      <td className="py-3 px-4 text-slate-600 align-top">
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <CalendarClock size={13} className="text-slate-400" />
                          {formatLoggedDate(i.loggedDate)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left align-top">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(i)}
                            className="text-slate-400 hover:text-primary-700 p-1.5 rounded-lg hover:bg-primary-50 transition-colors"
                            aria-label={`تعديل ${i.expenseName}`}
                            title="تعديل المصروف"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(i)}
                            className="text-slate-400 hover:text-accent-600 p-1.5 rounded-lg hover:bg-accent-50 transition-colors"
                            aria-label={`حذف ${i.expenseName}`}
                            title="حذف المصروف"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>

      <AddVariableExpenseModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
        onAddCategory={handleAddCategory}
        categories={categories}
        initialValues={editingItem}
        washCount={washCount}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        tone={toast.tone}
        duration={toast.duration}
        onClose={closeToast}
      />
    </>
  );
}
