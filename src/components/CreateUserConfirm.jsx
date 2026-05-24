import { AlertTriangle, UserPlus, Loader2 } from 'lucide-react';

/**
 * Inline confirmation block rendered inside Add/Edit Partner modals
 * when the admin types an email that isn't yet registered in
 * auth.users. Replaces the submit/cancel button row with a two-button
 * "create the account now / cancel" affordance plus a clear warning.
 *
 * Props:
 *   email   — the email that needs provisioning (LTR display)
 *   busy    — true while the edge function is provisioning
 *   onConfirm — called when the admin accepts auto-create
 *   onCancel  — called when the admin backs out (modal returns to
 *               its normal editable state)
 */
export default function CreateUserConfirm({ email, busy, onConfirm, onCancel }) {
  return (
    <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/40 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200 text-sm leading-relaxed">
        <AlertTriangle size={18} className="shrink-0 mt-0.5" />
        <p className="font-semibold">
          ⚠️ هذا البريد غير مسجل، هل تريد إنشاء حساب تلقائي له الآن وتفعيله؟
        </p>
      </div>
      <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
        البريد: <span dir="ltr" className="font-mono font-bold">{email}</span>
        <br />
        سيقوم النظام بإنشاء كلمة مرور مؤقتة قوية وعشوائية تظهر لك فور الانتهاء
        — انسخها وسلّمها للشريك ليُغيّرها عند أول تسجيل دخول.
      </p>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="flex-1 inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-colors shadow-sm"
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              جارٍ إنشاء الحساب...
            </>
          ) : (
            <>
              <UserPlus size={16} />
              نعم، أنشئ الحساب
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2.5 border border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/25 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl text-sm font-semibold transition-colors"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
