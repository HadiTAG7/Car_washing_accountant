import { useEffect, useState } from 'react';
import {
  X, Plus, Trash2, FileText, Wallet, Calendar, Tag, Loader2, Inbox,
} from 'lucide-react';
import { formatCurrency, formatDate, todayISO } from '../data/initialData';
import { useStartupCostEntries } from '../hooks/useStartupCostEntries';

const EMPTY_FORM = { description: '', amount: '', spentDate: '', notes: '' };

/**
 * Per-item expense ledger. Opens when the admin clicks an item name on
 * the Startup Fees table. Lists every individual transaction that adds
 * up to the item's actual_amount, plus a form to log a new one.
 *
 * Wiring: every add/delete here calls useStartupCostEntries which then
 * pushes the new SUM back onto the parent startup_costs row. The
 * StartupPage refetches its items after the modal closes so the table's
 * "المبلغ الفعلي" and "المتبقي" columns reflect the new total.
 */
export default function StartupItemDetailModal({
  isOpen, onClose, item, onDirty,
}) {
  const {
    entries, loading, error, addEntry, deleteEntry,
  } = useStartupCostEntries(isOpen && item?.id ? item.id : null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Reset form whenever a different item opens; seed today's date.
  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...EMPTY_FORM, spentDate: todayISO() });
  }, [isOpen, item?.id]);

  if (!isOpen || !item) return null;

  const recordedTotal = entries.reduce((s, e) => s + (e.amount || 0), 0);
  const planned       = item.plannedAmount || 0;
  const remaining     = Math.max(0, planned - recordedTotal);
  const overspent     = recordedTotal > planned && planned > 0;

  const trimmedDesc   = form.description.trim();
  const parsedAmount  = Math.max(0, parseFloat(form.amount) || 0);
  const isValid       = trimmedDesc.length > 0 && parsedAmount > 0 && Boolean(form.spentDate);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      await addEntry({
        description: trimmedDesc,
        amount:      parsedAmount,
        spentDate:   form.spentDate,
        notes:       form.notes.trim(),
      });
      setForm({ ...EMPTY_FORM, spentDate: todayISO() });
      onDirty?.(); // tell parent to refetch startup items so totals update
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(entry) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`هل أنت متأكد من حذف "${entry.description}" من السجل؟`)
      : true;
    if (!confirmed) return;
    setDeletingId(entry.id);
    try {
      await deleteEntry(entry.id);
      onDirty?.();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 my-4 max-h-[92vh] overflow-y-auto border border-slate-100 dark:border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-xl flex items-center justify-center">
              <FileText size={18} />
            </span>
            <span className="min-w-0">
              <span className="block">سجل مصاريف: {item.itemName}</span>
              <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                أضف المصاريف خطوة بخطوة — الإجمالي يحدّث "المبلغ الفعلي" تلقائياً
              </span>
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">المخطط</p>
              <p className="font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {formatCurrency(planned)}
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">المسجّل</p>
              <p className="font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {formatCurrency(recordedTotal)}
              </p>
            </div>
            <div className={`rounded-xl px-3 py-2.5 border ${
              overspent
                ? 'bg-red-50 dark:bg-red-500/15 border-red-200 dark:border-red-500/40'
                : remaining > 0
                  ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/40'
                  : 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/40'
            }`}>
              <p className={`text-[11px] leading-snug ${
                overspent
                  ? 'text-red-700 dark:text-red-300'
                  : remaining > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
              }`}>
                {overspent ? 'تجاوز' : 'المتبقي'}
              </p>
              <p className={`font-bold tabular-nums mt-0.5 ${
                overspent
                  ? 'text-red-700 dark:text-red-300'
                  : remaining > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
              }`}>
                {formatCurrency(overspent ? recordedTotal - planned : remaining)}
              </p>
            </div>
          </div>

          {/* Add form */}
          <form onSubmit={handleAdd} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              إضافة مصروف جديد
            </p>

            {/* Description + Date */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
              <div className="relative">
                <Tag
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                />
                <input
                  type="text"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="مثال: شراء أثاث المطبخ"
                  required
                  className="w-full pr-9 pl-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
                />
              </div>
              <div className="relative">
                <Calendar
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                />
                <input
                  type="date"
                  name="spentDate"
                  value={form.spentDate}
                  onChange={handleChange}
                  required
                  className="w-full pr-9 pl-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
                />
              </div>
            </div>

            {/* Amount + Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
              <div className="relative">
                <Wallet
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                />
                <input
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  placeholder="المبلغ (ر.س)"
                  min="0"
                  step="any"
                  required
                  className="w-full pr-9 pl-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
                />
              </div>
              <input
                type="text"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="ملاحظات اختيارية (رقم الفاتورة، الجهة...)"
                className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={!isValid || submitting}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-600 dark:hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              {submitting ? (
                <><Loader2 size={16} className="animate-spin" /> جارٍ التسجيل...</>
              ) : (
                <><Plus size={16} /> إضافة المصروف</>
              )}
            </button>
          </form>

          {/* Entries list */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              المصاريف المسجّلة ({entries.length})
            </p>

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/15 border border-red-100 dark:border-red-500/30 rounded-lg px-3 py-2 mb-2">
                تعذّر تحميل السجل. حاول إغلاق المودال وإعادة فتحه.
              </p>
            )}

            {loading && entries.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-slate-500 dark:text-slate-400 text-xs gap-2">
                <Loader2 size={14} className="animate-spin" />
                جارٍ التحميل...
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                <Inbox size={26} className="text-slate-400 dark:text-slate-500 mb-2" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">لا توجد مصاريف مسجّلة بعد</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  استخدم النموذج أعلاه لتسجيل أول مصروف لهذا البند.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
                {entries.map((e) => {
                  const busy = deletingId === e.id;
                  return (
                    <li
                      key={e.id}
                      className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug">
                          {e.description}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={11} />
                            {formatDate(e.spentDate)}
                          </span>
                          {e.notes && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">·</span>
                              <span className="truncate">{e.notes}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                        {formatCurrency(e.amount)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDelete(e)}
                        disabled={busy}
                        title="حذف هذا المصروف من السجل"
                        aria-label={`حذف ${e.description}`}
                        className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/15 disabled:opacity-60 transition-colors shrink-0"
                      >
                        {busy
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Trash2 size={14} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
