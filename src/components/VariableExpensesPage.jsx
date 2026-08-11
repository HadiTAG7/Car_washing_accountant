import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, Layers, Scale, CalendarClock, Activity, Calendar, Car,
  Percent, Link as LinkIcon,
} from 'lucide-react';
import {
  formatCurrency, formatCurrencyPrecise, formatNumber, extractVat, VARIABLE_EXPENSE_CATEGORIES,
} from '../data/initialData';

// Only http(s) values become clickable — same guard the ledger and the VAT
// report use, so a pasted `javascript:` URL can never become a live anchor.
function isSafeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
  EmptyState as EmptyStateShell,
} from './UI';
import AddVariableExpenseModal from './AddVariableExpenseModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useVariableExpenses } from '../hooks/useVariableExpenses';
import { useVariableExpenseCategories } from '../hooks/useVariableExpenseCategories';
import { useWashes } from '../hooks/useWashes';
import { isSupabaseConfigured, missingEnvNames, describeSupabaseError } from '../lib/supabaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';
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
    <div
      className="rounded-smallcard border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 transition-colors duration-200"
      style={{ boxShadow: 'var(--sw-shadow-card)' }}
    >
      <div className="flex items-start gap-4">
        <div className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-11 h-11 sm:w-12 sm:h-12 rounded-control flex items-center justify-center shrink-0">
          <Layers size={22} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
            إجمالي الغسلات المكتملة — {monthLabel}
          </p>
          <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 mt-1">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatNumber(washCount)}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">غسلة</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-500/15 border border-primary-100 dark:border-primary-500/30 rounded-control px-2 py-0.5">
              <Car size={11} strokeWidth={2.5} />
              تلقائي
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
            يُحسب تلقائياً من سجل الغسلات المكتملة للشهر المحدد ويغذّي عداد عمولات البايكرز.
          </p>
        </div>
      </div>
    </div>
  );
}

