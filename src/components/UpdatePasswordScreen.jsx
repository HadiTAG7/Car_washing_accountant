import { useEffect, useState } from 'react';
import { KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import SweaterLogo from './SweaterLogo';
import { BRAND } from '../data/initialData';
import { auth, isFirebaseConfigured } from '../lib/firebaseClient';
import { translateAuthError } from '../lib/authErrors';

/**
 * Firebase password-reset action handler. Firebase's reset email links to
 * this route with an `oobCode` query param (when the project's action URL
 * is pointed at the app; the hosted default page also works). On mount we
 * verify the code to recover the account email; on submit we confirm the
 * new password with that code.
 *
 * Reached without a valid code (typed URL, expired link) → we show a
 * clear "request a new link" note instead of a broken form.
 */
export default function UpdatePasswordScreen() {
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy,            setBusy]            = useState(false);
  const [error,           setError]           = useState('');
  const [success,         setSuccess]         = useState(false);
  const [codeEmail,       setCodeEmail]       = useState(null); // verified account email
  const [codeChecked,     setCodeChecked]     = useState(false);

  const oobCode = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('oobCode')
    : null;

  useEffect(() => {
    if (!isFirebaseConfigured || !oobCode) { setCodeChecked(true); return; }
    verifyPasswordResetCode(auth, oobCode)
      .then((email) => setCodeEmail(email))
      .catch(() => setCodeEmail(null))
      .finally(() => setCodeChecked(true));
  }, [oobCode]);

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const passwordLongEnough = password.length >= 6;
  const hasValidCode = Boolean(oobCode && codeEmail);
  const isValid = passwordsMatch && passwordLongEnough && hasValidCode;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || busy) return;
    setError('');
    setBusy(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setSuccess(true);
      setTimeout(() => {
        window.location.replace(`${window.location.origin}/?signedOut=${Date.now()}`);
      }, 2000);
    } catch (err) {
      setError(translateAuthError(err, 'تعذّر تحديث كلمة المرور.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-smallcard overflow-hidden">
              <SweaterLogo className="w-full h-full" />
            </div>
            <div className="text-right">
              <p className="text-slate-900 dark:text-slate-100 text-xl font-extrabold tracking-tight">{BRAND.nameAr}</p>
              <p className="text-slate-500 dark:text-slate-400 text-xs">{BRAND.nameEn}</p>
            </div>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm">{BRAND.tagline}</p>
        </div>

        <div
          className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-card p-7"
          style={{ boxShadow: 'var(--sw-shadow-card)' }}
        >
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
            <KeyRound size={18} className="text-primary-700 dark:text-primary-300" />
            تعيين كلمة مرور جديدة
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
            {codeEmail
              ? `أدخل كلمة المرور الجديدة للحساب ${codeEmail}. بعد الحفظ سيتم نقلك لصفحة تسجيل الدخول.`
              : 'أدخل كلمة المرور الجديدة لحسابك. بعد الحفظ سيتم نقلك لصفحة تسجيل الدخول.'}
          </p>

          {success ? (
            <div
              className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 rounded-control p-4 text-sm flex items-start gap-2"
              role="status"
            >
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">✓ تم تحديث كلمة المرور بنجاح</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1 leading-relaxed">
                  جارٍ نقلك إلى صفحة تسجيل الدخول...
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="newPassword">
                  كلمة المرور الجديدة
                </label>
                <input
                  id="newPassword"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoFocus
                  autoComplete="new-password"
                  className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                />
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">٦ أحرف على الأقل.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="confirmPassword">
                  تأكيد كلمة المرور
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className={`w-full px-4 py-3 rounded-control border bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors ${
                    confirmPassword && !passwordsMatch
                      ? 'border-rose-300 dark:border-rose-500/50'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                />
                {confirmPassword && !passwordsMatch && (
                  <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">كلمتا المرور غير متطابقتين.</p>
                )}
              </div>

              {codeChecked && !hasValidCode && (
                <div
                  className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-3 py-2.5 rounded-control leading-relaxed"
                  role="alert"
                >
                  الرابط غير صالح أو منتهي الصلاحية. اطلب رابط إعادة تعيين
                  جديداً من صفحة تسجيل الدخول («نسيت كلمة المرور؟»).
                </div>
              )}

              {error && (
                <div
                  className="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs px-3 py-2.5 rounded-control leading-relaxed"
                  role="alert"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!isValid || busy}
                className="sw-button sw-button--sm sw-button--primary w-full"
              >
                {busy ? (
                  <><Loader2 size={16} className="animate-spin" /> جارٍ الحفظ...</>
                ) : (
                  <><KeyRound size={16} /> حفظ كلمة المرور الجديدة</>
                )}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-slate-500 dark:text-slate-400 text-[11px] mt-6 leading-relaxed">
          © {new Date().getFullYear()} {BRAND.nameEn}. جميع الحقوق محفوظة.
        </p>
      </div>
    </div>
  );
}
