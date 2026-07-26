import { useEffect, useState } from 'react';
import { X, Plus, Pencil, Activity, Check, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatNumber, todayISO } from '../data/initialData';
import CategorySelect from './CategorySelect';

const EMPTY_TEMPLATE = {
  expenseName: '',
  categoryId:  '',
  quantity:    '1',
  unitCost:    '',
  loggedDate:  '',
};

export default function AddVariableExpenseModal({
  isOpen, onClose, onAdd, onUpdate, onAddCategory, onDeleteCategory,
  categories = [], protectedCategoryLabels = [], initialValues = null, washCount = 0,
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
            {editing ? 'تعديل مصروف متغير' : 'إضافة مصروف متغير'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="sw-tap inline-flex items-center justify-center p-1 rounded-control text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
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
              className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="categoryId">
              التصنيف المتغير
            </label>
            <div className="flex gap-2">
              <CategorySelect
                categories={categories}
                value={form.categoryId}
                onChange={(id) => setForm((prev) => ({ ...prev, categoryId: id }))}
                ariaLabel="التصنيف المتغير"
                onDelete={onDeleteCategory}
                protectedLabels={protectedCategoryLabels}
                // Dynamic categories (e.g. عمولات البايكرز) drive auto-quantity
                // calculations from the wash counter — deleting them would
                // break commission roll-ups, so the trash icon is suppressed.
                isOptionProtected={(cat) =>
                  Boolean(cat.isDynamic) ||
                  cat.label === 'عمولات البايكرز والموزعين' ||
                  cat.label === 'عمولات البايكرز'
                }
              />
              {onAddCategory && (
                <button
                  type="button"
                  onClick={() => {
                    setShowNewCat((v) => !v);
                    setCatError('');
                    setNewCatLabel('');
                  }}
                  className="sw-button sw-button--sm sw-button--secondary shrink-0"
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
                    className="flex-1 px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleSaveNewCategory}
                    disabled={!newCatLabel.trim() || addingCat}
                    className="sw-button sw-button--sm sw-button--primary shrink-0"
                  >
                    <Check size={16} strokeWidth={2.5} />
                    {addingCat ? '...' : 'حفظ'}
                  </button>
                </div>
                {catError && (
                  <div
                    role="alert"
                    className="mt-2 flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-control px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300 font-medium leading-relaxed"
                  >
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
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
                    ? 'w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-sm tabular-nums cursor-not-allowed focus:outline-none transition-colors'
                    : 'w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors'
                }
                title={isRule ? 'يُحسب تلقائياً من عداد الغسلات' : undefined}
              />
              {isRule && (
                <p
                  role="status"
                  className="mt-1.5 inline-flex items-start gap-1.5 text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 rounded-control px-2.5 py-1 leading-relaxed"
                >
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
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
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
              className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>

          {/* Live total — effective quantity × unit cost (live for rule rows) */}
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">إجمالي التكلفة المتغيرة:</span>
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
              className="sw-button sw-button--sm sw-button--primary flex-1"
            >
              {editing ? <Pencil size={18} /> : <Plus size={18} />}
              {submitting
                ? (editing ? 'جارٍ الحفظ...' : 'جارٍ الإضافة...')
                : (editing ? 'حفظ التعديلات' : 'إضافة المصروف')}
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
