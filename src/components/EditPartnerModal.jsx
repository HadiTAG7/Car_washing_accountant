import { useEffect, useState } from 'react';
import { X, Pencil, Users, Percent, Briefcase, Wallet } from 'lucide-react';
import { formatCurrency, PER_WORKER_FEE } from '../data/initialData';

const EMPTY = { partnerName: '', workersCount: '', percentage: '', paidAmount: '' };

export default function EditPartnerModal({ isOpen, partner, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  // Re-init whenever the modal opens for a new partner.
  useEffect(() => {
    if (!isOpen || !partner) return;
    setForm({
      partnerName:  partner.partnerName || '',
      workersCount: String(partner.workersCount ?? ''),
      percentage:   partner.percentage === null || partner.percentage === undefined
        ? ''
        : String(partner.percentage),
      paidAmount:   partner.paidAmount ? String(partner.paidAmount) : '',
    });
  }, [isOpen, partner]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const workersCount = Math.max(0, parseInt(form.workersCount, 10) || 0);
  const percentageNum = form.percentage === ''
    ? null
    : Math.min(100, Math.max(0, parseFloat(form.percentage) || 0));
  const paidAmount    = Math.max(0, parseFloat(form.paidAmount) || 0);
  const requiredTotal = workersCount * PER_WORKER_FEE;
  const remaining     = Math.max(0, requiredTotal - paidAmount);
  const settled       = workersCount > 0 && remaining === 0;
  const isValid       = form.partnerName.trim().length > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting || !partner?.id) return;
    setSubmitting(true);
    try {
      await onSave(partner.id, {
        partnerName:  form.partnerName.trim(),
        workersCount,
        percentage:   percentageNum,
        paidAmount,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen || !partner) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto border border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-xl flex items-center justify-center">
              <Pencil size={18} />
            </span>
            تعديل بيانات الشريك
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="partnerName">
              اسم الشريك
            </label>
            <div className="relative">
              <Briefcase
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
              />
              <input
                id="partnerName"
                type="text"
                name="partnerName"
                value={form.partnerName}
                onChange={handleChange}
                placeholder="مثال: شركة الخدمات المحدودة"
                autoFocus
                required
                className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="workersCount">
                عدد العمالة
              </label>
              <div className="relative">
                <Users
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                />
                <input
                  id="workersCount"
                  type="number"
                  name="workersCount"
                  value={form.workersCount}
                  onChange={handleChange}
                  placeholder="0"
                  min="0"
                  step="1"
                  className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="percentage">
                النسبة (%)
              </label>
              <div className="relative">
                <Percent
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                />
                <input
                  id="percentage"
                  type="number"
                  name="percentage"
                  value={form.percentage}
                  onChange={handleChange}
                  placeholder="0"
                  min="0"
                  max="100"
                  step="0.01"
                  className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="paidAmount">
              المبلغ المدفوع (ر.س)
            </label>
            <div className="relative">
              <Wallet
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
              />
              <input
                id="paidAmount"
                type="number"
                name="paidAmount"
                value={form.paidAmount}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="any"
                className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              الرسوم المطلوبة = عدد العمالة × {formatCurrency(PER_WORKER_FEE)}. اتركها صفراً إذا لم يدفع بعد.
            </p>
          </div>

          {/* Capital & receivable summary */}
          <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="text-slate-600 dark:text-slate-400">إجمالي الرسوم المطلوبة</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatCurrency(requiredTotal)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="text-slate-600 dark:text-slate-400">المبلغ المدفوع</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatCurrency(paidAmount)}
              </span>
            </div>
            <div className={`flex items-baseline justify-between gap-3 px-4 py-3 ${
              settled
                ? 'bg-emerald-50 dark:bg-emerald-500/10'
                : remaining > 0
                  ? 'bg-amber-50 dark:bg-amber-500/10'
                  : ''
            }`}>
              <span className={`font-bold ${
                settled
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : remaining > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-slate-700 dark:text-slate-300'
              }`}>
                {settled ? 'مسدَّد بالكامل ✓' : 'المتبقي للاستكمال'}
              </span>
              <span className={`font-extrabold tabular-nums ${
                settled
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : remaining > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-slate-900 dark:text-slate-100'
              }`}>
                {formatCurrency(remaining)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-600 dark:hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-3 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              <Pencil size={18} />
              {submitting ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
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
