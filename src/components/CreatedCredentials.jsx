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
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80 mb-1">
        {label}
      </label>
      <div className="flex items-stretch gap-2">
        <div className="flex-1 relative">
          {Icon && (
            <Icon
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600/70 dark:text-emerald-400/70 pointer-events-none"
            />
          )}
          <input
            readOnly
            value={value}
            dir="ltr"
            onFocus={(e) => e.target.select()}
            className={`w-full pr-8 pl-3 py-2.5 border border-emerald-200 dark:border-emerald-500/40 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm rounded-lg select-all ${monospace ? 'font-mono font-bold' : 'font-semibold'}`}
          />
        </div>
        <button
          type="button"
          onClick={handleCopy}
          title="نسخ"
          className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white px-3 py-2.5 rounded-lg text-xs font-bold transition-colors shadow-sm"
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
    <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/40 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-2 text-emerald-900 dark:text-emerald-200">
        <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-relaxed">
            ✓ تم إنشاء الحساب وربطه بالشريك تلقائياً
          </p>
          <p className="text-[11px] text-emerald-700/90 dark:text-emerald-300/90 mt-1 leading-relaxed">
            انسخ بيانات الدخول التالية وأرسلها للشريك. لن تظهر كلمة المرور
            مرة أخرى — احفظها الآن.
          </p>
        </div>
      </div>

      <CopyableField label="البريد الإلكتروني" value={email}    icon={Mail} />
      <CopyableField label="كلمة المرور المؤقتة" value={password} icon={KeyRound} monospace />

      {emailConfirmRequired && (
        <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-200 text-[11px] px-3 py-2 rounded-lg leading-relaxed">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            <strong>تأكيد البريد مطلوب:</strong> سيستلم الشريك رسالة تفعيل من
            Supabase. لن يتمكن من تسجيل الدخول قبل النقر على رابط التفعيل.
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        className="w-full inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-600 dark:hover:bg-primary-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-colors shadow-sm"
      >
        تم — إغلاق
      </button>
    </div>
  );
}
