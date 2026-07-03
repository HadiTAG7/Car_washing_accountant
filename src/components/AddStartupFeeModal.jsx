import { useEffect, useRef, useState } from 'react';
import {
  X, Plus, Pencil, Receipt, Tag, Check, Loader2, Settings2, Trash2, ArrowRight,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';

// Sentinel value for the synthetic "⚙️ إدارة وتعديل التصنيفات..." option
// in the category dropdown. Picking it toggles the modal into the
// inline manager (which combines add + delete) instead of setting
// form.category.
const MANAGER_SENTINEL = '__sweater_manage_categories__';

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
  onDeleteCategory, usedCategoryIds, showToast, initialValues = null,
  isLedgerManaged = false,
}) {
  const editing = Boolean(initialValues?.id);
  // Items with ledger entries derive actual_amount from SUM(entries) —
  // the edit modal must not offer a second write path that bypasses
  // that roll-up (the inline table cell is already locked for these).
  const lockActual = editing && isLedgerManaged;
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  // Inline category-manager state. `managerOpen` is the boolean
  // toggle; when true, the <select> swaps for the manager panel
  // (existing categories list with delete + new-category input row).
  // `categoryBeforeManager` stashes whichever category was selected
  // before the toggle so "إغلاق" can restore it cleanly.
  const [managerOpen,           setManagerOpen]           = useState(false);
  const [newCategoryLabel,      setNewCategoryLabel]      = useState('');
  const [newCategoryBusy,       setNewCategoryBusy]       = useState(false);
  const [newCategoryError,      setNewCategoryError]      = useState('');
  const [categoryBeforeManager, setCategoryBeforeManager] = useState('');
  // Track which category id is mid-delete so its trash icon can swap
  // for a spinner. Set/clear on the same call.
  const [deletingCategoryId,    setDeletingCategoryId]    = useState(null);
  const newCategoryInputRef = useRef(null);

  // Auto-focus the new-category input every time we enter the
  // manager — keeps the keyboard flow snappy after the dropdown click.
  useEffect(() => {
    if (managerOpen) {
      const id = requestAnimationFrame(() => newCategoryInputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [managerOpen]);

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
    // Reset manager state every time the modal opens — never carry
    // an in-flight typo/error from a previous session into a fresh one.
    setManagerOpen(false);
    setNewCategoryLabel('');
    setNewCategoryError('');
    setNewCategoryBusy(false);
    setDeletingCategoryId(null);
  }, [isOpen, categories, initialValues]);

  function handleChange(e) {
    // The category <select> handles its own toggle to the manager
    // when the sentinel option is chosen; the rest of the inputs flow
    // straight into form state.
    if (e.target.name === 'category' && e.target.value === MANAGER_SENTINEL) {
      setCategoryBeforeManager(form.category);
      setNewCategoryLabel('');
      setNewCategoryError('');
      setManagerOpen(true);
      return;
    }
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function closeManager() {
    setManagerOpen(false);
    setNewCategoryLabel('');
    setNewCategoryError('');
    // Restore whatever was selected before opening the manager so the
    // form is never left with a sentinel value as form.category.
    setForm((prev) => ({ ...prev, category: categoryBeforeManager }));
  }

  async function saveNewCategory() {
    const label = newCategoryLabel.trim();
    if (!label || newCategoryBusy) return;
    // Prevent duplicate labels — the categories table has no unique
    // constraint on label (only on id), so a client-side check is
    // the simplest UX safeguard.
    const existing = categories.find(
      (c) => c.label.trim().toLowerCase() === label.toLowerCase(),
    );
    if (existing) {
      // Auto-select the existing one instead of erroring. Matches the
      // admin's intent ("use this category") without a duplicate row.
      setForm((prev) => ({ ...prev, category: existing.id }));
      setManagerOpen(false);
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
      setForm((prev) => ({ ...prev, category: id }));
      // Stay in the manager so the admin can do more housekeeping
      // (e.g. add several categories, delete an old one) in one pass.
      // Clear the input so the next add starts clean.
      setNewCategoryLabel('');
    } catch (err) {
      console.error('🔥 Real Supabase Error (categories.insert):', err);
      setNewCategoryError(err?.message || 'تعذّر إضافة التصنيف.');
    } finally {
      setNewCategoryBusy(false);
    }
  }

  async function deleteCategoryInline(cat) {
    if (!cat || deletingCategoryId) return;
    // Usage check FIRST — better UX than asking "are you sure?" only
    // to refuse afterwards. We still gate the destructive call with
    // window.confirm per spec.
    const inUse = usedCategoryIds && usedCategoryIds.has(cat.id);
    if (inUse) {
      showToast?.(
        '⚠️ لا يمكن حذف هذا التصنيف لأنه مستخدم حالياً في بعض البنود. قم بتغيير تصنيف البنود أولاً.',
        'error',
      );
      return;
    }
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('هل أنت متأكد من حذف هذا التصنيف نهائياً؟')
      : true;
    if (!confirmed) return;
    if (!onDeleteCategory) {
      showToast?.('حذف التصنيفات غير متاح في وضع العرض التجريبي.', 'error');
      return;
    }
    setDeletingCategoryId(cat.id);
    try {
      await onDeleteCategory(cat.id);
      // If the deleted category was the modal's current pick (or the
      // pre-manager pick), clear it so the form doesn't reference a
      // ghost id after the manager closes.
      if (form.category === cat.id) {
        setForm((prev) => ({ ...prev, category: '' }));
      }
      if (categoryBeforeManager === cat.id) {
        setCategoryBeforeManager('');
      }
      showToast?.('تم حذف التصنيف من القوائم.', 'success');
    } catch (err) {
      console.error('🔥 Real Supabase Error (categories.delete):', err, 'id:', cat.id);
      showToast?.(err?.message || 'تعذّر حذف التصنيف.', 'error');
    } finally {
      setDeletingCategoryId(null);
    }
  }

  function handleNewCategoryKey(e) {
    // Enter saves the new label; Escape leaves the manager entirely.
    if (e.key === 'Enter') {
      e.preventDefault();
      saveNewCategory();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeManager();
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
      };
      // Ledger-managed items: actual_amount stays owned by the entries
      // roll-up — omitting the key means toStartupCostUpdate skips the
      // column entirely.
      if (!lockActual) {
        payload.actualAmount = actualTotal;
      }
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
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

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

            {managerOpen ? (
              // Inline category manager — replaces the dropdown until
              // the admin clicks "إغلاق". Combines a new-category
              // input row (top) with a scrollable list of existing
              // categories carrying delete buttons (bottom). The
              // outer card uses the same dark tokens as the modal
              // shell so the swap reads as a focused sub-region, not
              // a stacked card.
              <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between gap-3">
                  <h4 className="inline-flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
                    <Settings2 size={15} className="text-primary-700 dark:text-primary-400" />
                    إدارة التصنيفات
                  </h4>
                  <button
                    type="button"
                    onClick={closeManager}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 dark:text-primary-400 hover:underline"
                    title="رجوع إلى اختيار تصنيف للبند"
                  >
                    <ArrowRight size={12} />
                    إغلاق
                  </button>
                </div>

                {/* Existing categories — scroll cap so a long list
                    doesn't push the rest of the modal off-screen. */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                    التصنيفات الحالية
                  </p>
                  {categories.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 italic py-2">
                      — لا توجد تصنيفات بعد —
                    </p>
                  ) : (
                    <ul className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60 border border-slate-100 dark:border-slate-700/60 rounded-lg">
                      {categories.map((cat) => {
                        const inUse  = Boolean(usedCategoryIds?.has(cat.id));
                        const busy   = deletingCategoryId === cat.id;
                        return (
                          <li
                            key={cat.id}
                            className="flex items-center justify-between gap-2 px-3 py-2 group hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                          >
                            <span className="text-sm text-slate-700 dark:text-slate-300 truncate">
                              {cat.label}
                              {inUse && (
                                <span className="mr-2 inline-block text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 align-middle">
                                  مستخدم
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteCategoryInline(cat)}
                              disabled={busy}
                              title={inUse
                                ? 'هذا التصنيف مستخدم في بعض البنود — لا يمكن حذفه'
                                : 'حذف هذا التصنيف نهائياً'}
                              aria-label={`حذف ${cat.label}`}
                              className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                                inUse
                                  ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                                  : 'text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15'
                              } disabled:opacity-60`}
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

                {/* Inline add row — kept inside the manager so the
                    admin can do both ops in one pass without flipping
                    back and forth. */}
                <div className="pt-1 border-t border-slate-100 dark:border-slate-700/60">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5 mt-3">
                    إضافة تصنيف جديد
                  </p>
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
                        className="w-full pr-9 pl-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800/50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-colors disabled:opacity-60"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={saveNewCategory}
                      disabled={!newCategoryLabel.trim() || newCategoryBusy}
                      title="حفظ التصنيف الجديد"
                      aria-label="حفظ التصنيف الجديد"
                      className="inline-flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-3 rounded-xl text-sm font-bold transition-colors shadow-sm shrink-0"
                    >
                      {newCategoryBusy
                        ? <Loader2 size={16} className="animate-spin" />
                        : <Check size={16} strokeWidth={2.7} />}
                    </button>
                  </div>
                  {newCategoryError && (
                    <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400 leading-relaxed">
                      {newCategoryError}
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                    اضغط Enter لحفظ التصنيف الجديد، أو Escape لإغلاق المدير.
                  </p>
                </div>
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
                {/* Synthetic manager option pinned to the bottom.
                    Picking it routes through handleChange → opens
                    the inline manager above; the value never lands
                    in form.category. */}
                {(onAddCategory || onDeleteCategory) && (
                  <option value={MANAGER_SENTINEL}>
                    ⚙️ إدارة وتعديل التصنيفات...
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
                disabled={lockActual}
                title={lockActual ? 'التكلفة الفعلية تُحسب تلقائياً من سجل مصروفات هذا البند' : undefined}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent disabled:bg-slate-50 dark:disabled:bg-slate-800/60 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {lockActual && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed -mt-2">
              التكلفة الفعلية لهذا البند تُحسب تلقائياً من سجل المصروفات الخاص به —
              لتعديلها أضف أو احذف مصروفاً من صفحة تفاصيل البند.
            </p>
          )}

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
              disabled={!isValid || submitting || managerOpen}
              title={managerOpen ? 'أغلق مدير التصنيفات أولاً' : undefined}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-600 dark:hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
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
