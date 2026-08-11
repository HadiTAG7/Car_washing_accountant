import { useState } from 'react';
import { CheckCircle2, Copy, Check, AlertTriangle, Mail, KeyRound } from 'lucide-react';

/**
 * Post-create credentials panel — rendered inside the partner modals
 * after createPartnerUser succeeds. Shows the email + the temporary
 * password Supabase signUp was seeded with, plus copy buttons so the
 * admin can grab them and pass them to the partner.
 *
 * Props:
 *   email                 — the email the account was created for
 *   password              — the random temporary password (display once)
 *   emailConfirmRequired  — when true, surface a note that the
 *                           partner must click the verification email
 *                           before they can sign in
 *   onDone                — called when the admin closes the panel;
 *                           parent should close the modal + surface a
 *                           short success toast
 */
function CopyableField({ label, value, icon: Icon, monospace }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API blocked (insecure context etc.) — admin can
      // still select + copy manually from the visible field.
    }
  }
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 mb-1">
        {label}
      </label>
      <div className="flex items-stretch gap-2">
        <div className="flex-1 relative">
          {Icon && (
            <Icon
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 dark:text-emerald-400 pointer-events-none"
            />
          )}
          <input
            readOnly
            value={value}
            dir="ltr"
            onFocus={(e) => e.target.select()}
            className={`w-full pr-8 pl-3 py-2.5 rounded-control border border-emerald-200 dark:border-emerald-500/40 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm select-all ${monospace ? 'font-mono font-bold' : 'font-semibold'}`}
          />
        </div>
        {/* Success-toned action: system button geometry with the semantic
            emerald fill, since this control lives inside the success panel. */}
        <button
          type="button"
          onClick={handleCopy}
          title="نسخ"
          className="sw-button sw-button--sm shrink-0 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white"
        >
          {copied ? <><Check size={13} /> نُسخت</> : <><Copy size={13} /> نسخ</>}
        </button>
      </div>
    </div>
  );
}

export default function CreatedCredentials({
  email, password, emailConfirmRequired, onDone,
}) {
  return (
    <div
      className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-smallcard p-4 space-y-3"
      role="status"
    >
      <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-relaxed">
            ✓ تم إنشاء الحساب وربطه بالشريك تلقائياً
          </p>
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1 leading-relaxed">
            انسخ بيانات الدخول التالية وأرسلها للشريك. لن تظهر كلمة المرور
            مرة أخرى — احفظها الآن.
          </p>
        </div>
      </div>

      <CopyableField label="البريد الإلكتروني" value={email}    icon={Mail} />
      <CopyableField label="كلمة المرور المؤقتة" value={password} icon={KeyRound} monospace />

      {emailConfirmRequired && (
        <div
          className="flex items-start gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] px-3 py-2 rounded-control leading-relaxed"
          role="alert"
        >
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            <strong>تأكيد البريد مطلوب:</strong> سيستلم الشريك رسالة تفعيل من
            Firebase. لن يتمكن من تسجيل الدخول قبل النقر على رابط التفعيل.
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        className="sw-button sw-button--sm sw-button--primary w-full"
      >
        تم — إغلاق
      </button>
    </div>
  );
}
