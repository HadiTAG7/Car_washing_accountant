import { useEffect, useState } from 'react';
import { X, Plus, Pencil, Repeat, Check, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';
import { unitListProblems, parseUnitsText } from '../lib/accounting/startupMigration';
import CategorySelect from './CategorySelect';

const EMPTY = {
  expenseName:    '',
  category:       '',
  quantity:       '1',
  unitCost:       '',
  paymentMonth:   '1',
  paymentDay:     '1',
  paymentStatus:  'pending',
  unitsText:      '',
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

export default function AddAnnualExpenseModal({
  isOpen, onClose, onAdd, onUpdate, onAddCategory, onDeleteCategory,
  categories = [], protectedCategoryLabels = [], initialValues = null,
}) {
  const editing = Boolean(initialValues?.id);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  // ── ما يرفضه الخادم يجب أن يُقرأ ──
  // `handleSubmit` was try/finally with no catch, so a rejected save closed
  // the modal exactly like an accepted one and the typed values were gone.
  const [saveError, setSaveError] = useState('');

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
        unitsText:      (initialValues.units || []).join('\n'),
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

    // نفس دالة التحقق التي يستعملها بند التأسيس — فاسمٌ مكرّر أو مفرط الطول
    // يُرفض بالجملة نفسها في النموذجين، ويُرفض بصوتٍ مسموع: قائمةٌ تُقصَّر
    // بصمت عند الحفظ هي قائمةٌ يظنّ صاحبها أنه حفظها.
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
        expenseName:   form.expenseName.trim(),
        category:      form.category,
        quantity,
        annualCost,
        paymentMonth,
        paymentDay,
        paymentStatus: form.paymentStatus === 'paid' ? 'paid' : 'pending',
        // يُرسَل دائماً وعلى المسارين — قائمةٌ أُفرغت يجب أن تمحو سابقتها،
        // و`units` غائبةً تعني «لا تمسّها» في `toAnnualExpenseUpdate`.
        units,
      };
      if (editing && onUpdate) {
        await onUpdate(initialValues.id, payload);
      } else if (onAdd) {
        await onAdd(payload);
      }
      onClose();
    } catch (err) {
      setSaveError(err?.message || 'تعذّر الحفظ — لم يُسجَّل شيء.');
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
            {editing ? 'تعديل مصروف سنوي' : 'إضافة مصروف سنوي'}
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
              placeholder="مثال: تأمين الأسطول السنوي"
              autoFocus
              required
              className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="category">
              التصنيف
            </label>
            <div className="flex gap-2">
              <CategorySelect
                categories={categories}
                value={form.category}
                onChange={(id) => setForm((prev) => ({ ...prev, category: id }))}
                ariaLabel="التصنيف السنوي"
                onDelete={onDeleteCategory}
                protectedLabels={protectedCategoryLabels}
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
                      if (e.key === 'Enter') { e.preventDefault(); handleSaveNewCategory(); }
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
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
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
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
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
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
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
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
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
              className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
            >
              <option value="pending">قيد الانتظار</option>
              <option value="paid">مدفوع</option>
            </select>
          </div>

          {/* ── تقسيمات البند ──
              «الإيجار مسجّل في المصاريف السنوية — أبغاه يظهر في صفحة السكن».
              The list lives on the PLAN, not derived from the payments, so it
              shows before anything has been paid — and the item keeps ONE
              annual cost, with the units as a breakdown under it. Naming the
              housing units here is what lets the housing tab read this item's
              rent per unit instead of one lump nobody can divide. */}
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
              rows={3}
              placeholder={'سكن الشمال\nسكن الغرب'}
              className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm leading-relaxed focus:outline-none focus:border-primary-500 transition-colors"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              تظهر داخل سجل المصاريف، ويُنسب كل دفعة لواحدٍ منها. لبند الإيجار:
              اكتب أسماء السكنات كما هي في تبويب «السكن» ليقرأ إيجار كلٍّ منها.
              التكلفة السنوية تبقى واحدة للبند كله.
            </p>
          </div>

          {saveError && (
            <div
              role="alert"
              className="flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-control px-3 py-2.5 text-[12px] text-rose-700 dark:text-rose-300 font-medium leading-relaxed"
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span className="flex-1 break-words">{saveError}</span>
            </div>
          )}

          {/* Live total — quantity × annual unit cost */}
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">إجمالي التكلفة السنوية:</span>
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
