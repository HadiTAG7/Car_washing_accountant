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

      <div
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-control flex items-center justify-center">
              <HeaderIcon size={18} />
            </span>
            {editing ? 'تعديل ميزانية' : 'إضافة ميزانية جديدة'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="sw-tap flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-control hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
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
              className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
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
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
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
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">المبلغ المرصود:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {amount > 0 ? formatCurrency(amount) : formatCurrency(0)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="sw-button sw-button--sm sw-button--primary flex-1"
            >
              {editing ? <Pencil size={18} /> : <Plus size={18} />}
              {submitting
                ? (editing ? 'جارٍ الحفظ...' : 'جارٍ الإضافة...')
                : (editing ? 'حفظ التعديلات' : 'إضافة الميزانية')}
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
