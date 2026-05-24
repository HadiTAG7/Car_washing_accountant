import { useEffect, useState } from 'react';
import {
  X, Plus, RefreshCw, Wallet, Calendar, FileText, Tag,
} from 'lucide-react';
import { formatCurrency, todayISO } from '../data/initialData';

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

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto border border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 w-9 h-9 rounded-xl flex items-center justify-center">
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
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
              />
              <input
                id="title"
                type="text"
                name="title"
                value={form.title}
                onChange={handleChange}
                placeholder="مثال: تأمين عقد إيجار قابل للاسترداد"
                required
                className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
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
                  className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                />
                <input
                  id="spentDate"
                  type="date"
                  name="spentDate"
                  value={form.spentDate}
                  onChange={handleChange}
                  required
                  className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="notes">
              ملاحظات
              <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500 mr-1">— اختياري</span>
            </label>
            <div className="relative">
              <FileText
                size={16}
                className="absolute right-3 top-3 text-slate-400 dark:text-slate-500 pointer-events-none"
              />
              <textarea
                id="notes"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="مثال: رقم العقد، الجهة المتوقع منها الاسترداد"
                rows={3}
                className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors resize-y leading-relaxed"
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-xl p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-amber-700 dark:text-amber-300 font-semibold">قيمة هذا المصروف:</span>
              <span className="font-bold text-amber-900 dark:text-amber-200 tabular-nums">
                {formatCurrency(amount)}
              </span>
            </div>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-2">
              سيتم تسجيله بحالة &quot;معلق قيد الاسترداد&quot; — يمكنك تأكيد الاسترداد لاحقاً من الجدول.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-600 dark:hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-3 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              <Plus size={18} />
              {submitting ? 'جارٍ التسجيل...' : 'تسجيل المصروف'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
