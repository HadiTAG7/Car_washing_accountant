import { useEffect, useState } from 'react';
import { X, Plus, Pencil, Receipt, Check, AlertTriangle, Repeat, Calendar } from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';
import CategorySelect from './CategorySelect';

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const EMPTY = {
  expenseName:   '',
  categoryId:    '',
  quantity:      '1',
  unitCost:      '',
  paymentDay:    '1',
  paymentStatus: 'pending',
  recurrence:    'monthly',
  loggedDate:    '',
};

export default function AddMonthlyExpenseModal({
  isOpen, onClose, onAdd, onUpdate, onAddCategory,
  categories = [], initialValues = null,
}) {
  const editing = Boolean(initialValues?.id);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  const [showNewCat, setShowNewCat]   = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [addingCat, setAddingCat]     = useState(false);
  const [catError, setCatError]       = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setShowNewCat(false);
    setNewCatLabel('');
    setCatError('');
    if (initialValues?.id) {
      const day = Number(initialValues.paymentDay);
      const rec = initialValues.recurrence === 'one_time' ? 'one_time' : 'monthly';
      setForm({
        expenseName:   initialValues.expenseName || '',
        categoryId:    initialValues.categoryId  || '',
        quantity:      String(Math.max(1, parseInt(initialValues.quantity, 10) || 1)),
        unitCost:      initialValues.unitCost ? String(initialValues.unitCost) : '',
        paymentDay:    Number.isFinite(day) && day >= 1 && day <= 31 ? String(day) : '1',
        paymentStatus: initialValues.paymentStatus === 'paid' ? 'paid' : 'pending',
        recurrence:    rec,
        loggedDate:    rec === 'one_time'
          ? (initialValues.loggedDate ? String(initialValues.loggedDate).slice(0, 10) : todayISO())
          : '',
      });
    } else {
      setForm({ ...EMPTY });
    }
  }, [isOpen, initialValues]);

  // Default the category to the first option once categories load, but
  // only if the form has no (still-valid) selection. Preserves the
  // user's auto-selected new category id across refetches.
  useEffect(() => {
    if (!isOpen || categories.length === 0) return;
    setForm((prev) => {
      const stillValid = prev.categoryId && categories.some((c) => c.id === prev.categoryId);
      if (stillValid) return prev;
      return { ...prev, categoryId: categories[0].id };
    });
  }, [isOpen, categories]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const quantity         = Math.max(1, parseInt(form.quantity, 10) || 0);
  const unitCost         = Math.max(0, parseFloat(form.unitCost) || 0);
  const totalMonthlyCost = quantity * unitCost;
  const isOneTime        = form.recurrence === 'one_time';
  const paymentDayNum    = Math.min(31, Math.max(1, parseInt(form.paymentDay, 10) || 1));
  const isValid =
    form.expenseName.trim().length > 0 &&
    Boolean(form.categoryId) &&
    quantity > 0 &&
    unitCost > 0 &&
    (isOneTime
      ? Boolean(form.loggedDate)
      : (paymentDayNum >= 1 && paymentDayNum <= 31));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        expenseName:      form.expenseName.trim(),
        categoryId:       form.categoryId,
        quantity,
        unitCost,
        totalMonthlyCost,
        recurrence:       isOneTime ? 'one_time' : 'monthly',
        paymentDay:       isOneTime ? null : paymentDayNum,
        loggedDate:       isOneTime ? form.loggedDate : null,
        paymentStatus:    form.paymentStatus === 'paid' ? 'paid' : 'pending',
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

  function selectRecurrence(next) {
    setForm((prev) => ({
      ...prev,
      recurrence: next,
      // Seed today's date when the user switches to one_time, drop it when
      // they switch back so the saved payload stays clean.
      loggedDate: next === 'one_time'
        ? (prev.loggedDate || todayISO())
        : '',
    }));
  }

  async function handleSaveNewCategory(e) {
    e?.preventDefault?.();
    const trimmed = newCatLabel.trim();
    if (!trimmed || !onAddCategory || addingCat) return;
    setCatError('');
    setAddingCat(true);
    try {
      const newId = await onAddCategory(trimmed);
      if (newId) {
        setForm((prev) => ({ ...prev, categoryId: newId }));
      }
      setNewCatLabel('');
      setShowNewCat(false);
    } catch (err) {
      setCatError(err?.message || 'تعذّر إضافة التصنيف');
    } finally {
      setAddingCat(false);
    }
  }

  if (!isOpen) return null;

  const HeaderIcon = editing ? Pencil : Receipt;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <span className="bg-accent-50 text-accent-600 w-9 h-9 rounded-xl flex items-center justify-center">
              <HeaderIcon size={18} />
            </span>
            {editing ? 'تعديل مصروف شهري' : 'إضافة مصروف شهري'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="expenseName">
              اسم المصروف
            </label>
            <input
              id="expenseName"
              type="text"
              name="expenseName"
              value={form.expenseName}
              onChange={handleChange}
              placeholder="مثال: إيجار الورشة الشهري"
              autoFocus
              required
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="categoryId">
              التصنيف الشهري
            </label>
            <div className="flex gap-2">
              <CategorySelect
                categories={categories}
                value={form.categoryId}
                onChange={(id) => setForm((prev) => ({ ...prev, categoryId: id }))}
                ariaLabel="التصنيف الشهري"
              />
              {onAddCategory && (
                <button
                  type="button"
                  onClick={() => {
                    setShowNewCat((v) => !v);
                    setCatError('');
                    setNewCatLabel('');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 border border-primary-200 bg-primary-50 hover:bg-primary-100 text-primary-700 rounded-xl text-sm font-semibold transition-colors"
                  title="إضافة تصنيف جديد"
                >
                  <Plus size={16} />
                  تصنيف جديد
                </button>
              )}
            </div>

            {showNewCat && onAddCategory && (
              <div className="mt-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleSaveNewCategory(); }
                      if (e.key === 'Escape') { setShowNewCat(false); setCatError(''); }
                    }}
                    placeholder="اسم التصنيف الجديد"
                    autoFocus
                    className="flex-1 px-4 py-3 border border-slate-300 bg-white dark:bg-slate-800 rounded-lg text-sm text-slate-900 dark:text-slate-100 font-medium placeholder:text-slate-400 dark:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400"
                  />
                  <button
                    type="button"
                    onClick={handleSaveNewCategory}
                    disabled={!newCatLabel.trim() || addingCat}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
                  >
                    <Check size={16} strokeWidth={2.5} />
                    {addingCat ? '...' : 'حفظ'}
                  </button>
                </div>
                {catError && (
                  <div className="mt-2 flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-[12px] text-red-700 font-medium leading-relaxed">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-500" />
                    <span className="flex-1 break-words">{catError}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="quantity">
                الكمية
              </label>
              <input
                id="quantity"
                type="number"
                name="quantity"
                value={form.quantity}
                onChange={handleChange}
                min="1"
                step="1"
                required
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="unitCost">
                تكلفة الوحدة الشهرية (ر.س)
              </label>
              <input
                id="unitCost"
                type="number"
                name="unitCost"
                value={form.unitCost}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="any"
                required
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>
          </div>

          {/* Recurrence toggle — recurring monthly vs one-time payment */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              نوع المصروف
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => selectRecurrence('monthly')}
                className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition-colors ${
                  !isOneTime
                    ? 'border-primary-600 bg-primary-50 dark:bg-primary-500/15 text-primary-800 dark:text-primary-300 ring-2 ring-primary-200 dark:ring-primary-500/30'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                }`}
                aria-pressed={!isOneTime}
              >
                <Repeat size={16} strokeWidth={2.2} />
                متكرر شهرياً
              </button>
              <button
                type="button"
                onClick={() => selectRecurrence('one_time')}
                className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition-colors ${
                  isOneTime
                    ? 'border-accent-600 bg-accent-50 dark:bg-accent-500/15 text-accent-800 dark:text-accent-300 ring-2 ring-accent-200 dark:ring-accent-500/30'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                }`}
                aria-pressed={isOneTime}
              >
                <Calendar size={16} strokeWidth={2.2} />
                مرة واحدة
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {isOneTime
                ? 'دفعة لمرة واحدة في تاريخ محدد — لن تتكرر شهرياً.'
                : 'مصروف ثابت يتكرر كل شهر — سيُحتسب تلقائياً ضمن المصاريف الشهرية الجارية.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {isOneTime ? (
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="loggedDate">
                  تاريخ الصرف
                </label>
                <input
                  id="loggedDate"
                  type="date"
                  name="loggedDate"
                  value={form.loggedDate}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
                />
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  سيُحتسب هذا المصروف في الشهر الذي يقع فيه تاريخ الصرف فقط.
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="paymentDay">
                  يوم الصرف الشهري
                </label>
                <input
                  id="paymentDay"
                  type="number"
                  name="paymentDay"
                  value={form.paymentDay}
                  onChange={handleChange}
                  min="1"
                  max="31"
                  step="1"
                  required
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
                />
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  سيقوم النظام بتذكيرك تلقائياً يوم {paymentDayNum} من كل شهر
                </p>
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="paymentStatus">
                الحالة
              </label>
              <select
                id="paymentStatus"
                name="paymentStatus"
                value={form.paymentStatus}
                onChange={handleChange}
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              >
                <option value="pending">قيد الانتظار</option>
                <option value="paid">مدفوع</option>
              </select>
            </div>
          </div>

          {/* Live total — quantity × unit cost; label flips with recurrence. */}
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-600 dark:text-slate-400">
                {isOneTime ? 'إجمالي تكلفة هذه الدفعة:' : 'إجمالي التكلفة الشهرية:'}
              </span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {quantity > 0 && unitCost > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(unitCost)} = ${formatCurrency(totalMonthlyCost)}`
                  : formatCurrency(0)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              {editing ? <Pencil size={18} /> : <Plus size={18} />}
              {submitting
                ? (editing ? 'جارٍ الحفظ...' : 'جارٍ الإضافة...')
                : (editing ? 'حفظ التعديلات' : 'إضافة المصروف')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800/60 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
