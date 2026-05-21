import { useMemo, useState } from 'react';
import {
  Plus, Trash2, Wallet, Receipt, Scale, FileText,
} from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
} from './UI';
import AddStartupFeeModal from './AddStartupFeeModal';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import { useStartupCosts } from '../hooks/useStartupCosts';
import { useCategories } from '../hooks/useCategories';

// ─── Status toggle pill (in_progress ↔ completed) ──────────────────────────
function StatusTogglePill({ status, onChange }) {
  const isCompleted = status === 'completed';
  const next        = isCompleted ? 'in_progress' : 'completed';
  const classes = isCompleted
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100'
    : 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100';
  const dot = isCompleted ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={isCompleted ? 'انقر لإعادة الحالة إلى قيد التنفيذ' : 'انقر لإنهاء البند'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${classes}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {isCompleted ? 'مكتمل' : 'قيد التنفيذ'}
    </button>
  );
}

// ─── Empty-state for the table area ────────────────────────────────────────
function EmptyState({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="bg-primary-50 text-primary-700 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
        <FileText size={26} />
      </div>
      <p className="text-base font-bold text-slate-800 mb-1">لا توجد بنود تأسيس بعد</p>
      <p className="text-sm text-slate-500 mb-5 max-w-sm">
        أضف أول بند رسوم تأسيس لبدء تتبع الميزانية والصرف الفعلي.
      </p>
      <PrimaryButton icon={Plus} onClick={onAdd}>
        إضافة رسوم تأسيس
      </PrimaryButton>
    </div>
  );
}

export default function StartupPage({ pendingEntry, onClearPendingEntry }) {
  const {
    items, loading, error,
    addItem, updateActual, updateStatus, deleteItem, refetch,
  } = useStartupCosts();

  const { categories, getCategoryLabel } = useCategories();

  const [localOpen, setLocalOpen] = useState(false);
  const [mutationError, setMutationError] = useState(null);

  const isModalOpen = localOpen || pendingEntry === 'item';
  function openModal()  { setLocalOpen(true); }
  function closeModal() { setLocalOpen(false); if (pendingEntry) onClearPendingEntry?.(); }

  const totals = useMemo(() => {
    const planned = items.reduce((s, i) => s + i.plannedAmount, 0);
    const actual  = items.reduce((s, i) => s + i.actualAmount,  0);
    const variance = planned - actual;
    return { planned, actual, variance, ok: variance >= 0 };
  }, [items]);

  async function handleAddItem(item) {
    try { await addItem(item); }
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
        subtitle="تتبع المصاريف التأسيسية لمرة واحدة لامتياز مونستر واش"
      />

      <main className="p-8 space-y-6">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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
            subtitle="حرّر المبلغ الفعلي أو الحالة مباشرةً من الجدول"
            action={
              <PrimaryButton icon={Plus} onClick={openModal}>
                إضافة رسوم تأسيس
              </PrimaryButton>
            }
          />

          {loading && !items.length ? (
            <LoadingState rows={4} />
          ) : items.length === 0 ? (
            <EmptyState onAdd={openModal} />
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 uppercase border-b border-slate-100">
                    <th className="py-3 px-4">البند</th>
                    <th className="py-3 px-4">التصنيف</th>
                    <th className="py-3 px-4 text-left tabular-nums">المبلغ المخطط</th>
                    <th className="py-3 px-4 text-left tabular-nums">المبلغ الفعلي</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left w-16">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr
                      key={i.id}
                      className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-slate-800">{i.itemName}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
                          {getCategoryLabel(i.category)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left tabular-nums text-slate-700">
                        {formatCurrency(i.plannedAmount)}
                      </td>
                      <td className="py-3 px-4 text-left">
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
                          className="w-28 px-2 py-1 border border-slate-200 rounded-lg text-sm text-left tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-300"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <StatusTogglePill
                          status={i.status}
                          onChange={(next) => handleUpdateStatus(i.id, next)}
                        />
                      </td>
                      <td className="py-3 px-4 text-left">
                        <button
                          type="button"
                          onClick={() => handleDelete(i.id)}
                          className="text-slate-400 hover:text-accent-600 p-1.5 rounded-lg hover:bg-accent-50 transition-colors"
                          aria-label={`حذف ${i.itemName}`}
                          title="حذف البند"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
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
        categories={categories}
      />
    </>
  );
}
