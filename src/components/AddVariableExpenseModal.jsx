import { useEffect, useState } from 'react';
import { X, Plus, Pencil, Activity, Check, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';

function todayISO() {
  // Local-date ISO (YYYY-MM-DD) — avoids the UTC shift you get from
  // toISOString() near midnight in non-UTC timezones.
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

const EMPTY_TEMPLATE = {
  expenseName: '',
  categoryId:  '',
  quantity:    '1',
  unitCost:    '',
  loggedDate:  '',
};

export default function AddVariableExpenseModal({
  isOpen, onClose, onAdd, onUpdate, onAddCategory,
  categories = [], initialValues = null, washCount = 0,
}) {
  const editing = Boolean(initialValues?.id);
  const [form, setForm] = useState(EMPTY_TEMPLATE);
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
      setForm({
        expenseName: initialValues.expenseName || '',
        categoryId:  initialValues.categoryId  || '',
        quantity:    String(Math.max(1, parseInt(initialValues.quantity, 10) || 1)),
        unitCost:    initialValues.unitCost ? String(initialValues.unitCost) : '',
        loggedDate:  initialValues.loggedDate || '',
      });
    } else {
      setForm({ ...EMPTY_TEMPLATE, loggedDate: todayISO() });
    }
  }, [isOpen, initialValues]);

  // Default the category to the first option once categories load, only
  // when the form has no (still-valid) selection.
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

  // Is the selected category a dynamic rule (auto-quantity from wash counter)?
  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const isRule           = Boolean(selectedCategory?.isDynamic);
  const safeWashCount    = Math.max(0, parseInt(washCount, 10) || 0);

  // For rule rows, quantity is read from the live wash counter — never
  // from the form field. The form's quantity input is locked + readOnly.
  const manualQuantity    = Math.max(1, parseInt(form.quantity, 10) || 0);
  const effectiveQuantity = isRule ? safeWashCount : manualQuantity;
  const unitCost          = Math.max(0, parseFloat(form.unitCost) || 0);
  const totalVariableCost = effectiveQuantity * unitCost;

  const isValid =
    form.expenseName.trim().length > 0 &&
    Boolean(form.categoryId) &&
    (isRule ? safeWashCount > 0 : manualQuantity > 0) &&
    unitCost > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        expenseName:       form.expenseName.trim(),
        categoryId:        form.categoryId,
        // For rule rows we snapshot the live wash count so the persisted
        // columns stay valid; the page overrides quantity + total on
        // display so dashboards still auto-scale.
        quantity:          effectiveQuantity,
        unitCost,
        totalVariableCost,
        loggedDate:        form.loggedDate || '',
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

  const HeaderIcon = editing ? Pencil : Activity;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <span className="bg-accent-50 text-accent-600 w-9 h-9 rounded-xl flex items-center justify-center">
              <HeaderIcon size={18} />
            </span>
            {editing ? 'تعديل مصروف متغير' : 'إضافة مصروف متغير'}
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
              placeholder="مثال: عمولات البايكرز - الأسبوع الأول"
              autoFocus
              required
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="categoryId">
              التصنيف المتغير
            </label>
            <div className="flex gap-2">
              <select
                id="categoryId"
                name="categoryId"
                value={form.categoryId}
                onChange={handleChange}
                required
                className="flex-1 px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              >
                {categories.length === 0 && <option value="">— لا توجد تصنيفات —</option>}
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>
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
                      if (e.key === 'Enter')  { e.preventDefault(); handleSaveNewCategory(); }
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
                الكمية / عدد الغسلات
              </label>
              <input
                id="quantity"
                type="number"
                name="quantity"
                value={isRule ? String(safeWashCount) : form.quantity}
                onChange={handleChange}
                min="1"
                step="1"
                required={!isRule}
                disabled={isRule}
                readOnly={isRule}
                className={
                  isRule
                    ? 'w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-500 dark:text-slate-400 font-medium tabular-nums bg-slate-100 cursor-not-allowed focus:outline-none'
                    : 'w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent'
                }
                title={isRule ? 'يُحسب تلقائياً من عداد الغسلات' : undefined}
              />
              {isRule && (
                <p className="mt-1.5 inline-flex items-start gap-1.5 text-[11px] font-semibold text-primary-700 bg-primary-50 border border-primary-100 rounded-lg px-2.5 py-1 leading-relaxed">
                  <Activity size={11} className="mt-0.5 shrink-0" />
                  <span>يتم الحساب تلقائياً بناءً على عداد المبيعات الفعلي</span>
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="unitCost">
                تكلفة الغسلة / الوحدة (ر.س)
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

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="loggedDate">
              تاريخ التسجيل / الصرف
            </label>
            <input
              id="loggedDate"
              type="date"
              name="loggedDate"
              value={form.loggedDate}
              onChange={handleChange}
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
          </div>

          {/* Live total — effective quantity × unit cost (live for rule rows) */}
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-600 dark:text-slate-400">إجمالي التكلفة المتغيرة:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {effectiveQuantity > 0 && unitCost > 0
                  ? `${formatNumber(effectiveQuantity)} × ${formatCurrency(unitCost)} = ${formatCurrency(totalVariableCost)}`
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
