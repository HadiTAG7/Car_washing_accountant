import { useEffect, useState } from 'react';
import { X, Plus, Pencil, Target } from 'lucide-react';
import { formatCurrency } from '../data/initialData';

const EMPTY = {
  categoryLabel: '',
  budgetType:    'monthly',
  amount:        '',
};

export default function AddBudgetModal({
  isOpen, onClose, onAdd, onUpdate, initialValues = null, suggestions = [],
}) {
  const editing = Boolean(initialValues?.id);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (initialValues?.id) {
      setForm({
        categoryLabel: initialValues.categoryLabel || '',
        budgetType:    initialValues.budgetType === 'annual' ? 'annual' : 'monthly',
        amount:        initialValues.amount ? String(initialValues.amount) : '',
      });
    } else {
      setForm({ ...EMPTY });
    }
  }, [isOpen, initialValues]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const amount  = Math.max(0, parseFloat(form.amount) || 0);
  const isValid = form.categoryLabel.trim().length > 0 && amount > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        categoryLabel: form.categoryLabel.trim(),
        budgetType:    form.budgetType,
        amount,
      };
      if (editing && onUpdate) {
        await onUpdate(initialValues.id, payload);
      } else if (onAdd) {
        await onAdd(payload);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const HeaderIcon = editing ? Pencil : Target;
  const datalistId = 'budget-category-suggestions';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <span className="bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-400 w-9 h-9 rounded-xl flex items-center justify-center">
              <HeaderIcon size={18} />
            </span>
            {editing ? 'تعديل ميزانية' : 'إضافة ميزانية جديدة'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="categoryLabel">
              اسم التصنيف / البند
            </label>
            <input
              id="categoryLabel"
              type="text"
              name="categoryLabel"
              value={form.categoryLabel}
              onChange={handleChange}
              placeholder="مثال: سكن العمال، تأمين الأسطول، رواتب وأجور"
              autoFocus
              required
              list={suggestions.length > 0 ? datalistId : undefined}
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
            {suggestions.length > 0 && (
              <datalist id={datalistId}>
                {suggestions.map((s) => <option key={s} value={s} />)}
              </datalist>
            )}
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              يطابق النظام هذا الاسم تلقائياً مع أسماء المصاريف وتصنيفاتها لحساب الصرف الفعلي.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="budgetType">
                نوع الميزانية
              </label>
              <select
                id="budgetType"
                name="budgetType"
                value={form.budgetType}
                onChange={handleChange}
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              >
                <option value="monthly">شهرية</option>
                <option value="annual">سنوية</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="amount">
                المبلغ المرصود (ر.س)
              </label>
              <input
                id="amount"
                type="number"
                name="amount"
                value={form.amount}
                onChange={handleChange}
                placeholder="100000"
                min="0"
                step="any"
                required
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-600 dark:text-slate-400">المبلغ المرصود:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {amount > 0 ? formatCurrency(amount) : formatCurrency(0)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-800 dark:bg-primary-600 hover:bg-primary-900 dark:hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors duration-200 shadow-sm"
            >
              {editing ? <Pencil size={18} /> : <Plus size={18} />}
              {submitting
                ? (editing ? 'جارٍ الحفظ...' : 'جارٍ الإضافة...')
                : (editing ? 'حفظ التعديلات' : 'إضافة الميزانية')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
