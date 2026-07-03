import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, CheckCircle2, Clock, CalendarClock, Calendar, Receipt,
} from 'lucide-react';
import { formatCurrency, formatNumber, MONTHLY_EXPENSE_CATEGORIES } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
} from './UI';
import AddMonthlyExpenseModal from './AddMonthlyExpenseModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useMonthlyExpenses } from '../hooks/useMonthlyExpenses';
import { useMonthlyExpenseCategories } from '../hooks/useMonthlyExpenseCategories';
import { isSupabaseConfigured, missingEnvNames, describeSupabaseError } from '../lib/supabaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

// ─── Status toggle pill (paid ↔ pending; flashes red when due today) ──────
function PaymentStatusPill({ status, dueToday, onChange, disabled }) {
  const isPaid = status === 'paid';
  const next   = isPaid ? 'pending' : 'paid';
  const dueAndPending = dueToday && !isPaid;
  let classes, dotClass;
  if (isPaid) {
    classes  = 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100';
    dotClass = 'bg-emerald-500';
  } else if (dueAndPending) {
    classes  = 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100';
    dotClass = 'bg-red-500 animate-pulse';
  } else {
    classes  = 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100';
    dotClass = 'bg-amber-500';
  }
  const title = disabled
    ? 'غير متاح في وضع عرض الشريك'
    : isPaid
      ? 'انقر للتراجع إلى قيد الانتظار'
      : (dueAndPending
          ? 'موعد الصرف اليوم — اضغط لتسجيل المدفوع'
          : 'انقر لتسجيل المصروف كمدفوع');
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(next)}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${classes} ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {isPaid ? 'مدفوع' : 'قيد الانتظار'}
    </button>
  );
}

// Returns true if today's day-of-month matches the recurring payment day.
function isMonthlyDueToday(paymentDay) {
  if (!paymentDay) return false;
  return new Date().getDate() === Number(paymentDay);
}

function EmptyState({ onAdd, canMutate }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="bg-primary-50 text-primary-700 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
        <Receipt size={26} />
      </div>
      <p className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">لا توجد مصاريف شهرية بعد</p>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 max-w-sm">
        {canMutate
          ? 'أضف أول مصروف شهري متكرر لمتابعة التكاليف التشغيلية الجارية.'
          : 'لم يقم المشرف بتسجيل أي مصروف شهري بعد.'}
      </p>
      {canMutate && (
        <PrimaryButton icon={Plus} onClick={onAdd}>
          إضافة مصروف شهري
        </PrimaryButton>
      )}
    </div>
  );
}

function formatPaymentDay(day) {
  if (!day) return '—';
  return `يوم ${formatNumber(day)} من الشهر`;
}

// Pretty-prints a YYYY-MM-DD into an Arabic date with Latin digits.
function formatLoggedDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric', month: 'short', day: 'numeric',
      numberingSystem: 'latn',
    }).format(d);
  } catch {
    return iso;
  }
}

