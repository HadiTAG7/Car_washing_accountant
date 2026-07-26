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
    <div
      className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-smallcard p-4 space-y-3"
      role="alert"
    >
      <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300 text-sm leading-relaxed">
        <AlertTriangle size={18} className="shrink-0 mt-0.5" />
        <p className="font-semibold">
          ⚠️ هذا البريد غير مسجل، هل تريد إنشاء حساب تلقائي له الآن وتفعيله؟
        </p>
      </div>
      <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
        البريد: <span dir="ltr" className="font-mono font-bold">{email}</span>
        <br />
        سيقوم النظام بإنشاء كلمة مرور مؤقتة قوية وعشوائية تظهر لك فور الانتهاء
        — انسخها وسلّمها للشريك ليُغيّرها عند أول تسجيل دخول.
      </p>
      <div className="flex items-center gap-2 pt-1">
        {/* Warning-toned action: system button geometry with a semantic
            amber fill — the same pattern the destructive button uses. */}
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="sw-button sw-button--sm flex-1 bg-amber-700 hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-700 text-white"
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
          className="sw-button sw-button--sm sw-button--secondary"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
