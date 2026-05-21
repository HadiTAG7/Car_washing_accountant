import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, CheckCircle2, Clock, CalendarRange, Repeat,
} from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
} from './UI';
import AddAnnualExpenseModal from './AddAnnualExpenseModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useAnnualExpenses } from '../hooks/useAnnualExpenses';
import { useAnnualExpenseCategories } from '../hooks/useAnnualExpenseCategories';
import { isSupabaseConfigured, missingEnvNames } from '../lib/supabaseClient';

// ─── Status toggle pill (paid ↔ pending) ───────────────────────────────────
function PaymentStatusPill({ status, onChange }) {
  const isPaid = status === 'paid';
  const next   = isPaid ? 'pending' : 'paid';
  const classes = isPaid
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100'
    : 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100';
  const dot = isPaid ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={isPaid ? 'انقر للتراجع إلى قيد الانتظار' : 'انقر لتسجيل المصروف كمدفوع'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${classes}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {isPaid ? 'مدفوع' : 'قيد الانتظار'}
    </button>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="bg-primary-50 text-primary-700 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
        <Repeat size={26} />
      </div>
      <p className="text-base font-bold text-slate-800 mb-1">لا توجد مصاريف سنوية بعد</p>
      <p className="text-sm text-slate-500 mb-5 max-w-sm">
        أضف أول مصروف سنوي متكرر لمتابعة التكاليف التشغيلية المستمرة.
      </p>
      <PrimaryButton icon={Plus} onClick={onAdd}>
        إضافة مصروف سنوي
      </PrimaryButton>
    </div>
  );
}

function formatDueDate(value) {
  if (!value) return '—';
  // Stored as 'YYYY-MM-DD' from the date input; render in ar-SA locale.
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

export default function AnnualExpensesPage() {
  const {
    items, loading, error,
    addItem, updateItem, updateStatus, deleteItem, refetch,
  } = useAnnualExpenses();

  const {
    categories, addCategory, getCategoryLabel,
  } = useAnnualExpenseCategories();

  const [localOpen, setLocalOpen]         = useState(false);
  const [editingItem, setEditingItem]     = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast]                 = useState({ open: false, message: '', tone: 'success' });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone });
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
      total += i.annualCost;
      if (i.paymentStatus === 'paid') paid += i.annualCost;
      else pending += i.annualCost;
    });
    return { total, paid, pending };
  }, [items]);

  async function handleAddItem(item) {
    try { await addItem(item); showToast('تم إضافة المصروف بنجاح'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateItem(id, updates) {
    try { await updateItem(id, updates); showToast('تم حفظ التعديلات'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleAddCategory(label) {
    const newId = await addCategory({ label });
    showToast('تم إضافة التصنيف الجديد بنجاح');
    return newId;
  }
  async function handleUpdateStatus(id, status) {
    try { await updateStatus(id, status); }
    catch (e) { setMutationError(e); }
  }
  async function handleDelete(item) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`هل تريد حذف "${item.expenseName}"؟ لا يمكن التراجع.`)
      : true;
    if (!confirmed) return;
    try { await deleteItem(item.id); }
    catch (e) { setMutationError(e); }
  }

  return (
    <>
      <TopBar
        title="المصاريف السنوية"
        subtitle="متابعة المصاريف التشغيلية المتكررة للأسطول والامتياز"
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
            title="تعذّر تحميل المصاريف السنوية"
            error={error}
            onRetry={refetch}
          />
        )}

        {/* ── KPI summary ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <StatCard
            icon={Wallet}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="إجمالي المصاريف السنوية"
            value={formatCurrency(totals.total)}
            sub={`${items.length} ${items.length === 1 ? 'مصروف' : 'مصاريف'}`}
          />
          <StatCard
            icon={CheckCircle2}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            label="المصاريف المدفوعة"
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
            title="بنود المصاريف السنوية"
            subtitle="حرّر الحالة مباشرةً من الجدول أو افتح بند للتعديل الكامل"
            action={
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة مصروف سنوي
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
                    <th className="py-3 px-4 text-left tabular-nums">التكلفة السنوية</th>
                    <th className="py-3 px-4">تاريخ التجديد القادم</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left w-20">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr
                      key={i.id}
                      className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-slate-800">{i.expenseName}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
                          {getCategoryLabel(i.category)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left tabular-nums text-slate-700">
                        {formatCurrency(i.annualCost)}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarRange size={13} className="text-slate-400" />
                          {formatDueDate(i.dueDate)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <PaymentStatusPill
                          status={i.paymentStatus}
                          onChange={(next) => handleUpdateStatus(i.id, next)}
                        />
                      </td>
                      <td className="py-3 px-4 text-left">
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

      <AddAnnualExpenseModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
        onAddCategory={handleAddCategory}
        categories={categories}
        initialValues={editingItem}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        tone={toast.tone}
        onClose={closeToast}
      />
    </>
  );
}