export default function MonthlyExpensesPage() {
  const {
    items, loading, error,
    addItem, updateItem, updateStatus, deleteItem, refetch,
  } = useMonthlyExpenses();

  const {
    categories, addCategory, deleteCategory, getCategoryLabel,
  } = useMonthlyExpenseCategories();

  const { scalingFactor, canMutate } = usePartnerView();

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

  const totals = useMemo(() => {
    let total = 0, paid = 0, pending = 0;
    items.forEach((i) => {
      total += i.totalMonthlyCost;
      if (i.paymentStatus === 'paid') paid += i.totalMonthlyCost;
      else pending += i.totalMonthlyCost;
    });
    // Pro-rata: every aggregate is multiplied by the viewing partner's
    // workforce share. Admin view → scalingFactor=1 → identity math.
    return {
      total:   total   * scalingFactor,
      paid:    paid    * scalingFactor,
      pending: pending * scalingFactor,
    };
  }, [items, scalingFactor]);

  async function handleAddItem(item) {
    try { await addItem(item); showToast('تم إضافة المصروف الشهري بنجاح'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateItem(id, updates) {
    try { await updateItem(id, updates); showToast('تم حفظ التعديلات'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateStatus(id, status) {
    try { await updateStatus(id, status); }
    catch (e) { setMutationError(e); }
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
        title="المصاريف الشهرية"
        subtitle="متابعة المصاريف التشغيلية الشهرية المتكررة"
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
            title="تعذّر تحميل المصاريف الشهرية"
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
            label="إجمالي المصاريف الشهرية"
            value={formatCurrency(totals.total)}
            sub={`${items.length} ${items.length === 1 ? 'مصروف' : 'مصاريف'}`}
          />
          <StatCard
            icon={CheckCircle2}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            label="مصاريف مدفوعة"
            value={formatCurrency(totals.paid)}
            sub={
              totals.total > 0
                ? `${((totals.paid / totals.total) * 100).toFixed(0)}% من الإجمالي`
                : 'لا توجد مدفوعات بعد'
            }
          />
          <StatCard
            icon={Clock}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            label="مصاريف معلقة"
            value={formatCurrency(totals.pending)}
            sub={
              totals.total > 0
                ? `${((totals.pending / totals.total) * 100).toFixed(0)}% من الإجمالي`
                : 'لا توجد مصاريف معلقة'
            }
          />
        </div>

        {/* ── Main table ─────────────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="بنود المصاريف الشهرية"
            subtitle={canMutate
              ? 'حرّر الحالة مباشرةً من الجدول أو افتح بند للتعديل الكامل'
              : 'عرض حصّتك من المصاريف الشهرية (للقراءة فقط)'}
            action={canMutate ? (
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة مصروف شهري
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
                    <th className="py-3 px-4 whitespace-nowrap">المصروف</th>
                    <th className="py-3 px-4 whitespace-nowrap">التصنيف</th>
                    <th className="py-3 px-4 whitespace-nowrap text-center tabular-nums">الكمية</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">تكلفة الوحدة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الإجمالي الشهري</th>
                    <th className="py-3 px-4 whitespace-nowrap">التكرار / الموعد</th>
                    <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left w-20">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr
                      key={i.id}
                      className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap align-top">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{i.expenseName}</div>
                        {i.quantity > 1 && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 tabular-nums">
                            الكمية: {formatNumber(i.quantity)} | تكلفة الوحدة: {formatCurrency(i.unitCost * scalingFactor)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap align-top">
                        <span className="inline-flex text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-md">
                          {getCategoryLabel(i.categoryId)}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums text-slate-700 dark:text-slate-300 align-top">
                        {formatNumber(i.quantity)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300 align-top">
                        {formatCurrency(i.unitCost * scalingFactor)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-slate-900 dark:text-slate-100 align-top">
                        {formatCurrency(i.totalMonthlyCost * scalingFactor)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400 align-top">
                        {i.recurrence === 'one_time' ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-md border border-accent-200 dark:border-accent-500/40 bg-accent-50 dark:bg-accent-500/15 text-accent-700 dark:text-accent-300 text-[10px] font-bold">
                              مرة واحدة
                            </span>
                            <span className="inline-flex items-center gap-1.5 tabular-nums text-[12px]">
                              <Calendar size={13} className="text-slate-400 dark:text-slate-500" />
                              {formatLoggedDate(i.loggedDate)}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-md border border-primary-200 dark:border-primary-500/40 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 text-[10px] font-bold">
                              متكرر شهرياً
                            </span>
                            <span className="inline-flex items-center gap-1.5 tabular-nums text-[12px]">
                              <CalendarClock size={13} className="text-slate-400 dark:text-slate-500" />
                              {formatPaymentDay(i.paymentDay)}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap align-top">
                        <PaymentStatusPill
                          status={i.paymentStatus}
                          dueToday={i.recurrence !== 'one_time' && isMonthlyDueToday(i.paymentDay)}
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
                              aria-label={`تعديل ${i.expenseName}`}
                              title="تعديل المصروف"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(i)}
                              className="text-slate-400 dark:text-slate-500 hover:text-accent-600 p-1.5 rounded-lg hover:bg-accent-50 transition-colors"
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

      <AddMonthlyExpenseModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
        onAddCategory={handleAddCategory}
        onDeleteCategory={handleDeleteCategory}
        categories={categories}
        protectedCategoryLabels={MONTHLY_EXPENSE_CATEGORIES.map((c) => c.label)}
        initialValues={editingItem}
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
