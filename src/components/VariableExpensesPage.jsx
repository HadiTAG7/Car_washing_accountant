import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, Layers, Scale, CalendarClock, Activity, Calendar, Car,
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
import { useWashes } from '../hooks/useWashes';
import { isSupabaseConfigured, missingEnvNames, describeSupabaseError } from '../lib/supabaseClient';
import {
  todayMonth,
  formatMonthLabel,
  listAvailableMonths,
  sumCompletedWashQuantityInMonth,
  variableItemsForMonth,
} from '../lib/variableExpenseTotals';

// ─── Live wash counter readout (driven by the Washes module) ──────────────
function WashCounterReadout({ washCount, monthLabel }) {
  return (
    <div className="rounded-2xl border border-primary-100 bg-gradient-to-l from-primary-50 to-white shadow-sm p-5">
      <div className="flex items-start gap-4">
        <div className="bg-primary-700 text-white w-12 h-12 rounded-2xl flex items-center justify-center shrink-0">
          <Layers size={22} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-primary-700 font-bold tracking-wide">
            إجمالي الغسلات المكتملة — {monthLabel}
          </p>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-extrabold text-slate-900 tabular-nums">
              {formatNumber(washCount)}
            </span>
            <span className="text-sm text-slate-500">غسلة</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 bg-primary-100 border border-primary-200 rounded-md px-2 py-0.5">
              <Car size={11} strokeWidth={2.5} />
              تلقائي
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            يُحسب تلقائياً من سجل الغسلات المكتملة للشهر المحدد ويغذّي عداد عمولات البايكرز.
          </p>
        </div>
      </div>
    </div>
  );
}

function PeriodSelectorCard({ value, onChange, options }) {
  return (
    <div className="rounded-2xl border border-primary-100 bg-gradient-to-l from-primary-50 to-white shadow-sm p-5">
      <div className="flex items-start gap-4">
        <div className="bg-primary-700 text-white w-12 h-12 rounded-2xl flex items-center justify-center shrink-0">
          <Calendar size={22} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <label htmlFor="variable-period" className="block text-xs text-primary-700 font-bold tracking-wide">
            فترة العرض (الشهر)
          </label>
          <select
            id="variable-period"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1.5 w-full max-w-xs px-4 py-2.5 border border-primary-200 rounded-xl bg-white text-base font-bold text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-300"
          >
            {options.map((ym) => (
              <option key={ym} value={ym}>{formatMonthLabel(ym)}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            اختر الشهر لعرض مصاريفه المتغيرة. عمولات البايكرز تُحسب تلقائياً من غسلات الشهر المحدد.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onAdd, monthLabel }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="bg-primary-50 text-primary-700 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
        <Activity size={26} />
      </div>
      <p className="text-base font-bold text-slate-800 mb-1">
        لا توجد مصاريف متغيرة مسجّلة لشهر {monthLabel}
      </p>
      <p className="text-sm text-slate-500 mb-5 max-w-sm">
        سجّل أول مصروف متغير (مستلزمات، حوافز، نقل...) لتبدأ متابعة تكلفة الوحدة لهذا الشهر.
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

  const { items: washes } = useWashes();

  const [selectedMonth, setSelectedMonth] = useState(todayMonth());

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

  const availableMonths = useMemo(
    () => listAvailableMonths(washes, items),
    [washes, items],
  );

  const washCountInMonth = useMemo(
    () => sumCompletedWashQuantityInMonth(washes, selectedMonth),
    [washes, selectedMonth],
  );

  // displayedItems = one virtual row per (dynamic category × biker who
  // worked this month) + manual non-dynamic rows logged in this month.
  // The helper consumes raw `washes` and handles filtering + grouping.
  const displayedItems = useMemo(
    () => variableItemsForMonth({
      manualItems: items,
      categories,
      selectedMonth,
      washes,
    }),
    [items, categories, selectedMonth, washes],
  );

  const totals = useMemo(() => {
    let cost = 0, units = 0;
    displayedItems.forEach((row) => {
      cost  += row.totalVariableCost || 0;
      units += row.quantity || 0;
    });
    const weightedUnitCost = units > 0 ? cost / units : 0;
    return { cost, units, weightedUnitCost };
  }, [displayedItems]);

  const monthLabel = formatMonthLabel(selectedMonth);

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
    if (item.isVirtual) return; // safety: virtual rows have no DB id
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
        subtitle="تتبّع تكاليف الغسلة الواحدة، العمولات، والمستلزمات المتغيرة حسب الشهر"
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

        <PeriodSelectorCard
          value={selectedMonth}
          onChange={setSelectedMonth}
          options={availableMonths}
        />

        <WashCounterReadout washCount={washCountInMonth} monthLabel={monthLabel} />

        {/* ── KPI summary ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <StatCard
            icon={Wallet}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="إجمالي المصاريف المتغيرة"
            value={formatCurrency(totals.cost)}
            sub={`${displayedItems.length} ${displayedItems.length === 1 ? 'بند' : 'بنود'} لشهر ${monthLabel}`}
          />
          <StatCard
            icon={Layers}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            label="عدد الغسلات / الوحدات المدعومة"
            value={formatNumber(totals.units)}
            sub={
              totals.units === 0
                ? 'لم تُسجَّل وحدات في هذا الشهر بعد'
                : `موزّعة على ${displayedItems.length} ${displayedItems.length === 1 ? 'بند' : 'بنود'}`
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
            title={`سجل المصاريف المتغيرة — ${monthLabel}`}
            subtitle="عمولات البايكرز مُضمّنة تلقائياً وفق غسلات الشهر؛ الباقي بنود مسجّلة يدوياً"
            action={
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة مصروف متغير
              </PrimaryButton>
            }
          />

          {loading && !displayedItems.length ? (
            <LoadingState rows={4} />
          ) : displayedItems.length === 0 ? (
            <EmptyState onAdd={openAddModal} monthLabel={monthLabel} />
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
                  {displayedItems.map((i) => (
                    <tr
                      key={i.id}
                      className={`border-b border-slate-50 transition-colors ${i.isVirtual ? 'bg-primary-50/30 hover:bg-primary-50/50' : 'hover:bg-slate-50/60'}`}
                    >
                      <td className="py-3 px-4 font-medium text-slate-800 align-top">
                        <div>{i.expenseName}</div>
                        {i.isVirtual && (
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                            {i.bikerName
                              ? `محسوب تلقائياً من غسلات ${i.bikerName} لشهر ${monthLabel}`
                              : `محسوب تلقائياً من إجمالي غسلات شهر ${monthLabel}`}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top">
                        <span className="inline-flex text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
                          {getCategoryLabel(i.categoryId)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center tabular-nums text-slate-700 align-top">
                        <span className="inline-flex items-center justify-center gap-1.5">
                          <span>{formatNumber(i.quantity)}</span>
                          {i.isVirtual && (
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
                        {formatCurrency(i.totalVariableCost)}
                      </td>
                      <td className="py-3 px-4 text-slate-600 align-top">
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <CalendarClock size={13} className="text-slate-400" />
                          {i.isVirtual ? monthLabel : formatLoggedDate(i.loggedDate)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left align-top">
                        {i.isVirtual ? (
                          <span className="text-slate-300 text-sm">—</span>
                        ) : (
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
                        )}
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
        washCount={washCountInMonth}
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
