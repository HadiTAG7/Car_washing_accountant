import { useEffect, useState } from 'react';
import {
  X, Plus, RefreshCw, Wallet, Calendar, FileText, Tag,
} from 'lucide-react';
import { formatCurrency, todayISO } from '../data/initialData';
import DateField from './DateField';

const EMPTY = {
  title:     '',
  amount:    '',
  spentDate: '',
  notes:     '',
};

export default function AddTemporaryExpenseModal({ isOpen, onClose, onAdd }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  // Reset every time the modal re-opens, and seed today's date.
  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...EMPTY, spentDate: todayISO() });
  }, [isOpen]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const amount  = Math.max(0, parseFloat(form.amount) || 0);
  const isValid = Boolean(form.title.trim()) && amount > 0 && Boolean(form.spentDate);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      await onAdd({
        title:     form.title.trim(),
        amount,
        spentDate: form.spentDate,
        // Every new row starts out pending — recovery is set later via the
        // "تأكيد الاسترداد" quick-action on the tracking table.
        status:        'pending',
        recoveredDate: null,
        notes:         form.notes.trim(),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-control flex items-center justify-center shrink-0">
              <RefreshCw size={18} />
            </span>
            <span className="min-w-0">
              <span className="block">إضافة مصروف مؤقت</span>
              <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                مبلغ مدفوع الآن وسيتم استرداده لاحقاً
              </span>
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="sw-tap flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-control hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="title">
              اسم البند
            </label>
            <div className="relative">
              <Tag
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
              />
              <input
                id="title"
                type="text"
                name="title"
                value={form.title}
                onChange={handleChange}
                placeholder="مثال: تأمين عقد إيجار قابل للاسترداد"
                required
                className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="amount">
                المبلغ (ر.س)
              </label>
              <div className="relative">
                <Wallet
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
                />
                <input
                  id="amount"
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  placeholder="0"
                  min="0"
                  step="any"
                  required
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="spentDate">
                تاريخ الصرف
              </label>
              <div className="relative">
                <Calendar
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
                />
                <DateField
              id="spentDate"
              name="spentDate"
              value={form.spentDate}
              onChange={handleChange}
              required
            />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="notes">
              ملاحظات
              <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mr-1">— اختياري</span>
            </label>
            <div className="relative">
              <FileText
                size={16}
                className="absolute right-3 top-3 text-slate-500 dark:text-slate-400 pointer-events-none"
              />
              <textarea
                id="notes"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="مثال: رقم العقد، الجهة المتوقع منها الاسترداد"
                rows={3}
                className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors resize-y leading-relaxed"
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 rounded-smallcard p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">قيمة هذا المصروف:</span>
              <span className="font-bold text-amber-800 dark:text-amber-200 tabular-nums">
                {formatCurrency(amount)}
              </span>
            </div>
            <p className="text-[11px] mt-2 leading-relaxed">
              سيتم تسجيله بحالة &quot;معلق قيد الاسترداد&quot; — يمكنك تأكيد الاسترداد لاحقاً من الجدول.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="sw-button sw-button--sm sw-button--primary flex-1"
            >
              <Plus size={18} />
              {submitting ? 'جارٍ التسجيل...' : 'تسجيل المصروف'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="sw-button sw-button--sm sw-button--secondary"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