function PeriodSelectorCard({ value, onChange, options }) {
  return (
    <div
      className="rounded-smallcard border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 transition-colors duration-200"
      style={{ boxShadow: 'var(--sw-shadow-card)' }}
    >
      <div className="flex items-start gap-4">
        <div className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-11 h-11 sm:w-12 sm:h-12 rounded-control flex items-center justify-center shrink-0">
          <Calendar size={22} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <label htmlFor="variable-period" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            فترة العرض (الشهر)
          </label>
          <select
            id="variable-period"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full max-w-xs px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-semibold tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
          >
            {options.map((ym) => (
              <option key={ym} value={ym}>{formatMonthLabel(ym)}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
            اختر الشهر لعرض مصاريفه المتغيرة. عمولات البايكرز تُحسب تلقائياً من غسلات الشهر المحدد.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onAdd, monthLabel, canMutate }) {
  return (
    <EmptyStateShell
      icon={Activity}
      title={`لا توجد مصاريف متغيرة مسجّلة لشهر ${monthLabel}`}
      hint={canMutate
        ? 'سجّل أول مصروف متغير (مستلزمات، حوافز، نقل...) لتبدأ متابعة تكلفة الوحدة لهذا الشهر.'
        : 'لم يُسجَّل أي مصروف متغير لهذا الشهر بعد.'}
      action={canMutate ? (
        <PrimaryButton icon={Plus} onClick={onAdd}>
          إضافة مصروف متغير
        </PrimaryButton>
      ) : null}
    />
  );
}

function formatLoggedDate(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric', numberingSystem: 'latn',
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
    categories, addCategory, deleteCategory, getCategoryLabel,
  } = useVariableExpenseCategories();

  const { items: washes } = useWashes();
  const { scalingFactor, canMutate } = usePartnerView();

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
    // weightedUnitCost is a RATE (cost ÷ units), not a total — both
    // numerator and denominator scale identically so the ratio stays
    // the same for the partner view. Only cost + units (the totals)
    // are pro-rated.
    const weightedUnitCost = units > 0 ? cost / units : 0;
    return {
      cost:  cost  * scalingFactor,
      units: Math.round(units * scalingFactor),
      weightedUnitCost,
    };
  }, [displayedItems, scalingFactor]);

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
  async function handleDeleteCategory(id) {
    try {
      await deleteCategory(id);
      showToast('تم حذف التصنيف من القوائم');
    } catch (e) {
      showToast(describeSupabaseError(e) || 'تعذّر حذف التصنيف', 'error');
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

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
          <StatCard
            className="col-span-2 md:col-span-1"
            icon={Wallet}
            tone="primary"
            label="إجمالي المصاريف المتغيرة"
            value={formatCurrency(totals.cost)}
            sub={`${displayedItems.length} ${displayedItems.length === 1 ? 'بند' : 'بنود'} لشهر ${monthLabel}`}
          />
          <StatCard
            icon={Layers}
            tone="emerald"
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
            tone="amber"
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
            subtitle={canMutate
              ? 'عمولات البايكرز مُضمّنة تلقائياً وفق غسلات الشهر؛ الباقي بنود مسجّلة يدوياً'
              : 'عرض حصّتك من المصاريف المتغيرة للشهر (للقراءة فقط)'}
            action={canMutate ? (
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة مصروف متغير
              </PrimaryButton>
            ) : null}
          />

          {loading && !displayedItems.length ? (
            <LoadingState rows={4} />
          ) : displayedItems.length === 0 ? (
            <EmptyState onAdd={openAddModal} monthLabel={monthLabel} canMutate={canMutate} />
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">المصروف</th>
                    <th className="py-3 px-4 whitespace-nowrap">التصنيف</th>
                    <th className="py-3 px-4 whitespace-nowrap text-center tabular-nums">عدد الغسلات / الوحدات</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">تكلفة الوحدة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الإجمالي المتغير</th>
                    <th className="py-3 px-4 whitespace-nowrap">تاريخ الصرف</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left w-20">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedItems.map((i) => (
                    <tr
                      key={i.id}
                      className={`border-b border-slate-50 dark:border-slate-800/60 last:border-0 transition-colors ${i.isVirtual ? 'bg-primary-50/60 dark:bg-primary-500/10 hover:bg-primary-50 dark:hover:bg-primary-500/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                    >
                      <td className="py-3 px-4 whitespace-normal break-words min-w-[180px] font-medium text-slate-800 dark:text-slate-200 align-top">
                        <div>{i.expenseName}</div>
                        {i.isVirtual && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                            {i.bikerName
                              ? `محسوب تلقائياً من غسلات ${i.bikerName} لشهر ${monthLabel}`
                              : `محسوب تلقائياً من إجمالي غسلات شهر ${monthLabel}`}
                          </p>
                        )}
                        {/* Tax invoice: reclaimable VAT inline + a link to the
                            invoice, so the row is self-verifying at filing time. */}
                        {i.isTaxInvoice && (
                          <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-500/30 px-2 py-0.5 rounded-full tabular-nums">
                              <Percent size={11} />
                              ض.ق.م: {formatCurrencyPrecise(extractVat(i.totalVariableCost) * scalingFactor)}
                            </span>
                            {i.invoiceUrl && isSafeHttpUrl(i.invoiceUrl) && (
                              <a
                                href={i.invoiceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={i.invoiceUrl}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:underline"
                              >
                                <LinkIcon size={11} />
                                الفاتورة
                              </a>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap align-top">
                        <span className="inline-flex text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-control">
                          {getCategoryLabel(i.categoryId)}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums text-slate-700 dark:text-slate-300 align-top">
                        <span className="inline-flex items-center justify-center gap-1.5">
                          <span>{formatNumber(i.quantity)}</span>
                          {i.isVirtual && (
                            <span
                              className="inline-flex items-center gap-1 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-100 dark:border-primary-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-control"
                              title="يُحسب تلقائياً من عداد الغسلات"
                            >
                              <Activity size={9} strokeWidth={2.5} />
                              تلقائي
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300 align-top">
                        {/* Scaled like the row total so qty × unit = total
                            stays visibly true in partner view (same
                            pattern as Startup/Monthly). */}
                        {formatCurrency(i.unitCost * scalingFactor)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-slate-900 dark:text-slate-100 align-top">
                        {formatCurrency((i.totalVariableCost || 0) * scalingFactor)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400 align-top">
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <CalendarClock size={13} className="text-slate-500 dark:text-slate-400" />
                          {i.isVirtual ? monthLabel : formatLoggedDate(i.loggedDate)}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left align-top">
                        {i.isVirtual || !canMutate ? (
                          <span className="text-slate-300 dark:text-slate-600 text-sm">—</span>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(i)}
                              className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/15 transition-colors"
                              aria-label={`تعديل ${i.expenseName}`}
                              title="تعديل المصروف"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(i)}
                              className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
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
        onDeleteCategory={handleDeleteCategory}
        categories={categories}
        protectedCategoryLabels={VARIABLE_EXPENSE_CATEGORIES.map((c) => c.label)}
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
