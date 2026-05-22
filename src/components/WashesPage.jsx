import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, CheckCircle2, CalendarClock, Car,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
} from './UI';
import AddWashModal from './AddWashModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useWashes } from '../hooks/useWashes';
import { isSupabaseConfigured, missingEnvNames } from '../lib/supabaseClient';

// ─── Status toggle pill (مكتملة ↔ قيد التنفيذ) ────────────────────────────
function WashStatusPill({ status, onChange }) {
  const isCompleted = status === 'مكتملة';
  const next        = isCompleted ? 'قيد التنفيذ' : 'مكتملة';
  const classes = isCompleted
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100'
    : 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100';
  const dot = isCompleted ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={isCompleted ? 'انقر للتراجع إلى قيد التنفيذ' : 'انقر لتسجيل الغسلة كمكتملة'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${classes}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {isCompleted ? 'مكتملة' : 'قيد التنفيذ'}
    </button>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="bg-emerald-50 text-emerald-600 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
        <Car size={26} />
      </div>
      <p className="text-base font-bold text-slate-800 mb-1">لم تُسجَّل أي غسلة بعد</p>
      <p className="text-sm text-slate-500 mb-5 max-w-sm">
        ابدأ بتسجيل أول غسلة. ستظهر تلقائياً في عداد الغسلات داخل تبويب المصاريف المتغيرة.
      </p>
      <PrimaryButton icon={Plus} onClick={onAdd}>
        إضافة غسلة جديدة
      </PrimaryButton>
    </div>
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
    return { completed, revenue, todays };
  }, [items]);

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
            title="تعذّر تحميل سجل الغسلات"
            error={error}
            onRetry={refetch}
          />
        )}

        {/* ── KPI summary ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <StatCard
            icon={CheckCircle2}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
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
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="إجمالي الإيرادات"
            value={formatCurrency(totals.revenue)}
            sub="عدد الغسلات × سعر الغسلة (للدفعات المكتملة)"
          />
          <StatCard
            icon={CalendarClock}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            label="غسلات اليوم"
            value={formatNumber(totals.todays)}
            sub="إجمالي الغسلات المسجّلة لتاريخ اليوم"
          />
        </div>

        {/* ── Main table ─────────────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="سجل الغسلات"
            subtitle="حرّر الحالة مباشرةً من الجدول أو افتح غسلة للتعديل الكامل"
            action={
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة غسلة جديدة
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
                    <th className="py-3 px-4">البيان / اسم البايكر</th>
                    <th className="py-3 px-4 text-center tabular-nums">عدد الغسلات</th>
                    <th className="py-3 px-4 text-left tabular-nums">سعر الغسلة</th>
                    <th className="py-3 px-4 text-left tabular-nums">إجمالي الإيرادات</th>
                    <th className="py-3 px-4">التاريخ</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left w-20">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((w) => {
                    const total = (w.quantity || 0) * (w.price || 0);
                    const label = w.bikerName || '—';
                    return (
                      <tr
                        key={w.id}
                        className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors"
                      >
                        <td className="py-3 px-4 font-medium text-slate-800 align-top">
                          {label}
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums text-slate-700 align-top">
                          {formatNumber(w.quantity)}
                        </td>
                        <td className="py-3 px-4 text-left tabular-nums text-slate-700 align-top">
                          {formatCurrency(w.price)}
                        </td>
                        <td className="py-3 px-4 text-left tabular-nums font-bold text-slate-900 align-top">
                          {formatCurrency(total)}
                        </td>
                        <td className="py-3 px-4 text-slate-600 align-top">
                          <span className="inline-flex items-center gap-1.5 tabular-nums">
                            <CalendarClock size={13} className="text-slate-400" />
                            {formatWashDate(w.washDate)}
                          </span>
                        </td>
                        <td className="py-3 px-4 align-top">
                          <WashStatusPill
                            status={w.status}
                            onChange={(next) => handleUpdateStatus(w.id, next)}
                          />
                        </td>
                        <td className="py-3 px-4 text-left align-top">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(w)}
                              className="text-slate-400 hover:text-primary-700 p-1.5 rounded-lg hover:bg-primary-50 transition-colors"
                              aria-label={`تعديل دفعة ${label}`}
                              title="تعديل الدفعة"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(w)}
                              className="text-slate-400 hover:text-accent-600 p-1.5 rounded-lg hover:bg-accent-50 transition-colors"
                              aria-label={`حذف دفعة ${label}`}
                              title="حذف الدفعة"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
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
