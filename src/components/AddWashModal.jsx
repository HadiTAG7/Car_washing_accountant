import { useEffect, useState } from 'react';
import { X, Plus, Pencil, Car } from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';
import DateField from './DateField';

function todayISO() {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

const EMPTY_TEMPLATE = {
  bikerName:  '',
  quantity:   '1',
  price:      '40',
  washDate:   '',
  // Decides the debit side of the revenue entry: cash, bank, or a
  // receivable when the sale is on credit.
  paymentMethod: 'cash',
};

const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash',     label: 'نقدي' },
  { value: 'card',     label: 'مدى / شبكة' },
  { value: 'transfer', label: 'تحويل بنكي' },
  { value: 'credit',   label: 'آجل (على الحساب)' },
];

export default function AddWashModal({
  isOpen, onClose, onAdd, onUpdate, initialValues = null,
}) {
  const editing = Boolean(initialValues?.id);
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (initialValues?.id) {
      setForm({
        bikerName: initialValues.bikerName || '',
        quantity:  String(Math.max(1, parseInt(initialValues.quantity, 10) || 1)),
        price:     initialValues.price ? String(initialValues.price) : '0',
        washDate:  initialValues.washDate || '',
        paymentMethod: initialValues.paymentMethod || 'cash',
      });
    } else {
      setForm({ ...EMPTY_TEMPLATE, washDate: todayISO() });
    }
  }, [isOpen, initialValues]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const quantity     = Math.max(1, parseInt(form.quantity, 10) || 0);
  const price        = Math.max(0, parseFloat(form.price) || 0);
  const batchRevenue = quantity * price;
  const isValid      = quantity > 0 && price > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        bikerName: form.bikerName.trim(),
        quantity,
        price,
        washDate:  form.washDate || '',
        paymentMethod: form.paymentMethod || 'cash',
      };
      if (editing && onUpdate) {
        await onUpdate(initialValues.id, payload);
      } else if (onAdd) {
        // Default new batches to 'مكتملة' so the biker-commissions rule
        // picks them up immediately. Status can be flipped from the table.
        await onAdd({ ...payload, status: 'مكتملة' });
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const HeaderIcon = editing ? Pencil : Car;

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
            {editing ? 'تعديل دفعة غسلات' : 'إضافة دفعة غسلات'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="sw-tap flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-control hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="bikerName">
              اسم البايكر المسؤول <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">(اختياري)</span>
            </label>
            <input
              id="bikerName"
              type="text"
              name="bikerName"
              value={form.bikerName}
              onChange={handleChange}
              placeholder="مثال: أحمد، أو فريق الورديّة الصباحية"
              autoFocus
              className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="quantity">
                عدد الغسلات
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
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="price">
                سعر الغسلة (ر.س)
              </label>
              <input
                id="price"
                type="number"
                name="price"
                value={form.price}
                onChange={handleChange}
                placeholder="40"
                min="0"
                step="any"
                required
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="washDate">
              تاريخ الغسلة
            </label>
            <DateField
              id="washDate"
              name="washDate"
              value={form.washDate}
              onChange={handleChange}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="washPaymentMethod">
              طريقة الدفع
            </label>
            <select
              id="washPaymentMethod"
              name="paymentMethod"
              value={form.paymentMethod}
              onChange={handleChange}
              className="w-full min-h-touch px-3 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
            >
              {PAYMENT_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              تحدّد الحساب المدين في القيد: الصندوق للنقدي، البنك للشبكة والتحويل،
              والعملاء للآجل.
            </p>
          </div>

          {/* Live batch revenue — quantity × price */}
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">إجمالي إيرادات الدفعة:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {quantity > 0 && price > 0
                  ? `${formatNumber(quantity)} × ${formatCurrency(price)} = ${formatCurrency(batchRevenue)}`
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
                : (editing ? 'حفظ التعديلات' : 'إضافة الدفعة')}
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
