import { useEffect, useRef, useState } from 'react';
import { X, Plus, Pencil, Repeat, Check, AlertTriangle, ChevronDown } from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';

const EMPTY = {
  expenseName:    '',
  category:       '',
  quantity:       '1',
  unitCost:       '',
  paymentMonth:   '1',
  paymentDay:     '1',
  paymentStatus:  'pending',
};

const MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function formatUnitForInput(total, quantity) {
  if (!total || !quantity || quantity <= 0) return '';
  const unit = total / quantity;
  if (!Number.isFinite(unit) || unit <= 0) return '';
  return Number(unit.toFixed(2)).toString();
}

function clampDayString(value, fallback = '1') {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return String(Math.min(31, Math.max(1, n)));
}

function clampMonthString(value, fallback = '1') {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return String(Math.min(12, Math.max(1, n)));
}

// ─── Custom category dropdown ──────────────────────────────────────────────
// Replaces the native <select>, which on some browsers (notably mobile
// Safari) opens a full-screen picker with awkward empty padding even when
// only 4-5 options are present. This panel sizes to its content.
function CategoryDropdown({ categories, value, onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const empty = categories.length === 0;
  const selected = categories.find((c) => c.id === value);
  const displayLabel = empty
    ? '— لا توجد تصنيفات —'
    : (selected?.label || 'اختر التصنيف');

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => !empty && setOpen((o) => !o)}
        disabled={empty}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className="flex-1 text-right truncate">{displayLabel}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && !empty && (
        <ul
          role="listbox"
          className="absolute top-full right-0 left-0 mt-1 z-30 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 max-h-64 overflow-y-auto"
        >
          {categories.map((cat) => {
            const active = cat.id === value;
            return (
              <li key={cat.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => { onChange(cat.id); setOpen(false); }}
                  className={`w-full px-4 py-2.5 text-right text-sm transition-colors ${
                    active
                      ? 'bg-primary-50 dark:bg-primary-500/20 text-primary-800 dark:text-primary-200 font-semibold'
                      : 'text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                  }`}
                >
                  {cat.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function AddAnnualExpenseModal({
  isOpen, onClose, onAdd, onUpdate, onAddCategory,
  categories = [], initialValues = null,
}) {
  const editing = Boolean(initialValues?.id);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  // Inline "add new category" UI state.
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [catError, setCatError] = useState('');

  // Re-init when the modal opens or switches between add/edit. We DO NOT
  // re-init on every `categories` change — after addCategory triggers a
  // refetch we want to preserve the user's selection (the new category id
  // we just set), not snap back to categories[0].
  useEffect(() => {
    if (!isOpen) return;
    setShowNewCat(false);
    setNewCatLabel('');
    setCatError('');
    if (initialValues?.id) {
      const qty = Math.max(1, parseInt(initialValues.quantity, 10) || 1);
      setForm({
        expenseName:    initialValues.expenseName   || '',
        category:       initialValues.category      || '',
        quantity:       String(qty),
        unitCost:       formatUnitForInput(initialValues.annualCost, qty),
        paymentMonth:   clampMonthString(initialValues.paymentMonth, '1'),
        paymentDay:     clampDayString(initialValues.paymentDay, '1'),
        paymentStatus:  initialValues.paymentStatus === 'paid' ? 'paid' : 'pending',
      });
    } else {
      setForm({ ...EMPTY });
    }
  }, [isOpen, initialValues]);

  // Default the category to the first option ONCE categories have loaded,
  // but only if the form doesn't already have a (still-valid) selection.
  useEffect(() => {
    if (!isOpen || categories.length === 0) return;
    setForm((prev) => {
      const stillValid = prev.category && categories.some((c) => c.id === prev.category);
      if (stillValid) return prev;
      return { ...prev, category: categories[0].id };
    });
  }, [isOpen, categories]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const quantity     = Math.max(1, parseInt(form.quantity, 10) || 0);
  const unitCost     = Math.max(0, parseFloat(form.unitCost) || 0);
  const annualCost   = quantity * unitCost;
  const paymentMonth = Math.min(12, Math.max(1, parseInt(form.paymentMonth, 10) || 1));
  const paymentDay   = Math.min(31, Math.max(1, parseInt(form.paymentDay,   10) || 1));
  const isValid =
    form.expenseName.trim().length > 0 &&
    Boolean(form.category) &&
    quantity > 0 &&
    unitCost > 0 &&
    paymentMonth >= 1 && paymentMonth <= 12 &&
    paymentDay   >= 1 && paymentDay   <= 31;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        expenseName:   form.expenseName.trim(),
        category:      form.category,
        quantity,
        annualCost,
        paymentMonth,
        paymentDay,
        paymentStatus: form.paymentStatus === 'paid' ? 'paid' : 'pending',
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
        setForm((prev) => ({ ...prev, category: newId }));
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

  const HeaderIcon = editing ? Pencil : Repeat;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <span className="bg-accent-50 text-accent-600 w-9 h-9 rounded-xl flex items-center justify-center">
              <HeaderIcon size={18} />
            </span>
            {editing ? 'تعديل مصروف سنوي' : 'إضافة مصروف سنوي'}
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
              placeholder="مثال: تأمين الأسطول السنوي"
              autoFocus
              required
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="category">
              التصنيف
            </label>
            <div className="flex gap-2">
              <CategoryDropdown
                categories={categories}
                value={form.category}
                onChange={(id) => setForm((prev) => ({ ...prev, category: id }))}
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
                تكلفة الوحدة السنوية (ر.س)
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="paymentMonth">
                شهر الصرف السنوي
              </label>
              <select
                id="paymentMonth"
                name="paymentMonth"
                value={form.paymentMonth}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              >
                {MONTH_NAMES.map((name, idx) => {
                  const m = String(idx + 1);
                  return <option key={m} value={m}>{m} — {name}</option>;
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="paymentDay">
                يوم الصرف
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
            </div>
          </div>

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

          {/* Live total — quantity × annual unit cost */}
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-600 dark:text-slate-400">إجمالي التكلفة السنوية:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {quantity > 0 && unitCost > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(unitCost)} = ${formatCurrency(annualCost)}`
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
