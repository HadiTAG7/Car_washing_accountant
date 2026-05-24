import { useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, Receipt, Scale, FileText,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
} from './UI';
import AddStartupFeeModal from './AddStartupFeeModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { useStartupCosts } from '../hooks/useStartupCosts';
import { useCategories } from '../hooks/useCategories';
import { isSupabaseConfigured, missingEnvNames } from '../lib/supabaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

// ─── Status toggle pill (in_progress ↔ completed) ──────────────────────────
function StatusTogglePill({ status, onChange, disabled }) {
  const isCompleted = status === 'completed';
  const next        = isCompleted ? 'in_progress' : 'completed';
  const classes = isCompleted
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100'
    : 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100';
  const dot = isCompleted ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(next)}
      disabled={disabled}
      title={disabled
        ? 'غير متاح في وضع عرض الشريك'
        : isCompleted ? 'انقر لإعادة الحالة إلى قيد التنفيذ' : 'انقر لإنهاء البند'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${classes} ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {isCompleted ? 'مكتمل' : 'قيد التنفيذ'}
    </button>
  );
}

// ─── Empty-state for the table area ────────────────────────────────────────
function EmptyState({ onAdd, canMutate }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="bg-primary-50 text-primary-700 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
        <FileText size={26} />
      </div>
      <p className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">لا توجد بنود تأسيس بعد</p>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 max-w-sm">
        {canMutate
          ? 'أضف أول بند رسوم تأسيس لبدء تتبع الميزانية والصرف الفعلي.'
          : 'لم يقم المشرف بتسجيل أي بند بعد.'}
      </p>
      {canMutate && (
        <PrimaryButton icon={Plus} onClick={onAdd}>
          إضافة رسوم تأسيس
        </PrimaryButton>
      )}
    </div>
  );
}

