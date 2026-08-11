import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, CheckCircle2, CalendarClock, Car,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
  EmptyState as UIEmptyState,
} from './UI';
import AddWashModal from './AddWashModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useWashes } from '../hooks/useWashes';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

// ─── Status toggle pill (مكتملة ↔ قيد التنفيذ) ────────────────────────────
function WashStatusPill({ status, onChange, disabled }) {
  const isCompleted = status === 'مكتملة';
  const next        = isCompleted ? 'قيد التنفيذ' : 'مكتملة';
  const classes = isCompleted
    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
    : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20';
  const dot = isCompleted ? 'bg-emerald-600' : 'bg-amber-500';
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(next)}
      disabled={disabled}
      title={disabled
        ? 'غير متاح في وضع عرض الشريك'
        : isCompleted ? 'انقر للتراجع إلى قيد التنفيذ' : 'انقر لتسجيل الغسلة كمكتملة'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${classes} ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {isCompleted ? 'مكتملة' : 'قيد التنفيذ'}
    </button>
  );
}

// Thin wrapper over the shared EmptyState recipe so this page's "no washes
// yet" moment looks identical to every other empty table in the app.
function EmptyState({ onAdd, canMutate }) {
  return (
    <UIEmptyState
      icon={Car}
      title="لم تُسجَّل أي غسلة بعد"
      hint={canMutate
        ? 'ابدأ بتسجيل أول غسلة. ستظهر تلقائياً في عداد الغسلات داخل تبويب المصاريف المتغيرة.'
        : 'لم يتم تسجيل أي غسلة من قِبَل المشرف بعد.'}
      action={canMutate ? (
        <PrimaryButton icon={Plus} onClick={onAdd}>
          إضافة غسلة جديدة
        </PrimaryButton>
      ) : null}
    />
  );
}

function formatWashDate(value) {
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

function todayISO() {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

export default function WashesPage() {
  const {
    items, loading, error,
    addItem, updateItem, updateStatus, deleteItem, refetch,
  } = useWashes();
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
    const today = todayISO();
    let completed = 0, revenue = 0, todays = 0;
    items.forEach((w) => {
      const q = w.quantity || 0;
      if (w.status === 'مكتملة') {
        completed += q;
        revenue   += q * w.price;
      }
      if (w.washDate === today) todays += q;
    });
    // Pro-rata: revenue is a currency total (continuous), wash counts
    // round to the nearest integer so the KPI doesn't read "3.7 غسلة".
    return {
      completed: Math.round(completed * scalingFactor),
      revenue:   revenue * scalingFactor,
      todays:    Math.round(todays   * scalingFactor),
    };
  }, [items, scalingFactor]);

  async function handleAddItem(item) {
    try { await addItem(item); showToast('تم إضافة الغسلة بنجاح'); }
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
  async function handleDelete(item) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`هل تريد حذف هذه الدفعة (${formatNumber(item.quantity)} غسلة)؟ لا يمكن التراجع.`)
      : true;
    if (!confirmed) return;
    try { await deleteItem(item.id); showToast('تم حذف الغسلة'); }
    catch (e) { setMutationError(e); }
  }

  return (
    <>
      <TopBar
        title="الغسلات"
        subtitle="سجل كل غسلة لتغذية عداد البايكرز ومتابعة الإيرادات اليومية"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {mutationError && (
          <ErrorState
            title="تعذّر حفظ التغييرات"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}

        {error && (
          <ErrorState
            title="تعذّر تحميل سجل الغسلات"
            error={error}
            onRetry={refetch}
          />
        )}

        {/* ── KPI summary ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
          <StatCard
            className="col-span-2 md:col-span-1"
            icon={CheckCircle2}
            tone="emerald"
            label="إجمالي الغسلات المكتملة"
            value={formatNumber(totals.completed)}
            sub={
              items.length === 0
                ? 'ابدأ بتسجيل أول دفعة'
                : `${formatNumber(items.length)} ${items.length === 1 ? 'دفعة' : 'دفعات'} مسجّلة`
            }
          />
          <StatCard
            icon={Wallet}
            tone="primary"
            label="إجمالي الإيرادات"
            value={formatCurrency(totals.revenue)}
            sub="عدد الغسلات × سعر الغسلة (للدفعات المكتملة)"
          />
          <StatCard
            icon={CalendarClock}
            tone="amber"
            label="غسلات اليوم"
            value={formatNumber(totals.todays)}
            sub="إجمالي الغسلات المسجّلة لتاريخ اليوم"
          />
        </div>

        {/* ── Main table ─────────────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="سجل الغسلات"
            subtitle={canMutate
              ? 'حرّر الحالة مباشرةً من الجدول أو افتح غسلة للتعديل الكامل'
              : 'عرض حصّتك من سجل الغسلات (للقراءة فقط)'}
            action={canMutate ? (
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة غسلة جديدة
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
                    <th className="py-3 px-4 whitespace-nowrap">البيان / اسم البايكر</th>
                    <th className="py-3 px-4 whitespace-nowrap text-center tabular-nums">عدد الغسلات</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">سعر الغسلة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">إجمالي الإيرادات</th>
                    <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
                    <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left w-20">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((w) => {
                    const total = (w.quantity || 0) * (w.price || 0);
                    const label = w.bikerName || '—';
                    return (
                      <tr
                        key={w.id}
                        className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 whitespace-normal break-words min-w-[180px] font-medium text-slate-800 dark:text-slate-200 align-top">
                          {label}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums text-slate-700 dark:text-slate-300 align-top">
                          {formatNumber(w.quantity)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300 align-top">
                          {/* Scaled like the row total so qty × price =
                              total stays visibly true in partner view
                              (same pattern as Startup/Monthly). */}
                          {formatCurrency(w.price * scalingFactor)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-slate-900 dark:text-slate-100 align-top">
                          {formatCurrency(total * scalingFactor)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400 align-top">
                          <span className="inline-flex items-center gap-1.5 tabular-nums">
                            <CalendarClock size={13} className="text-slate-500 dark:text-slate-400" />
                            {formatWashDate(w.washDate)}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap align-top">
                          <WashStatusPill
                            status={w.status}
                            onChange={(next) => handleUpdateStatus(w.id, next)}
                            disabled={!canMutate}
                          />
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left align-top">
                          {canMutate && (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditModal(w)}
                                className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-300 p-1.5 rounded-control hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                                aria-label={`تعديل دفعة ${label}`}
                                title="تعديل الدفعة"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(w)}
                                className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-300 p-1.5 rounded-control hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                                aria-label={`حذف دفعة ${label}`}
                                title="حذف الدفعة"
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

      <AddWashModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
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
