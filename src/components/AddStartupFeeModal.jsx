import { useEffect, useRef, useState } from 'react';
import {
  X, Plus, Pencil, Receipt, Tag, Check, Loader2, Settings2, Trash2, ArrowRight,
  Percent, Link as LinkIcon, Info,
} from 'lucide-react';
import {
  formatCurrency, formatNumber,
} from '../data/initialData';
import { unitListProblems } from '../lib/accounting/startupMigration';
import { describeBackendError } from '../lib/firebaseClient';

// Sentinel value for the synthetic "⚙️ إدارة وتعديل التصنيفات..." option
// in the category dropdown. Picking it toggles the modal into the
// inline manager (which combines add + delete) instead of setting
// form.category.
const MANAGER_SENTINEL = '__sweater_manage_categories__';

// Generates a stable id for a freshly-created category. `categories.id`
// is `text primary key`, so we need to supply our own — we use the
// browser's Web Crypto UUID generator (universally available in modern
// React app contexts; the codebase already relies on it for password
// generation in firebaseClient.js).
function freshCategoryId() {
  return (globalThis.crypto || window.crypto).randomUUID();
}

const EMPTY = {
  itemName:         '',
  category:         '',
  quantity:         '1',
  plannedUnitPrice: '',
  // تقسيمات داخل البند — السكنات مثلاً. سطرٌ لكل اسم.
  unitsText:        '',
};