export default function StartupPage({ pendingEntry, onClearPendingEntry }) {
  const {
    items, loading, error,
    addItem, updateItem, updateActual, updateStatus, deleteItem, refetch,
  } = useStartupCosts();

  const { categories, getCategoryLabel } = useCategories();
  const { scalingFactor, canMutate } = usePartnerView();

  const [localOpen, setLocalOpen]       = useState(false);
  const [editingItem, setEditingItem]   = useState(null);
  const [mutationError, setMutationError] = useState(null);

  const isModalOpen = localOpen || Boolean(editingItem) || pendingEntry === 'item';
  function openAddModal()        { setEditingItem(null); setLocalOpen(true); }
  function openEditModal(item)   { setLocalOpen(false); setEditingItem(item); }
  function closeModal() {
    setLocalOpen(false);
    setEditingItem(null);
    if (pendingEntry) onClearPendingEntry?.();
  }

  // Pro-rata: every total/per-row figure on this page is scaled by the
  // viewing partner's workforce share. For the admin view scalingFactor=1
  // so the math collapses to identity.
  const totals = useMemo(() => {
    const planned = items.reduce((s, i) => s + i.plannedAmount, 0) * scalingFactor;
    const actual  = items.reduce((s, i) => s + i.actualAmount,  0) * scalingFactor;
    const variance = planned - actual;
    return { planned, actual, variance, ok: variance >= 0 };
  }, [items, scalingFactor]);

  async function handleAddItem(item) {
    try { await addItem(item); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateItem(id, updates) {
    try { await updateItem(id, updates); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateActual(id, next, current) {
    if (next === current) return;
    try { await updateActual(id, next); }
    catch (e) { setMutationError(e); }
  }
  async function handleUpdateStatus(id, status) {
    try { await updateStatus(id, status); }
    catch (e) { setMutationError(e); }
  }
  async function handleDelete(id) {
    try { await deleteItem(id); }
    catch (e) { setMutationError(e); }
  }

  return (
    <>
      <TopBar
        title="رسوم التأسيس"
        subtitle="تتبع المصاريف التأسيسية لمرة واحدة لامتياز سويتر"
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
            title="تعذّر تحميل بنود التأسيس"
            error={error}
            onRetry={refetch}
          />
        )}

        {/* ── KPI summary ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          <StatCard
            icon={Wallet}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="إجمالي الميزانية المخططة"
            value={formatCurrency(totals.planned)}
            sub={`${items.length} ${items.length === 1 ? 'بند' : 'بنود'}`}
          />
          <StatCard
            icon={Receipt}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            label="إجمالي الصرف الفعلي"
            value={formatCurrency(totals.actual)}
            sub={
              totals.planned > 0
                ? `${((totals.actual / totals.planned) * 100).toFixed(0)}% من الميزانية`
                : 'لا توجد ميزانية بعد'
            }
          />
          <StatCard
            icon={Scale}
            iconBg={totals.ok ? 'bg-emerald-50' : 'bg-accent-50'}
            iconColor={totals.ok ? 'text-emerald-600' : 'text-accent-600'}
            label={totals.ok ? 'المتبقي من الميزانية' : 'تجاوز الميزانية'}
            value={formatCurrency(Math.abs(totals.variance))}
            sub={totals.ok ? 'ضمن الحدود المخططة' : 'الإنفاق تجاوز المخطط'}
          />
        </div>

        {/* ── Main sunk-costs table ───────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="بنود رسوم التأسيس"
            subtitle={canMutate
              ? 'حرّر المبلغ الفعلي أو الحالة مباشرةً من الجدول'
              : 'عرض حصّتك من بنود التأسيس (للقراءة فقط)'}
            action={canMutate ? (
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة رسوم تأسيس
              </PrimaryButton>
            ) : null}
          />

          {loading && !items.length ? (
            <LoadingState rows={4} />
          ) : items.length === 0 ? (
            <EmptyState onAdd={openAddModal} canMutate={canMutate} />
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">البند</th>
                    <th className="py-3 px-4 whitespace-nowrap">التصنيف</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المبلغ المخطط</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المبلغ الفعلي</th>
                    <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left w-16">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const qty = Math.max(1, parseInt(i.quantity, 10) || 1);
                    // Scale displayed per-row figures so the sum of rows
                    // matches the scaled KPI totals above. unit price is
                    // a *rate* — scale before dividing by quantity.
                    const rowPlanned = i.plannedAmount * scalingFactor;
                    const rowActual  = i.actualAmount  * scalingFactor;
                    const unitPlanned = qty > 0 ? rowPlanned / qty : 0;
                    return (
                      <tr
                        key={i.id}
                        className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 whitespace-nowrap align-top">
                          <div className="font-medium text-slate-800 dark:text-slate-200">{i.itemName}</div>
                          {qty > 1 && (
                            <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 tabular-nums">
                              الكمية: {formatNumber(qty)} | سعر الوحدة: {formatCurrency(unitPlanned)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap align-top">
                          <span className="inline-flex text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-md">
                            {getCategoryLabel(i.category)}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300 align-top">
                          {formatCurrency(rowPlanned)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left align-top">
                          {canMutate ? (
                            <input
                              type="number"
                              min="0"
                              step="any"
                              defaultValue={i.actualAmount}
                              onBlur={(e) => {
                                const next = parseFloat(e.target.value);
                                const safe = Number.isFinite(next) ? Math.max(0, next) : 0;
                                handleUpdateActual(i.id, safe, i.actualAmount);
                              }}
                              aria-label={`المبلغ الفعلي لـ ${i.itemName}`}
                              className="w-28 px-2 py-1 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 font-medium text-left tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-300"
                            />
                          ) : (
                            <span className="tabular-nums text-slate-700 dark:text-slate-300 font-medium">
                              {formatCurrency(rowActual)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap align-top">
                          <StatusTogglePill
                            status={i.status}
                            onChange={(next) => handleUpdateStatus(i.id, next)}
                            disabled={!canMutate}
                          />
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left align-top">
                          {canMutate && (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditModal(i)}
                                className="text-slate-400 dark:text-slate-500 hover:text-primary-700 p-1.5 rounded-lg hover:bg-primary-50 transition-colors"
                                aria-label={`تعديل ${i.itemName}`}
                                title="تعديل البند"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(i.id)}
                                className="text-slate-400 dark:text-slate-500 hover:text-accent-600 p-1.5 rounded-lg hover:bg-accent-50 transition-colors"
                                aria-label={`حذف ${i.itemName}`}
                                title="حذف البند"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          )}
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

      <AddStartupFeeModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
        categories={categories}
        initialValues={editingItem}
      />
    </>
  );
}
