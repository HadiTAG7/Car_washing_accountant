import { useEffect, useState } from 'react';
import {
  X, Plus, Wallet, Calendar, Landmark, Coins, CreditCard, FileText,
} from 'lucide-react';
import { formatCurrency, todayISO } from '../data/initialData';

const METHOD_OPTIONS = [
  { id: 'bank_transfer', label: 'تحويل بنكي', icon: Landmark    },
  { id: 'cash',          label: 'نقدي',       icon: Coins       },
  { id: 'mada_pos',      label: 'مدى / شبكة', icon: CreditCard  },
];

const EMPTY = {
  amount:         '',
  paymentDate:    '',
  paymentMethod:  'bank_transfer',
  notes:          '',
};

export default function AddPartnerPaymentModal({
  isOpen, onClose, onAdd, partnerId, partnerName = '',
}) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  // Reset every time the modal re-opens, and seed today's date.
  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...EMPTY, paymentDate: todayISO() });
  }, [isOpen]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }
  function selectMethod(method) {
    setForm((prev) => ({ ...prev, paymentMethod: method }));
  }

  const amount  = Math.max(0, parseFloat(form.amount) || 0);
  const isValid = Boolean(partnerId) && amount > 0 && Boolean(form.paymentDate);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      await onAdd({
        partnerId,
        amount,
        paymentDate:    form.paymentDate,
        paymentMethod:  form.paymentMethod,
        notes:          form.notes.trim(),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-control flex items-center justify-center shrink-0">
              <Wallet size={18} />
            </span>
            <span className="min-w-0">
              <span className="block">إضافة دفعة جديدة</span>
              {partnerName && (
                <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                  للشريك: {partnerName}
                </span>
              )}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="sw-tap flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-control hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="amount">
                المبلغ المدفوع (ر.س)
              </label>
              <div className="relative">
                <Wallet
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
                />
                <input
                  id="amount"
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  placeholder="0"
                  min="0"
                  step="any"
                  required
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="paymentDate">
                تاريخ الدفعة
              </label>
              <div className="relative">
                <Calendar
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
                />
                <input
                  id="paymentDate"
                  type="date"
                  name="paymentDate"
                  value={form.paymentDate}
                  onChange={handleChange}
                  required
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Method pill selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              طريقة الدفع
            </label>
            <div className="grid grid-cols-3 gap-2">
              {METHOD_OPTIONS.map(({ id, label, icon: Icon }) => {
                const active = form.paymentMethod === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectMethod(id)}
                    aria-pressed={active}
                    className={`sw-tap flex items-center justify-center gap-1.5 px-3 py-3 rounded-control border text-sm font-semibold transition-colors ${
                      active
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <Icon size={15} strokeWidth={2.2} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="notes">
              البيان / الملاحظات
              <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mr-1">— اختياري</span>
            </label>
            <div className="relative">
              <FileText
                size={16}
                className="absolute right-3 top-3 text-slate-500 dark:text-slate-400 pointer-events-none"
              />
              <textarea
                id="notes"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="رقم الإيصال، رقم الحوالة، أو أي ملاحظة"
                rows={3}
                className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors resize-y leading-relaxed"
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">قيمة هذه الدفعة:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatCurrency(amount)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="sw-button sw-button--sm sw-button--primary flex-1"
            >
              <Plus size={18} />
              {submitting ? 'جارٍ التسجيل...' : 'تسجيل الدفعة'}
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