function toPositive(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * أسطر المربّع ⇐ قائمة أسماء.
 *
 * The textarea shipped without this: `handleSubmit` built its payload from
 * four fields and `unitsText` was never read, so five housing names were
 * discarded in the browser before any network call — no error, no save, and
 * a screen that looked like it had worked. Kept as a named function so the
 * test names the thing it is testing.
 */
function parseUnitsText(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
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
}) {
  const editing = Boolean(initialValues?.id);
  // ── هذا النموذج للخطة وحدها ──
  // `actual_amount` is derived from SUM(entries) and the invoice belongs to
  // an entry, so neither is offered here — a second write path would bypass
  // the roll-up and, worse, would recreate a parent-level tax claim that
  // nothing in the ledger can ever post against.
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  // ── الرفض يُقال، لا يُبتلع ──
  // `handleSubmit` used to be `try`/`finally` with no `catch`: any refusal —
  // the server's or the validator's — died as an unhandled rejection while
  // the modal closed as though the save had taken.
  const [saveError, setSaveError] = useState('');
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
        unitsText:        (initialValues.units || []).join('\n'),

        invoiceUrl:       initialValues.invoiceUrl || '',
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
    setSaveError('');
    // ── ولماذا ليست `categories` ولا `initialValues` في الاعتماديات ──
    // `useCategories` returns `data ?? []`, and while `data` is null that `[]`
    // is a NEW identity on every render — so listing it here re-ran this
    // effect continuously and wiped the form under the user's fingers, the
    // units textarea included. `initialValues` is a fresh object each render
    // of the page for the same reason. The identity that actually decides
    // what to seed is the item's id, so that is what is watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialValues?.id]);

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
    const { name, type, value, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
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
      console.error('🔥 Firestore Error (categories.insert):', err);
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
      console.error('🔥 Firestore Error (categories.delete):', err, 'id:', cat.id);
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
  const plannedTotal     = quantity * plannedUnitPrice;
  // Read-only: the sub-ledger's roll-up, shown so the form is informative
  // without being a way to write it.
  const actualTotal      = Math.max(0, Number(initialValues?.actualAmount) || 0);

  const isValid =
    form.itemName.trim().length > 0 &&
    Boolean(form.category) &&
    quantity > 0 &&
    plannedUnitPrice > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;

    // ── التقسيمات تُتحقَّق هنا بنفس دالة الخادم ──
    // `unitListProblems` is the same function `startupUpdatePlan` runs, so a
    // duplicate or an over-long name is refused with the SAME sentence on both
    // sides — the client never grows a second opinion about a valid name. And
    // it is refused OUT LOUD: a list quietly shortened on save is a list the
    // user believes they saved.
    const units = parseUnitsText(form.unitsText);
    const unitProblems = unitListProblems(units);
    if (unitProblems.length) {
      setSaveError(unitProblems[0]);
      return;
    }

    setSubmitting(true);
    setSaveError('');
    try {
      const payload = {
        itemName:      form.itemName.trim(),
        category:      form.category,
        quantity,
        plannedAmount: plannedTotal,
        // The line this form shipped without. Sent on BOTH paths and always —
        // an emptied list must be able to clear a previous one, and `units`
        // absent would mean "leave it alone" to `useStartupCosts.updateItem`.
        units,
      };
      // No `actualAmount`, no tax fields, no invoice: `toStartupCostInsert`
      // and `toStartupCostUpdate` do not carry them at all any more. The
      // sub-ledger owns the actual amount, and the invoice belongs to the
      // entry that has a date to go with it.
      if (editing && onUpdate) {
        await onUpdate(initialValues.id, payload);
      } else if (onAdd) {
        await onAdd({ ...payload, status: 'in_progress' });
      }
      onClose();
    } catch (err) {
      // Stay open with the values intact. Closing on a refusal is what made
      // this bug invisible for a day.
      setSaveError(describeBackendError(err) || err?.message || 'تعذّر حفظ البند.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const HeaderIcon = editing ? Pencil : Receipt;

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
            {editing ? 'تعديل بند رسوم التأسيس' : 'إضافة رسوم تأسيس'}
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
              className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
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
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-smallcard p-4 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between gap-3">
                  <h4 className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <Settings2 size={15} className="text-primary-700 dark:text-primary-300" />
                    إدارة التصنيفات
                  </h4>
                  <button
                    type="button"
                    onClick={closeManager}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-control text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/15 transition-colors"
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
                    <ul className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-control">
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
                                <span className="mr-2 inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 align-middle">
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
                              className={`sw-tap inline-flex items-center justify-center p-1.5 rounded-control transition-colors shrink-0 ${
                                inUse
                                  ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                                  : 'text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10'
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
                <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5 mt-3">
                    إضافة تصنيف جديد
                  </p>
                  <div className="flex items-stretch gap-2">
                    <div className="relative flex-1">
                      <Tag
                        size={16}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
                      />
                      <input
                        ref={newCategoryInputRef}
                        type="text"
                        value={newCategoryLabel}
                        onChange={(e) => setNewCategoryLabel(e.target.value)}
                        onKeyDown={handleNewCategoryKey}
                        placeholder="اكتب اسم التصنيف الجديد..."
                        disabled={newCategoryBusy}
                        className="w-full pr-9 pl-4 py-2.5 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors disabled:opacity-60"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={saveNewCategory}
                      disabled={!newCategoryLabel.trim() || newCategoryBusy}
                      title="حفظ التصنيف الجديد"
                      aria-label="حفظ التصنيف الجديد"
                      className="sw-tap sw-button sw-button--sm sw-button--primary shrink-0"
                    >
                      {newCategoryBusy
                        ? <Loader2 size={16} className="animate-spin" />
                        : <Check size={16} strokeWidth={2.7} />}
                    </button>
                  </div>
                  {newCategoryError && (
                    <p role="alert" className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400 leading-relaxed">
                      {newCategoryError}
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
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
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
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

          {/* items-end bottom-aligns the three fields: the middle label wraps
              to two lines on narrow widths, which would otherwise push its
              input below its neighbours. */}
          <div className="grid grid-cols-3 gap-3 items-end">
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
                className="w-full px-3 py-2.5 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
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
                className="w-full px-3 py-2.5 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
            <div>
              {/* ── التكلفة الفعلية تُقرأ ولا تُكتب هنا ──
                  A parent-level amount has no spend date, no payment method
                  and no invoice identity, so nothing can build a journal entry
                  from it: `ADAPTERS.startup` reads `startup_cost_entries`, and
                  there is deliberately no adapter for the parent. Typing a
                  figure here produced a row that entered the VAT return and
                  could never reach 1200. Real spend is recorded in the item's
                  ledger, one document at a time. */}
              <span className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                التكلفة الفعلية
              </span>
              <div className="w-full px-3 py-2.5 rounded-control border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-sm tabular-nums">
                {formatCurrency(actualTotal)}
              </div>
            </div>
          </div>

          {/* ── تقسيمات داخل البند ──
              «لما أفتح تجهيز السكن يظهر لي أنواع السكن اللي عندنا». The list
              lives on the PLAN, not derived from the expenses, so it shows
              before anything has been spent — and the item keeps ONE budget,
              with the units as a breakdown under it rather than five budgets
              of their own. */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="unitsText">
              تقسيمات البند
              <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mr-1">— اختياري، اسم في كل سطر</span>
            </label>
            <textarea
              id="unitsText"
              name="unitsText"
              value={form.unitsText}
              onChange={handleChange}
              rows={4}
              placeholder={'سكن النزهة\nسكن الشمال\nسكن الروضة'}
              className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm leading-relaxed focus:outline-none focus:border-primary-500 transition-colors"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              تظهر داخل سجل المصاريف، ويُنسب كل مصروف لواحدٍ منها مع مجموعه.
              الميزانية تبقى واحدة للبند كله.
              {' '}<strong>إعادة تسمية تقسيم تترك مصاريفه تحت الاسم القديم</strong> حتى تُعيد إسنادها.
            </p>
          </div>

          <div className="flex items-start gap-2 px-3 py-2.5 rounded-control bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/30 text-[12px] text-indigo-700 dark:text-indigo-300 leading-relaxed">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>
              التكلفة الفعلية مجموع <strong>سجل مصاريف البند</strong> — يُفتح
              بالنقر على اسم البند. كل مصروف هناك يحمل تاريخ صرفه وطريقة دفعه
              وبيانات فاتورته، وهي ما يجعله قابلاً للترحيل ولخصم ضريبته؛ مبلغ
              مكتوب على البند مباشرةً لا يملك أياً منها.
            </span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">إجمالي الميزانية المخططة:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {quantity > 0 && plannedUnitPrice > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(plannedUnitPrice)} = ${formatCurrency(plannedTotal)}`
                  : `${formatCurrency(0)}`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">إجمالي التكلفة الفعلية:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatCurrency(actualTotal)}
              </span>
            </div>
          </div>

          {saveError && (
            <p
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-control px-3 py-2.5 leading-relaxed"
            >
              {saveError}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting || managerOpen}
              title={managerOpen ? 'أغلق مدير التصنيفات أولاً' : undefined}
              className="sw-button sw-button--sm sw-button--primary flex-1"
            >
              {editing ? <Pencil size={18} /> : <Plus size={18} />}
              {submitting
                ? (editing ? 'جارٍ الحفظ...' : 'جارٍ الإضافة...')
                : (editing ? 'حفظ التعديلات' : 'إضافة البند')}
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
