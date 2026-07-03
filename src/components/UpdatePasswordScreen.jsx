import { useEffect, useState } from 'react';
import { KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import SweaterLogo from './SweaterLogo';
import { BRAND } from '../data/initialData';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

/**
 * Landing page for the reset-password email link. The reset email
 * Supabase generates points at `${SITE_URL}/update-password`, with the
 * recovery token in the URL hash. Because the main supabase client is
 * created with `detectSessionInUrl: true`, by the time this screen
 * mounts the hash has been exchanged for a short-lived recovery
 * session, and `supabase.auth.updateUser({ password })` works without
 * any extra setup.
 *
 * If the user lands here WITHOUT a valid recovery session (typed the
 * URL by hand, expired link, etc.) we still show the form but the
 * underlying call will return a clear "Auth session missing" error,
 * which we surface verbatim.
 */
export default function UpdatePasswordScreen() {
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy,            setBusy]            = useState(false);
  const [error,           setError]           = useState('');
  const [success,         setSuccess]         = useState(false);

  // Detect whether Supabase has already exchanged the recovery hash
  // into a session by the time the screen mounts. If not after a
  // grace period, we warn the user — typing the URL by hand or an
  // expired link both land here without a recovery session and the
  // updateUser call would otherwise fail with a vague message.
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    // Initial probe.
    supabase.auth.getSession().then(({ data }) => {
      setHasRecoverySession(!!data.session);
    });
    // Also subscribe in case the hash exchange completes after mount.
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === 'PASSWORD_RECOVERY' || sess) {
        setHasRecoverySession(true);
      }
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const passwordLongEnough = password.length >= 6;
  const isValid = passwordsMatch && passwordLongEnough;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || busy) return;
    setError('');
    setBusy(true);
    try {
      if (!isSupabaseConfigured) {
        setError('Supabase غير مُهيّأ — لا يمكن تحديث كلمة المرور في وضع العرض التجريبي.');
        return;
      }
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) {
        setError(err.message || 'تعذّر تحديث كلمة المرور.');
        return;
      }
      setSuccess(true);
      // Sign the recovery session out and bounce to the login screen
      // so the user can sign in fresh with their new password. The
      // 2-second hold lets them read the success state.
      setTimeout(() => {
        supabase.auth.signOut().catch(() => { /* best-effort */ });
        window.location.replace(`${window.location.origin}/?signedOut=${Date.now()}`);
      }, 2000);
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
            أدخل كلمة المرور الجديدة لحسابك. بعد الحفظ سيتم نقلك لصفحة
            تسجيل الدخول مرة أخرى.
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

              {!hasRecoverySession && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 rounded-lg leading-relaxed">
                  لم نتمكن من العثور على جلسة استرجاع سارية. تأكد من فتح
                  الرابط من رسالة إعادة تعيين كلمة المرور؛ إذا كان الرابط
                  قديماً، اطلب رابطاً جديداً من صفحة تسجيل الدخول.
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
