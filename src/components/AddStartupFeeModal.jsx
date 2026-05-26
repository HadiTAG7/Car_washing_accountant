import { useEffect, useRef, useState } from 'react';
import {
  X, Plus, Pencil, Receipt, Tag, Check, Loader2,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';

// Sentinel value for the synthetic "+ إضافة تصنيف جديد..." option in
// the category dropdown. Picking it toggles the modal into inline-
// create mode instead of setting form.category.
const NEW_CATEGORY_SENTINEL = '__sweater_new_category__';

// Generates a stable id for a freshly-created category. `categories.id`
// is `text primary key`, so we need to supply our own — we use the
// browser's Web Crypto UUID generator (universally available in modern
// React app contexts; the codebase already relies on it for password
// generation in supabaseClient.js).
function freshCategoryId() {
  return (globalThis.crypto || window.crypto).randomUUID();
}

const EMPTY = {
  itemName:         '',
  category:         '',
  quantity:         '1',
  plannedUnitPrice: '',
  actualUnitPrice:  '',
};

function toPositive(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatUnitPriceForInput(total, quantity) {
  if (!total || !quantity || quantity <= 0) return '';
  const unit = total / quantity;
  if (!Number.isFinite(unit) || unit <= 0) return '';
  // Trim trailing .00 / floating noise; keep up to 2 decimals when needed.
  return Number(unit.toFixed(2)).toString();
}

export default function AddStartupFeeModal({
  isOpen, onClose, onAdd, onUpdate, categories = [], onAddCategory,
  initialValues = null,
}) {
  const editing = Boolean(initialValues?.id);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  // Inline category-create state. `addingCategory` is the boolean
  // toggle; when true, the <select> swaps for the inline input row.
  // `categoryBeforeAdd` stashes whichever category was selected before
  // the toggle so "إلغاء" can restore it cleanly.
  const [addingCategory,    setAddingCategory]    = useState(false);
  const [newCategoryLabel,  setNewCategoryLabel]  = useState('');
  const [newCategoryBusy,   setNewCategoryBusy]   = useState(false);
  const [newCategoryError,  setNewCategoryError]  = useState('');
  const [categoryBeforeAdd, setCategoryBeforeAdd] = useState('');
  const newCategoryInputRef = useRef(null);

  // Auto-focus the new-category input every time we enter inline-add
  // mode — keeps the keyboard flow snappy after the dropdown click.
  useEffect(() => {
    if (addingCategory) {
      // Defer one frame so the input is in the DOM before .focus().
      const id = requestAnimationFrame(() => newCategoryInputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [addingCategory]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialValues?.id) {
      const qty = Math.max(1, parseInt(initialValues.quantity, 10) || 1);
      setForm({
        itemName:         initialValues.itemName || '',
        category:         initialValues.category || categories[0]?.id || '',
        quantity:         String(qty),
        plannedUnitPrice: formatUnitPriceForInput(initialValues.plannedAmount, qty),
        actualUnitPrice:  formatUnitPriceForInput(initialValues.actualAmount,  qty),
      });
    } else {
      setForm({ ...EMPTY, category: categories[0]?.id || '' });
    }
    // Reset inline-add state every time the modal opens — never carry
    // an in-flight typo/error from a previous session into a fresh one.
    setAddingCategory(false);
    setNewCategoryLabel('');
    setNewCategoryError('');
    setNewCategoryBusy(false);
  }, [isOpen, categories, initialValues]);

  function handleChange(e) {
    // The category <select> handles its own toggle to inline-add when
    // the sentinel option is chosen; the rest of the inputs flow
    // straight into form state.
    if (e.target.name === 'category' && e.target.value === NEW_CATEGORY_SENTINEL) {
      setCategoryBeforeAdd(form.category);
      setNewCategoryLabel('');
      setNewCategoryError('');
      setAddingCategory(true);
      return;
    }
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function cancelNewCategory() {
    setAddingCategory(false);
    setNewCategoryLabel('');
    setNewCategoryError('');
    // Restore whatever was selected before the toggle so the form is
    // never left with a sentinel value as form.category.
    setForm((prev) => ({ ...prev, category: categoryBeforeAdd }));
  }

  async function saveNewCategory() {
    const label = newCategoryLabel.trim();
    if (!label || newCategoryBusy) return;
    // Prevent duplicate labels — the categories table likely has no
    // unique constraint on label (only on id), so a client-side
    // check is the simplest UX safeguard.
    const existing = categories.find(
      (c) => c.label.trim().toLowerCase() === label.toLowerCase(),
    );
    if (existing) {
      // Auto-select the existing one instead of failing. Matches what
      // a thoughtful colleague would do — the admin's intent is "use
      // this category", not necessarily "create a new row".
      setForm((prev) => ({ ...prev, category: existing.id }));
      setAddingCategory(false);
      setNewCategoryLabel('');
      return;
    }
    if (!onAddCategory) {
      setNewCategoryError('إضافة التصنيفات غير متاحة في وضع العرض التجريبي.');
      return;
    }
    setNewCategoryBusy(true);
    setNewCategoryError('');
    try {
      const id = freshCategoryId();
      await onAddCategory({ id, label });
      // useCategories refetches synchronously inside addCategory, but
      // the parent's `categories` prop may not have re-rendered by the
      // time this resolves. Setting form.category to the new id is
      // safe either way — the dropdown will show the option as soon as
      // the next render carries the updated list.
      setForm((prev) => ({ ...prev, category: id }));
      setAddingCategory(false);
      setNewCategoryLabel('');
    } catch (err) {
      console.error('🔥 Real Supabase Error (categories.insert):', err);
      setNewCategoryError(err?.message || 'تعذّر إضافة التصنيف.');
    } finally {
      setNewCategoryBusy(false);
    }
  }

  function handleNewCategoryKey(e) {
    // Enter saves, Escape cancels. Without these the inline form feels
    // unmoored from the rest of the modal's keyboard flow.
    if (e.key === 'Enter') {
      e.preventDefault();
      saveNewCategory();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelNewCategory();
    }
  }

  const quantity         = toPositive(form.quantity);
  const plannedUnitPrice = toPositive(form.plannedUnitPrice);
  const actualUnitPrice  = Math.max(0, parseFloat(form.actualUnitPrice) || 0);
  const plannedTotal     = quantity * plannedUnitPrice;
  const actualTotal      = quantity * actualUnitPrice;

  const isValid =
    form.itemName.trim().length > 0 &&
    Boolean(form.category) &&
    quantity > 0 &&
    plannedUnitPrice > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        itemName:      form.itemName.trim(),
        category:      form.category,
        quantity,
        plannedAmount: plannedTotal,
        actualAmount:  actualTotal,
      };
      if (editing && onUpdate) {
        await onUpdate(initialValues.id, payload);
      } else if (onAdd) {
        await onAdd({ ...payload, status: 'in_progress' });
      }
      onClose();
    } finally {
      setSubmitting(false);
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
            {editing ? 'تعديل بند رسوم التأسيس' : 'إضافة رسوم تأسيس'}
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
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="itemName">
              اسم البند
            </label>
            <input
              id="itemName"
              type="text"
              name="itemName"
              value={form.itemName}
              onChange={handleChange}
              placeholder="مثال: دبابات تنظيف، رسوم التسجيل التجاري"
              autoFocus
              required
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="category">
              التصنيف
            </label>

            {addingCategory ? (
              // Inline create row — replaces the dropdown until the
              // admin saves the new label or cancels. Matches the
              // dropdown's outer dimensions so the modal doesn't
              // visibly reflow during the toggle.
              <div className="space-y-2">
                <div className="flex items-stretch gap-2">
                  <div className="relative flex-1">
                    <Tag
                      size={16}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                    />
                    <input
                      ref={newCategoryInputRef}
                      type="text"
                      value={newCategoryLabel}
                      onChange={(e) => setNewCategoryLabel(e.target.value)}
                      onKeyDown={handleNewCategoryKey}
                      placeholder="اكتب اسم التصنيف الجديد..."
                      disabled={newCategoryBusy}
                      className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800/50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-colors disabled:opacity-60"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={saveNewCategory}
                    disabled={!newCategoryLabel.trim() || newCategoryBusy}
                    title="حفظ التصنيف الجديد"
                    aria-label="حفظ التصنيف الجديد"
                    className="inline-flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-3 rounded-xl text-sm font-bold transition-colors shadow-sm shrink-0"
                  >
                    {newCategoryBusy
                      ? <Loader2 size={16} className="animate-spin" />
                      : <Check size={16} strokeWidth={2.7} />}
                  </button>
                  <button
                    type="button"
                    onClick={cancelNewCategory}
                    disabled={newCategoryBusy}
                    title="إلغاء"
                    aria-label="إلغاء"
                    className="inline-flex items-center justify-center bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60 text-slate-500 dark:text-slate-400 px-3 rounded-xl transition-colors shrink-0"
                  >
                    <X size={16} strokeWidth={2.5} />
                  </button>
                </div>
                {newCategoryError && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 leading-relaxed">
                    {newCategoryError}
                  </p>
                )}
                <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                  اضغط Enter للحفظ أو Escape للإلغاء.
                </p>
              </div>
            ) : (
              <select
                id="category"
                name="category"
                value={form.category}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              >
                {categories.length === 0 && <option value="">— لا توجد تصنيفات —</option>}
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
                {/* Synthetic "create new" option pinned to the bottom.
                    Picking it routes through handleChange → toggles the
                    inline-create row above; the value never actually
                    lands in form.category. */}
                {onAddCategory && (
                  <option value={NEW_CATEGORY_SENTINEL}>
                    + إضافة تصنيف جديد...
                  </option>
                )}
              </select>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
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
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="plannedUnitPrice">
                سعر الوحدة المخطط (ر.س)
              </label>
              <input
                id="plannedUnitPrice"
                type="number"
                name="plannedUnitPrice"
                value={form.plannedUnitPrice}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="any"
                required
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="actualUnitPrice">
                سعر الوحدة الفعلي (ر.س)
              </label>
              <input
                id="actualUnitPrice"
                type="number"
                name="actualUnitPrice"
                value={form.actualUnitPrice}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="any"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-600 dark:text-slate-400">إجمالي الميزانية المخططة:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {quantity > 0 && plannedUnitPrice > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(plannedUnitPrice)} = ${formatCurrency(plannedTotal)}`
                  : `${formatCurrency(0)}`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-600 dark:text-slate-400">إجمالي التكلفة الفعلية:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {quantity > 0 && actualUnitPrice > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(actualUnitPrice)} = ${formatCurrency(actualTotal)}`
                  : `${formatCurrency(0)}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting || addingCategory}
              title={addingCategory ? 'أكمل إضافة التصنيف أولاً أو ألغِ العملية' : undefined}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              {editing ? <Pencil size={18} /> : <Plus size={18} />}
              {submitting
                ? (editing ? 'جارٍ الحفظ...' : 'جارٍ الإضافة...')
                : (editing ? 'حفظ التعديلات' : 'إضافة البند')}
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
