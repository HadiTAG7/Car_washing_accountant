import { useEffect, useState } from 'react';
import { X, Plus, Briefcase, Users, Wallet, Mail } from 'lucide-react';
import { formatCurrency, PER_WORKER_FEE } from '../data/initialData';
import {
  lookupUserIdByEmail, isValidEmail, isSupabaseConfigured,
} from '../lib/supabaseClient';

const EMPTY = { partnerName: '', workersCount: '', paidAmount: '', email: '' };

const EMAIL_NOT_REGISTERED_MSG =
  '⚠️ البريد الإلكتروني المدخل غير مسجل في نظام الحسابات بعد، يرجى إنشاؤه في قائمة Authentication أولاً';

export default function AddPartnerModal({ isOpen, onClose, onAdd, showToast }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  // Reset whenever the modal opens, so a previously-closed form doesn't
  // pre-fill the next add.
  useEffect(() => {
    if (isOpen) setForm(EMPTY);
  }, [isOpen]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const workersCount  = Math.max(0, parseInt(form.workersCount, 10) || 0);
  const paidAmount    = Math.max(0, parseFloat(form.paidAmount) || 0);
  const requiredTotal = workersCount * PER_WORKER_FEE;
  const remaining     = Math.max(0, requiredTotal - paidAmount);
  const settled       = workersCount > 0 && remaining === 0;
  const trimmedEmail  = form.email.trim();
  const emailOk       = trimmedEmail === '' || isValidEmail(trimmedEmail);
  const isValid       = form.partnerName.trim().length > 0 && emailOk;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      // Resolve the email → UUID up-front so a "not registered" email
      // never produces a half-inserted partner row.
      let resolvedUserId = null;
      if (trimmedEmail && isSupabaseConfigured) {
        const found = await lookupUserIdByEmail(trimmedEmail);
        if (!found) {
          // Surface the warning via the parent's toast helper, keep
          // the modal open so the admin can correct the email, and
          // abort before onAdd ever fires.
          showToast?.(EMAIL_NOT_REGISTERED_MSG, 'error');
          return;
        }
        resolvedUserId = found;
      }
      await onAdd({
        partnerName: form.partnerName.trim(),
        workersCount,
        paidAmount,
        userId:      resolvedUserId,
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

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto border border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-xl flex items-center justify-center">
              <Plus size={18} />
            </span>
            إضافة شريك جديد
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="partnerName">
              اسم الشريك
            </label>
            <div className="relative">
              <Briefcase
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
              />
              <input
                id="partnerName"
                type="text"
                name="partnerName"
                value={form.partnerName}
                onChange={handleChange}
                placeholder="مثال: شركة الخدمات المحدودة"
                autoFocus
                required
                className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="workersCount">
              عدد العمالة
            </label>
            <div className="relative">
              <Users
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
              />
              <input
                id="workersCount"
                type="number"
                name="workersCount"
                value={form.workersCount}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="1"
                className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="paidAmount">
              المبلغ المدفوع (ر.س)
            </label>
            <div className="relative">
              <Wallet
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
              />
              <input
                id="paidAmount"
                type="number"
                name="paidAmount"
                value={form.paidAmount}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="any"
                className="w-full pr-9 pl-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              الرسوم المطلوبة = عدد العمالة × {formatCurrency(PER_WORKER_FEE)}. اتركها صفراً إذا لم يدفع بعد.
            </p>
          </div>

          {/* Link to a Supabase user via email — the RPC resolves the
              UUID at submit time. Mirrors the Edit modal but doesn't
              need an unlink toggle (the row is brand new). */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="email">
              البريد الإلكتروني لحساب الشريك في سويتر
              <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500 mr-1">— اختياري</span>
            </label>
            <div className="relative">
              <Mail
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
              />
              <input
                id="email"
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="example@sweater.com"
                dir="ltr"
                autoComplete="off"
                className={`w-full pr-9 pl-4 py-3 border rounded-xl text-sm text-slate-900 dark:text-white font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors ${emailOk ? 'border-slate-200 dark:border-slate-700' : 'border-red-300 dark:border-red-500/50'}`}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              اكتب البريد الإلكتروني المبرمج للحساب؛ سيقوم النظام بالربط والتحقق تلقائياً
              لتمكين العرض الموزع (Pro-Rata).
            </p>
            {!emailOk && (
              <p className="mt-1 text-[11px] text-red-600 dark:text-red-400 leading-relaxed">
                صيغة البريد الإلكتروني غير صحيحة — مثال: name@domain.com.
              </p>
            )}
          </div>

          {/* Capital & receivable summary */}
          <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="text-slate-600 dark:text-slate-400">إجمالي الرسوم المطلوبة</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatCurrency(requiredTotal)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="text-slate-600 dark:text-slate-400">المبلغ المدفوع</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatCurrency(paidAmount)}
              </span>
            </div>
            <div className={`flex items-baseline justify-between gap-3 px-4 py-3 ${
              settled
                ? 'bg-emerald-50 dark:bg-emerald-500/10'
                : remaining > 0
                  ? 'bg-amber-50 dark:bg-amber-500/10'
                  : ''
            }`}>
              <span className={`font-bold ${
                settled
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : remaining > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-slate-700 dark:text-slate-300'
              }`}>
                {settled ? 'مسدَّد بالكامل ✓' : 'المتبقي للاستكمال'}
              </span>
              <span className={`font-extrabold tabular-nums ${
                settled
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : remaining > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-slate-900 dark:text-slate-100'
              }`}>
                {formatCurrency(remaining)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-600 dark:hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-3 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              <Plus size={18} />
              {submitting ? 'جارٍ الإضافة...' : 'إضافة الشريك'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
