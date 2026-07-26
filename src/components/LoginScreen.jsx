import { useState } from 'react';
import { LogIn, Loader2, Mail, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { SweaterWordmark } from './SweaterLogo';
import { BRAND } from '../data/initialData';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useAuth } from '../hooks/useAuth';
import { auth, isFirebaseConfigured } from '../lib/firebaseClient';
import { translateAuthError } from '../lib/authErrors';

export default function LoginScreen() {
  const { signIn } = useAuth();
  // 'signin' | 'forgot' — `forgot` shows just the email field + "send
  // reset link" button; success state shows an inline confirmation note.
  // There is deliberately NO public signup mode: accounts are provisioned
  // from inside the app (partner linking) — an open signup form only
  // invited strangers to create accounts.
  const [mode,     setMode]     = useState('signin');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');
  const [notice,   setNotice]   = useState('');

  function switchMode(next) {
    setMode(next);
    setError('');
    setNotice('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setNotice('');

    if (mode === 'forgot') {
      if (!email) return;
      setBusy(true);
      try {
        if (!isFirebaseConfigured) {
          setError('Firebase غير مُهيّأ — لا يمكن إرسال رابط إعادة التعيين في وضع العرض التجريبي.');
          return;
        }
        // Firebase sends its own reset email + hosts the reset page. The
        // continue URL (return-to-app link) only works when this exact
        // origin is allowlisted in Firebase Auth → Settings → Authorized
        // domains. A new deployment domain isn't, and Firebase then hard-
        // fails with auth/unauthorized-continue-uri — locking the user out
        // of the ONE flow that recovers an account. So the continue URL is
        // best-effort: on that specific error we retry without it, which
        // always works (the user lands on Firebase's hosted reset page).
        const target = String(email).trim();
        try {
          await sendPasswordResetEmail(auth, target, { url: `${window.location.origin}/` });
        } catch (err) {
          if (err?.code === 'auth/unauthorized-continue-uri') {
            await sendPasswordResetEmail(auth, target);
          } else {
            throw err;
          }
        }
        setNotice(
          '✓ تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني. تفقد بريدك (وملف الرسائل غير المرغوب فيها) واتبع الرابط لإعادة ضبط كلمة المرور.',
        );
      } catch (err) {
        setError(translateAuthError(err, 'تعذّر إرسال رابط إعادة التعيين.'));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!email || !password) return;
    setBusy(true);
    try {
      const { error: err } = await signIn(email, password);
      if (err) setError(translateAuthError(err, 'تعذّر تسجيل الدخول.'));
    } finally {
      setBusy(false);
    }
  }

  // ── Per-mode copy ─────────────────────────────────────────────
  const heading = mode === 'signin' ? 'تسجيل الدخول' : 'استرجاع كلمة المرور';
  const subheading = mode === 'signin'
    ? 'استخدم بيانات حسابك للوصول إلى لوحة التحكم'
    : 'أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة تعيين كلمة المرور';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <SweaterWordmark className="h-12 w-auto mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400 text-sm">{BRAND.tagline}</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-7" style={{ borderRadius: 'var(--sw-radius-card)', boxShadow: 'var(--sw-shadow-card)' }}>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">{heading}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">{subheading}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                البريد الإلكتروني
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                dir="ltr"
                required
                autoComplete="email"
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 text-left" style={{ borderRadius: 'var(--sw-radius-control)' }}
              />
            </div>

            {/* Password — hidden in forgot-password mode */}
            {mode !== 'forgot' && (
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    كلمة المرور
                  </label>
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-[11px] text-primary-700 dark:text-primary-300 font-semibold hover:underline"
                  >
                    نسيت كلمة المرور؟
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    autoComplete="current-password"
                    className="w-full pr-4 pl-11 py-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500" style={{ borderRadius: 'var(--sw-radius-control)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    title={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    className="sw-tap absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs px-3 py-2.5 rounded-lg" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs px-3 py-2.5 rounded-lg leading-relaxed" role="status">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="sw-button sw-button--sm sw-button--primary w-full"
            >
              {busy ? (
                <><Loader2 size={16} className="animate-spin" /> جارٍ المعالجة...</>
              ) : mode === 'signin' ? (
                <><LogIn size={16} /> تسجيل الدخول</>
              ) : (
                <><Mail size={16} /> إرسال رابط إعادة التعيين</>
              )}
            </button>
          </form>

          {/* Accounts are created from inside the dashboard (partner
              linking) — no public self-signup link. */}
          {mode === 'forgot' && (
            <div className="text-center mt-5 text-xs text-slate-500 dark:text-slate-400">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="inline-flex items-center gap-1 text-primary-700 dark:text-primary-300 font-semibold hover:underline"
              >
                <ArrowRight size={12} />
                رجوع إلى تسجيل الدخول
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-slate-500 dark:text-slate-400 text-[11px] mt-6 leading-relaxed">
          © {new Date().getFullYear()} شركة هادي الغانم | Hadi Alghanim Company
          <br />
          جميع الحقوق محفوظة.
        </p>
      </div>
    </div>
  );
}
