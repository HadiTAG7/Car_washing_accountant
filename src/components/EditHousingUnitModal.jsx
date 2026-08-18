import { useEffect, useState } from 'react';
import { X, Pencil, Users, StickyNote } from 'lucide-react';
import { formatNumber } from '../data/initialData';

// مودال ميتا السكن — السعة المخطّطة والملاحظات، لا غير.
//
// The residents are NOT edited here: they live on the bikers (one source),
// and the page assigns them with its own picker. This modal touches only
// what nothing else knows about a unit.
const EMPTY = { capacity: '', notes: '' };

export default function EditHousingUnitModal({ isOpen, onClose, unit, onSave }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      // Null capacity renders as an EMPTY field, not «0»: «لم تُذكر السعة»
      // and «سعتها صفر» are different facts, and only the first is true of a
      // unit nobody has sized yet.
      capacity: unit?.capacity == null ? '' : String(unit.capacity),
      notes:    unit?.notes || '',
    });
    setSaveError('');
  }, [isOpen, unit]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const parsedCapacity = form.capacity === '' ? null : Math.trunc(Number(form.capacity));
  const isValid = parsedCapacity === null
    || (Number.isFinite(parsedCapacity) && parsedCapacity >= 1);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    setSaveError('');
    try {
      // Empty field travels as null — an explicit «not stated», never a 0
      // that would render every unit as over-capacity.
      await onSave({ capacity: parsedCapacity, notes: form.notes.trim() });
      onClose();
    } catch (err) {
      // Stay open with the values intact; closing on a refusal is how an
      // error becomes invisible.
      setSaveError(err?.message || 'تعذّر حفظ بيانات السكن.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen || !unit) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-md mx-4 my-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-control flex items-center justify-center">
              <Pencil size={18} />
            </span>
            بيانات {unit.name}
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
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="housingCapacity">
              السعة المخطّطة <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">— كم شخصاً مفروض يسكن هنا؟ اختياري</span>
            </label>
            <div className="relative">
              <Users size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
              <input
                id="housingCapacity"
                type="number"
                inputMode="numeric"
                name="capacity"
                value={form.capacity}
                onChange={handleChange}
                min="1"
                step="1"
                placeholder="مثال: 14"
                className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              اتركها فارغة إن لم تتقرّر بعد — الفراغ يعني «لم تُذكر»، لا صفراً.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="housingNotes">
              ملاحظات <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">— العنوان، رقم العقد، المؤجّر... اختياري</span>
            </label>
            <div className="relative">
              <StickyNote size={16} className="absolute right-3 top-3.5 text-slate-500 dark:text-slate-400 pointer-events-none" />
              <textarea
                id="housingNotes"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                rows={3}
                placeholder="مثال: حي الروضة، عقد رقم 4821، ينتهي 2027-01"
                className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm leading-relaxed focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
          </div>

          {parsedCapacity !== null && isValid && (
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">السعة المخطّطة:</span>
                <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatNumber(parsedCapacity)} شخصاً</span>
              </div>
            </div>
          )}

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
              disabled={!isValid || submitting}
              className="sw-button sw-button--sm sw-button--primary flex-1"
            >
              <Pencil size={18} />
              {submitting ? 'جارٍ الحفظ...' : 'حفظ'}
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
