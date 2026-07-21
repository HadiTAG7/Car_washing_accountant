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
    <div className="min-h-screen bg-gradient-to-br from-primary-800 via-primary-900 to-primary-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-xl">
              <SweaterLogo className="w-full h-full" />
            </div>
            <div className="text-right">
              <p className="text-white text-xl font-extrabold tracking-tight">{BRAND.nameAr}</p>
              <p className="text-primary-300 text-xs">{BRAND.nameEn}</p>
            </div>
          </div>
          <p className="text-primary-200 text-sm">{BRAND.tagline}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-7">
          <h2 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
            <KeyRound size={18} className="text-primary-700" />
            تعيين كلمة مرور جديدة
          </h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            {codeEmail
              ? `أدخل كلمة المرور الجديدة للحساب ${codeEmail}. بعد الحفظ سيتم نقلك لصفحة تسجيل الدخول.`
              : 'أدخل كلمة المرور الجديدة لحسابك. بعد الحفظ سيتم نقلك لصفحة تسجيل الدخول.'}
          </p>

          {success ? (
            <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl p-4 text-sm flex items-start gap-2">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">✓ تم تحديث كلمة المرور بنجاح</p>
                <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
                  جارٍ نقلك إلى صفحة تسجيل الدخول...
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5" htmlFor="newPassword">
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
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
                />
                <p className="mt-1 text-[11px] text-slate-400">٦ أحرف على الأقل.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5" htmlFor="confirmPassword">
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
                  className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 ${
                    confirmPassword && !passwordsMatch
                      ? 'border-red-300'
                      : 'border-slate-200'
                  }`}
                />
                {confirmPassword && !passwordsMatch && (
                  <p className="mt-1 text-[11px] text-red-600">كلمتا المرور غير متطابقتين.</p>
                )}
              </div>

              {codeChecked && !hasValidCode && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 rounded-lg leading-relaxed">
                  الرابط غير صالح أو منتهي الصلاحية. اطلب رابط إعادة تعيين
                  جديداً من صفحة تسجيل الدخول («نسيت كلمة المرور؟»).
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-100 text-red-700 text-xs px-3 py-2 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!isValid || busy}
                className="w-full bg-primary-800 hover:bg-primary-900 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
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

        <p className="text-center text-primary-300 text-[11px] mt-6">
          © {new Date().getFullYear()} {BRAND.nameEn}. جميع الحقوق محفوظة.
        </p>
      </div>
    </div>
  );
}
