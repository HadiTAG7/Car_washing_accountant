import { useEffect, useState } from 'react';
import {
  X, Pencil, Users, Briefcase, Wallet, Mail, CheckCircle2, Link2Off,
} from 'lucide-react';
import { formatCurrency, PER_WORKER_FEE } from '../data/initialData';
import {
  lookupUserIdByEmail, createPartnerUser, isValidEmail, isSupabaseConfigured,
} from '../lib/supabaseClient';
import CreateUserConfirm from './CreateUserConfirm';

const EMPTY = { partnerName: '', workersCount: '', paidAmount: '', email: '' };

export default function EditPartnerModal({ isOpen, partner, onClose, onSave, showToast }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  // Tri-state link control:
  //   - email blank, unlink=false → keep current link unchanged
  //   - email filled              → resolve email → set userId
  //   - unlink=true                → explicitly clear partners.user_id
  const [unlinkRequested, setUnlinkRequested] = useState(false);
  // When non-null, the modal swaps its submit row for the auto-create
  // confirmation block (Edge Function provisions the user on confirm).
  const [pendingEmail, setPendingEmail] = useState(null);
  const [creating, setCreating] = useState(false);

  // Re-init whenever the modal opens for a new partner.
  useEffect(() => {
    if (!isOpen || !partner) return;
    setForm({
      partnerName:  partner.partnerName || '',
      workersCount: String(partner.workersCount ?? ''),
      paidAmount:   partner.paidAmount ? String(partner.paidAmount) : '',
      email:        '',
    });
    setUnlinkRequested(false);
    setPendingEmail(null);
    setCreating(false);
  }, [isOpen, partner]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    // Typing an email cancels any pending unlink — the new email wins.
    if (e.target.name === 'email' && e.target.value.trim()) {
      setUnlinkRequested(false);
    }
  }

  const workersCount  = Math.max(0, parseInt(form.workersCount, 10) || 0);
  const paidAmount    = Math.max(0, parseFloat(form.paidAmount) || 0);
  const requiredTotal = workersCount * PER_WORKER_FEE;
  const remaining     = Math.max(0, requiredTotal - paidAmount);
  const settled       = workersCount > 0 && remaining === 0;
  const trimmedEmail  = form.email.trim();
  const emailOk       = trimmedEmail === '' || isValidEmail(trimmedEmail);
  const isValid       = form.partnerName.trim().length > 0 && emailOk;
  const currentlyLinked = Boolean(partner?.userId);

  // Build the update payload once a userId decision has been made and
  // ship it. Used by both the normal-submit path and the auto-create
  // path so they stay in lock-step.
  async function persistPatch(resolvedUserId) {
    const patch = {
      partnerName:  form.partnerName.trim(),
      workersCount,
      paidAmount,
    };
    if (resolvedUserId !== undefined) {
      patch.userId = resolvedUserId;
    }
    await onSave(partner.id, patch);
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting || !partner?.id || pendingEmail) return;
    setSubmitting(true);
    try {
      // Resolve which userId (if any) goes into the update payload.
      // `undefined` means "don't touch the column"; `null` means
      // "explicit unlink"; a string is a resolved UUID.
      let resolvedUserId;
      if (trimmedEmail) {
        if (!isSupabaseConfigured) {
          resolvedUserId = undefined;
        } else {
          const found = await lookupUserIdByEmail(trimmedEmail);
          if (!found) {
            // Drop into the "create the account?" sub-state instead
            // of erroring out.
            setPendingEmail(trimmedEmail);
            return;
          }
          resolvedUserId = found;
        }
      } else if (unlinkRequested) {
        resolvedUserId = null;
      }

      await persistPatch(resolvedUserId);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmCreate() {
    if (!pendingEmail) return;
    setCreating(true);
    try {
      const newUserId = await createPartnerUser(pendingEmail);
      await persistPatch(newUserId);
      showToast?.(
        '✓ تم إنشاء الحساب الموثق للبريد الإلكتروني وربطه بالشريك تلقائياً!',
        'success',
      );
    } catch (err) {
      showToast?.(err?.message || 'تعذّر إنشاء الحساب', 'error');
    } finally {
      setCreating(false);
    }
  }

  function handleCancelCreate() {
    setPendingEmail(null);
  }

  if (!isOpen || !partner) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto border border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-xl flex items-center justify-center">
              <Pencil size={18} />
            </span>
            تعديل بيانات الشريك
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
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              النسبة تُحسب تلقائياً من إجمالي عدد العمالة لكل الشركاء.
            </p>
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

          {/* Link to a Supabase user via email. The admin types the
              email; we resolve it to a UUID on submit via the
              `get_user_id_by_email` RPC and persist that UUID under
              partners.user_id. Empty + currently-linked → keep the
              existing link; empty + unlinkRequested → explicitly clear. */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="email">
              البريد الإلكتروني لحساب الشريك في سويتر
              <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500 mr-1">— اختياري</span>
            </label>

            {/* Current link status — only relevant on the Edit modal. */}
            {currentlyLinked && !unlinkRequested && (
              <div className="mb-2 flex items-center justify-between gap-2 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold px-3 py-2 rounded-lg">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 size={12} strokeWidth={2.5} />
                  هذا الشريك مرتبط حالياً بحساب Supabase
                </span>
                <button
                  type="button"
                  onClick={() => setUnlinkRequested(true)}
                  className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-500/40 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-md transition-colors"
                  title="إلغاء الربط الحالي عند الحفظ"
                >
                  <Link2Off size={11} strokeWidth={2.5} />
                  إلغاء الربط
                </button>
              </div>
            )}
            {currentlyLinked && unlinkRequested && (
              <div className="mb-2 flex items-center justify-between gap-2 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 text-[11px] font-bold px-3 py-2 rounded-lg">
                <span className="inline-flex items-center gap-1.5">
                  <Link2Off size={12} strokeWidth={2.5} />
                  سيتم إلغاء الربط عند حفظ التعديلات
                </span>
                <button
                  type="button"
                  onClick={() => setUnlinkRequested(false)}
                  className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-500/40 hover:bg-amber-100 dark:hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-md transition-colors"
                >
                  تراجع
                </button>
              </div>
            )}

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
            {currentlyLinked && !trimmedEmail && !unlinkRequested && (
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                اترك الحقل فارغاً للحفاظ على الربط الحالي.
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

          {pendingEmail ? (
            <CreateUserConfirm
              email={pendingEmail}
              busy={creating}
              onConfirm={handleConfirmCreate}
              onCancel={handleCancelCreate}
            />
          ) : (
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={!isValid || submitting}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-600 dark:hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-3 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
              >
                <Pencil size={18} />
                {submitting ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors"
              >
                إلغاء
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
