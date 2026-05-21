import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';

const EMPTY = {
  assetName:        '',
  purchaseDate:     '',
  quantity:         '1',
  plannedUnitPrice: '',
  actualUnitPrice:  '',
  salvageValue:     '',
  usefulLife:       '',
};

function toPositive(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function AddAssetModal({ isOpen, onClose, onAdd }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) setForm(EMPTY);
  }, [isOpen]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const quantity         = toPositive(form.quantity);
  const plannedUnitPrice = toPositive(form.plannedUnitPrice);
  const actualUnitPrice  = Math.max(0, parseFloat(form.actualUnitPrice) || 0);
  const plannedTotal     = quantity * plannedUnitPrice;
  const actualTotal      = quantity * actualUnitPrice;
  // Effective purchase cost stored in DB: actual when provided, else planned.
  const purchaseCost     = actualTotal > 0 ? actualTotal : plannedTotal;

  const isValid =
    form.assetName.trim().length > 0 &&
    Boolean(form.purchaseDate) &&
    quantity > 0 &&
    plannedUnitPrice > 0 &&
    parseInt(form.usefulLife, 10) > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      await onAdd({
        assetName:     form.assetName.trim(),
        purchaseDate:  form.purchaseDate,
        purchaseCost,
        salvageValue:  form.salvageValue ? parseFloat(form.salvageValue) : 0,
        usefulLife:    parseInt(form.usefulLife, 10),
        // Extras for consumers that want the breakdown
        quantity,
        plannedUnitPrice,
        actualUnitPrice,
        plannedTotal,
        actualTotal,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Plus size={20} className="text-primary-600" />
            إضافة أصل جديد
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-200 transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Asset Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="assetName">
              اسم الأصل
            </label>
            <input
              id="assetName"
              type="text"
              name="assetName"
              value={form.assetName}
              onChange={handleChange}
              placeholder="مثال: دبابات تنظيف، شاحنة غسيل"
              required
              autoFocus
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Purchase Date */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="purchaseDate">
              تاريخ الشراء
            </label>
            <input
              id="purchaseDate"
              type="date"
              name="purchaseDate"
              value={form.purchaseDate}
              onChange={handleChange}
              required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="quantity">
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
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-slate-900 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Unit Price row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="plannedUnitPrice">
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
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-slate-900 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="actualUnitPrice">
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
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-slate-900 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Salvage + Useful Life row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="salvageValue">
                القيمة التخريدية (ر.س)
              </label>
              <input
                id="salvageValue"
                type="number"
                name="salvageValue"
                value={form.salvageValue}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="any"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-slate-900 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="usefulLife">
                العمر الإنتاجي (بالسنوات)
              </label>
              <input
                id="usefulLife"
                type="number"
                name="usefulLife"
                value={form.usefulLife}
                onChange={handleChange}
                placeholder="مثال: 5"
                required
                min="1"
                step="1"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-slate-900 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Live totals */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-sm">
            <p className="text-gray-700 leading-relaxed">
              <span className="font-semibold">الإجمالي المخطط:</span>{' '}
              <span className="font-bold text-gray-900 tabular-nums">
                {quantity > 0 && plannedUnitPrice > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(plannedUnitPrice)} = ${formatCurrency(plannedTotal)}`
                  : `${formatCurrency(0)} ر.س`}
              </span>
              <span className="text-gray-400 mx-2">|</span>
              <span className="font-semibold">الإجمالي الفعلي:</span>{' '}
              <span className="font-bold text-gray-900 tabular-nums">
                {quantity > 0 && actualUnitPrice > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(actualUnitPrice)} = ${formatCurrency(actualTotal)}`
                  : `${formatCurrency(0)} ر.س`}
              </span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="flex-1 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              {submitting ? 'جارٍ الإضافة...' : 'إضافة الأصل'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
