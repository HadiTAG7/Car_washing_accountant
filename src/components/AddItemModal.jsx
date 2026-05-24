import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';

const EMPTY = {
  category:         '',
  itemName:         '',
  quantity:         '1',
  plannedUnitPrice: '',
  actualUnitPrice:  '',
};

function toPositive(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function AddItemModal({ isOpen, onClose, onAdd, categories = [], onAddCategory }) {
  const [form, setForm] = useState(EMPTY);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm({ ...EMPTY, category: categories[0]?.id || '' });
      setShowNewCat(false);
      setNewCatLabel('');
    }
  }, [isOpen, categories]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
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
      await onAdd({
        category:      form.category,
        itemName:      form.itemName.trim(),
        // Legacy shape (used by older callers of this modal)
        budgeted:      plannedTotal,
        actual:        actualTotal,
        // Module 1 shape (used by the new useStartupCosts.addItem flow)
        plannedAmount: plannedTotal,
        actualAmount:  actualTotal,
        status:        'in_progress',
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddCategory(e) {
    e.preventDefault();
    if (!newCatLabel.trim() || !onAddCategory) return;
    setAddingCat(true);
    try {
      const id = newCatLabel.trim().toLowerCase().replace(/\s+/g, '-');
      await onAddCategory({ id, label: newCatLabel.trim() });
      setForm((prev) => ({ ...prev, category: id }));
      setNewCatLabel('');
      setShowNewCat(false);
    } finally {
      setAddingCat(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-gray-800 dark:text-slate-200 flex items-center gap-2">
            <Plus size={20} className="text-primary-600" />
            إضافة بند جديد
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:text-slate-400 p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          {/* Item Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5" htmlFor="itemName">
              اسم البند
            </label>
            <input
              id="itemName"
              type="text"
              name="itemName"
              value={form.itemName}
              onChange={handleChange}
              placeholder="مثال: دبابات تنظيف، غسالة صناعية"
              required
              autoFocus
              className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5" htmlFor="quantity">
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
              className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">التصنيف</label>
            <div className="flex gap-2">
              <select
                name="category"
                value={form.category}
                onChange={handleChange}
                className="flex-1 px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
              >
                {categories.length === 0 && <option value="">— لا توجد تصنيفات —</option>}
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
              {onAddCategory && (
                <button
                  type="button"
                  onClick={() => setShowNewCat(!showNewCat)}
                  className="px-3 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-primary-700 hover:bg-primary-50 transition-colors font-semibold"
                  title="إضافة تصنيف جديد"
                >
                  <Plus size={18} />
                </button>
              )}
            </div>

            {showNewCat && onAddCategory && (
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={newCatLabel}
                  onChange={(e) => setNewCatLabel(e.target.value)}
                  placeholder="اسم التصنيف الجديد"
                  className="flex-1 px-3 py-2 border border-primary-200 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-primary-300 bg-primary-50/50"
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  disabled={!newCatLabel.trim() || addingCat}
                  className="px-4 py-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {addingCat ? '...' : 'أضف'}
                </button>
              </div>
            )}
          </div>

          {/* Unit-price row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5" htmlFor="plannedUnitPrice">
                سعر الوحدة المخطط (ر.س)
              </label>
              <input
                id="plannedUnitPrice"
                type="number"
                name="plannedUnitPrice"
                value={form.plannedUnitPrice}
                onChange={handleChange}
                placeholder="0"
                required
                min="0"
                step="any"
                className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5" htmlFor="actualUnitPrice">
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
                className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Live totals */}
          <div className="bg-gray-50 dark:bg-slate-800/60 border border-gray-100 dark:border-slate-800 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-gray-600 dark:text-slate-400">إجمالي الميزانية المخططة:</span>
              <span className="font-bold text-gray-900 tabular-nums">
                {quantity > 0 && plannedUnitPrice > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(plannedUnitPrice)} = ${formatCurrency(plannedTotal)}`
                  : formatCurrency(0)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-gray-600 dark:text-slate-400">إجمالي التكلفة الفعلية:</span>
              <span className="font-bold text-gray-900 tabular-nums">
                {quantity > 0 && actualUnitPrice > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(actualUnitPrice)} = ${formatCurrency(actualTotal)}`
                  : formatCurrency(0)}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="flex-1 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              {submitting ? 'جارٍ الإضافة...' : 'إضافة البند'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 dark:bg-slate-800/60 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
