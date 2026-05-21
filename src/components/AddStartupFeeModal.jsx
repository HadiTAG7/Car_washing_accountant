import { useEffect, useState } from 'react';
import { X, Plus, Receipt } from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';

const EMPTY = {
  itemName:         '',
  category:         '',
  quantity:         '1',
  plannedUnitPrice: '',
  actualUnitPrice:  '',
};

function toNonNegativeNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function AddStartupFeeModal({ isOpen, onClose, onAdd, categories = [] }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm({ ...EMPTY, category: categories[0]?.id || '' });
    }
  }, [isOpen, categories]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const quantity         = toNonNegativeNumber(form.quantity);
  const plannedUnitPrice = toNonNegativeNumber(form.plannedUnitPrice);
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
        itemName:      form.itemName.trim(),
        category:      form.category,
        plannedAmount: plannedTotal,
        actualAmount:  actualTotal,
        status:        'in_progress',
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span className="bg-accent-50 text-accent-600 w-9 h-9 rounded-xl flex items-center justify-center">
              <Receipt size={18} />
            </span>
            إضافة رسوم تأسيس
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200 transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="itemName">
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
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="category">
              التصنيف
            </label>
            <select
              id="category"
              name="category"
              value={form.category}
              onChange={handleChange}
              required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            >
              {categories.length === 0 && <option value="">— لا توجد تصنيفات —</option>}
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="quantity">
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
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="plannedUnitPrice">
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
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="actualUnitPrice">
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
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>
          </div>

          {/* Live totals — calculated from quantity × unit price */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-600">إجمالي الميزانية المخططة:</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {quantity > 0 && plannedUnitPrice > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(plannedUnitPrice)} = ${formatCurrency(plannedTotal)}`
                  : `${formatCurrency(0)}`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-600">إجمالي التكلفة الفعلية:</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {quantity > 0 && actualUnitPrice > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(actualUnitPrice)} = ${formatCurrency(actualTotal)}`
                  : `${formatCurrency(0)}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              <Plus size={18} />
              {submitting ? 'جارٍ الإضافة...' : 'إضافة البند'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
