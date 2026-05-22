import { useEffect, useState } from 'react';
import { X, Plus, Pencil, Car } from 'lucide-react';

const VEHICLE_TYPES = ['صغيرة', 'وسط', 'جيب', 'كبيرة'];
const SERVICE_TYPES = ['غسيل خارجي', 'غسيل كامل'];

function todayISO() {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

const EMPTY_TEMPLATE = {
  vehicleType: VEHICLE_TYPES[0],
  plateNumber: '',
  serviceType: SERVICE_TYPES[0],
  bikerName:   '',
  price:       '40',
  washDate:    '',
};

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
        vehicleType: initialValues.vehicleType || VEHICLE_TYPES[0],
        plateNumber: initialValues.plateNumber || '',
        serviceType: initialValues.serviceType || SERVICE_TYPES[0],
        bikerName:   initialValues.bikerName   || '',
        price:       initialValues.price ? String(initialValues.price) : '0',
        washDate:    initialValues.washDate    || '',
      });
    } else {
      setForm({ ...EMPTY_TEMPLATE, washDate: todayISO() });
    }
  }, [isOpen, initialValues]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const price = Math.max(0, parseFloat(form.price) || 0);
  const isValid =
    form.plateNumber.trim().length > 0 &&
    form.bikerName.trim().length   > 0 &&
    VEHICLE_TYPES.includes(form.vehicleType) &&
    SERVICE_TYPES.includes(form.serviceType) &&
    price > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        vehicleType: form.vehicleType,
        plateNumber: form.plateNumber.trim(),
        serviceType: form.serviceType,
        bikerName:   form.bikerName.trim(),
        price,
        washDate:    form.washDate || '',
      };
      if (editing && onUpdate) {
        await onUpdate(initialValues.id, payload);
      } else if (onAdd) {
        // Default new washes to 'مكتملة' so the biker-commissions rule
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span className="bg-emerald-50 text-emerald-600 w-9 h-9 rounded-xl flex items-center justify-center">
              <HeaderIcon size={18} />
            </span>
            {editing ? 'تعديل غسلة' : 'إضافة غسلة جديدة'}
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
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="plateNumber">
              رقم اللوحة
            </label>
            <input
              id="plateNumber"
              type="text"
              name="plateNumber"
              value={form.plateNumber}
              onChange={handleChange}
              placeholder="مثال: أ ب ج 1234"
              autoFocus
              required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="vehicleType">
                نوع السيارة
              </label>
              <select
                id="vehicleType"
                name="vehicleType"
                value={form.vehicleType}
                onChange={handleChange}
                required
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
              >
                {VEHICLE_TYPES.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="serviceType">
                نوع الخدمة
              </label>
              <select
                id="serviceType"
                name="serviceType"
                value={form.serviceType}
                onChange={handleChange}
                required
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
              >
                {SERVICE_TYPES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="bikerName">
              اسم البايكر المسؤول
            </label>
            <input
              id="bikerName"
              type="text"
              name="bikerName"
              value={form.bikerName}
              onChange={handleChange}
              placeholder="مثال: أحمد"
              required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="price">
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
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="washDate">
                تاريخ الغسلة
              </label>
              <input
                id="washDate"
                type="date"
                name="washDate"
                value={form.washDate}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              {editing ? <Pencil size={18} /> : <Plus size={18} />}
              {submitting
                ? (editing ? 'جارٍ الحفظ...' : 'جارٍ الإضافة...')
                : (editing ? 'حفظ التعديلات' : 'إضافة الغسلة')}
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
