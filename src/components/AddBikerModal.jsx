import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Pencil, Bike, Phone, MapPin, Banknote, IdCard, ShieldUser, Flag } from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import { normalizeUnitName } from '../lib/accounting/startupMigration';
import DateField from './DateField';

// One modal for add AND edit, keyed on `initialValues?.id` — the same
// combined pattern AddWashModal already uses, so the two stay one code path.
const EMPTY = {
  name:          '',
  contactNumber: '',
  residence:     '',
  sponsor:       '',
  nationality:   '',
  salary:        '',
  startDate:     '',
  iqamaNumber:   '',
  iqamaExpiry:   '',
};

/**
 * القيم المكتوبة سابقاً على حقلٍ ما — للاقتراح لا للحبس.
 *
 * One function for the sponsor AND the nationality datalists, because a
 * copied dedup is how the two drift apart. Compared normalized («مؤسسة
 * النور» and «مؤسسه النور» are one sponsor, «أفغاني» and «افغاني» one
 * nationality) but shown in the FIRST spelling as it was typed: the
 * normalizer strips the hamza and the ta-marbuta, so displaying its output
 * would suggest words nobody wrote. Normalization answers "same?", it does
 * not answer "what to show".
 */
function suggestionsFrom(bikers, pick) {
  const seen = new Set();
  const out = [];
  for (const b of bikers || []) {
    const raw = String(pick(b) || '').trim();
    if (!raw) continue;
    const key = normalizeUnitName(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out.sort((a, b) => a.localeCompare(b, 'ar'));
}

// `bikers` arrives as a PROP, not from `useBikers()` — BikersPage already
// holds the list, so a hook here would open a second read of the same
// collection and drag firebaseClient into a modal that has none.
export default function AddBikerModal({ isOpen, onClose, onAdd, onUpdate, initialValues = null, bikers = [] }) {
  const editing = Boolean(initialValues?.id);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  // useMemo, never a useEffect dep: `bikers` is a fresh array identity on
  // every render while the query loads, and an effect on it would spin.
  const sponsors = useMemo(() => suggestionsFrom(bikers, (b) => b?.sponsor), [bikers]);
  const nationalities = useMemo(() => suggestionsFrom(bikers, (b) => b?.nationality), [bikers]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialValues?.id) {
      setForm({
        name:          initialValues.name || '',
        contactNumber: initialValues.contactNumber || '',
        residence:     initialValues.residence || '',
        sponsor:       initialValues.sponsor || '',
        nationality:   initialValues.nationality || '',
        salary:        initialValues.salary ? String(initialValues.salary) : '',
        startDate:     initialValues.startDate || '',
        iqamaNumber:   initialValues.iqamaNumber || '',
        iqamaExpiry:   initialValues.iqamaExpiry || '',
      });
    } else {
      setForm(EMPTY);
    }
  }, [isOpen, initialValues]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  // Derived, not stateful — the house validation pattern. Salary may be
  // empty (unknown yet) but never negative; the name is the join key to the
  // wash log, so it is the one non-negotiable field.
  const salary  = form.salary === '' ? 0 : Math.max(0, parseFloat(form.salary) || 0);
  const isValid = form.name.trim().length > 0 && !(parseFloat(form.salary) < 0);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        name:          form.name.trim(),
        contactNumber: form.contactNumber.trim(),
        residence:     form.residence.trim(),
        sponsor:       form.sponsor.trim(),
        nationality:   form.nationality.trim(),
        salary,
        startDate:     form.startDate || '',
        iqamaNumber:   form.iqamaNumber.trim(),
        iqamaExpiry:   form.iqamaExpiry || '',
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

  if (!isOpen) return null;

  const HeaderIcon = editing ? Pencil : Bike;

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
            {editing ? 'تعديل بيانات البايكر' : 'إضافة بايكر جديد'}
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
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="bikerFormName">
              اسم البايكر
            </label>
            <div className="relative">
              <Bike size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
              <input
                id="bikerFormName"
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="مثال: أحمد محمد"
                autoFocus
                required
                className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              بنفس الاسم الذي يُكتب على الغسلات — فهو ما يربط غسلاته وعمولاته بملفه.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="bikerFormPhone">
                رقم الجوال <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">— اختياري</span>
              </label>
              <div className="relative">
                <Phone size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
                <input
                  id="bikerFormPhone"
                  type="text"
                  inputMode="tel"
                  dir="ltr"
                  name="contactNumber"
                  value={form.contactNumber}
                  onChange={handleChange}
                  placeholder="05xxxxxxxx"
                  maxLength={20}
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm text-left tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="bikerFormResidence">
                مكان السكن <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">— اختياري</span>
              </label>
              <div className="relative">
                <MapPin size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
                <input
                  id="bikerFormResidence"
                  type="text"
                  name="residence"
                  value={form.residence}
                  onChange={handleChange}
                  placeholder="مثال: حي النسيم"
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="bikerFormSponsor">
                اسم الكفيل <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">— اختياري</span>
              </label>
              <div className="relative">
                <ShieldUser size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
                <input
                  id="bikerFormSponsor"
                  type="text"
                  name="sponsor"
                  value={form.sponsor}
                  onChange={handleChange}
                  list="bikerSponsorOptions"
                  placeholder="مثال: مؤسسة النور للخدمات"
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                />
                {/* اقتراح لا حصر: اكتب كفيلاً جديداً متى شئت. */}
                <datalist id="bikerSponsorOptions">
                  {sponsors.map((name) => <option key={name} value={name} />)}
                </datalist>
              </div>
              {sponsors.length > 0 && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  الحقل يقترح الكفلاء المسجّلين على بايكرية آخرين — والكتابة الحرّة مسموحة.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="bikerFormNationality">
                الجنسية <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">— اختياري</span>
              </label>
              <div className="relative">
                <Flag size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
                <input
                  id="bikerFormNationality"
                  type="text"
                  name="nationality"
                  value={form.nationality}
                  onChange={handleChange}
                  list="bikerNationalityOptions"
                  placeholder="مثال: باكستاني"
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                />
                {/* نفس منطق الكفيل: يقترح المكتوب سابقاً ولا يمنع جديداً. */}
                <datalist id="bikerNationalityOptions">
                  {nationalities.map((name) => <option key={name} value={name} />)}
                </datalist>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="bikerFormSalary">
                الراتب الشهري (ر.س)
              </label>
              <div className="relative">
                <Banknote size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
                <input
                  id="bikerFormSalary"
                  type="number"
                  name="salary"
                  value={form.salary}
                  onChange={handleChange}
                  placeholder="0"
                  min="0"
                  step="any"
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                معلومة على الملف — الصرف الفعلي يُسجَّل من زر «صرف الراتب».
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="bikerFormStartDate">
                تاريخ بداية العمل <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">— اختياري</span>
              </label>
              <DateField
                id="bikerFormStartDate"
                name="startDate"
                value={form.startDate}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="bikerFormIqama">
                رقم الإقامة / الهوية <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">— اختياري</span>
              </label>
              <div className="relative">
                <IdCard size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
                <input
                  id="bikerFormIqama"
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  name="iqamaNumber"
                  value={form.iqamaNumber}
                  onChange={handleChange}
                  placeholder="2xxxxxxxxx"
                  maxLength={15}
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm text-left tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="bikerFormIqamaExpiry">
                انتهاء الإقامة <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">— اختياري</span>
              </label>
              <DateField
                id="bikerFormIqamaExpiry"
                name="iqamaExpiry"
                value={form.iqamaExpiry}
                onChange={handleChange}
              />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                يظهر تنبيه في الجدول قبل الانتهاء بشهرين.
              </p>
            </div>
          </div>

          {/* Live salary echo, the house preview-panel idiom */}
          {salary > 0 && (
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">الراتب الشهري:</span>
                <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(salary)}</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="sw-button sw-button--sm sw-button--primary flex-1"
            >
              {editing ? <Pencil size={18} /> : <Plus size={18} />}
              {submitting
                ? (editing ? 'جارٍ الحفظ...' : 'جارٍ الإضافة...')
                : (editing ? 'حفظ التعديلات' : 'إضافة البايكر')}
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
