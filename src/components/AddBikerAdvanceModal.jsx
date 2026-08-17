import { useEffect, useState } from 'react';
import { X, HandCoins } from 'lucide-react';
import { formatCurrency, todayISO } from '../data/initialData';
import DateField from './DateField';

// A biker advance IS a temporary expense — account 1300, the same issue and
// recovery entries the المصروفات المؤقتة page has always posted. This modal
// only adds what a general outlay never had: who took it (biker_id) and which
// money account paid it (payment_method — the posting adapter always read it,
// but no form wrote it until now).
const METHODS = [
  { value: 'cash', label: 'نقدي (الصندوق)' },
  { value: 'bank', label: 'تحويل بنكي' },
];

export default function AddBikerAdvanceModal({ isOpen, onClose, biker, onAdd }) {
  const [form, setForm] = useState({ amount: '', spentDate: '', paymentMethod: 'cash', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm({ amount: '', spentDate: todayISO(), paymentMethod: 'cash', notes: '' });
  }, [isOpen]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const amount  = Math.max(0, parseFloat(form.amount) || 0);
  const isValid = amount > 0 && Boolean(form.spentDate) && Boolean(biker?.id);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      await onAdd({
        title:         `سلفة — ${biker.name}`,
        amount,
        spentDate:     form.spentDate,
        status:        'pending',
        recoveredDate: null,
        notes:         form.notes.trim(),
        bikerId:       biker.id,
        paymentMethod: form.paymentMethod,
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
            <span className="bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 w-9 h-9 rounded-control flex items-center justify-center">
              <HandCoins size={18} />
            </span>
            سلفة جديدة — {biker?.name || ''}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="advanceAmount">
                مبلغ السلفة (ر.س)
              </label>
              <input
                id="advanceAmount"
                type="number"
                name="amount"
                value={form.amount}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="any"
                required
                autoFocus
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="advanceDate">
                تاريخ الصرف
              </label>
              <DateField
                id="advanceDate"
                name="spentDate"
                value={form.spentDate}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="advanceMethod">
              طريقة الصرف
            </label>
            <select
              id="advanceMethod"
              name="paymentMethod"
              value={form.paymentMethod}
              onChange={handleChange}
              className="w-full px-3 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              تُقيَّد عهدةً على حساب 1300 وتُخصم من الراتب عند صرفه — أو تُسترد يدوياً
              من صفحة المصروفات المؤقتة.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="advanceNotes">
              ملاحظة <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">— اختياري</span>
            </label>
            <input
              id="advanceNotes"
              type="text"
              name="notes"
              value={form.notes}
              onChange={handleChange}
              placeholder="مثال: سلفة طارئة، تُخصم من راتب الشهر القادم"
              className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>

          {amount > 0 && (
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-smallcard p-4 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-amber-800 dark:text-amber-300">سيصير مستحقاً على {biker?.name}:</span>
                <span className="font-bold text-amber-900 dark:text-amber-200 tabular-nums">{formatCurrency(amount)}</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="sw-button sw-button--sm sw-button--primary flex-1"
            >
              <HandCoins size={18} />
              {submitting ? 'جارٍ التسجيل...' : 'تسجيل السلفة'}
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
