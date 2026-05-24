import { useState } from 'react';
import { LogIn, UserPlus, Loader2, Mail, ArrowRight } from 'lucide-react';
import SweaterLogo from './SweaterLogo';
import { BRAND } from '../data/initialData';
import { useAuth } from '../hooks/useAuth';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  // 'signin' | 'signup' | 'forgot' — `forgot` shows just the email
  // field + "send reset link" button; success state shows an inline
  // confirmation note.
  const [mode,     setMode]     = useState('signin');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
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
        if (!isSupabaseConfigured) {
          setError('Supabase غير مُهيّأ — لا يمكن إرسال رابط إعادة التعيين في وضع العرض التجريبي.');
          return;
        }
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          // The reset email lands the user here; UpdatePasswordScreen
          // takes over once Supabase JS exchanges the URL hash for a
          // short-lived recovery session.
          redirectTo: `${window.location.origin}/update-password`,
        });
        if (err) {
          setError(err.message || 'تعذّر إرسال رابط إعادة التعيين.');
        } else {
          setNotice(
            '✓ تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني. تفقد بريدك (وملف الرسائل غير المرغوب فيها) واتبع الرابط لإعادة ضبط كلمة المرور.',
          );
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!email || !password) return;
    setBusy(true);
    try {
      const { error: err } = mode === 'signin'
        ? await signIn(email, password)
        : await signUp(email, password);
      if (err) setError(err.message || 'تعذر إتمام الطلب');
      else if (mode === 'signup') setNotice('تم إنشاء الحساب — تحقق من بريدك لتفعيله.');
    } finally {
      setBusy(false);
    }
  }

  // ── Per-mode copy ─────────────────────────────────────────────
  const heading = mode === 'signin' ? 'تسجيل الدخول'
                : mode === 'signup' ? 'إنشاء حساب جديد'
                                    : 'استرجاع كلمة المرور';
  const subheading = mode === 'signin'
    ? 'استخدم بيانات حسابك للوصول إلى لوحة التحكم'
    : mode === 'signup'
      ? 'أدخل بيانات الاتصال لإنشاء حساب جديد'
      : 'أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة تعيين كلمة المرور';

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

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-7">
          <h2 className="text-lg font-bold text-slate-800 mb-1">{heading}</h2>
          <p className="text-xs text-slate-500 mb-6">{subheading}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
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
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 text-left"
              />
            </div>

            {/* Password — hidden in forgot-password mode */}
            {mode !== 'forgot' && (
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-600">
                    كلمة المرور
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-[11px] text-primary-700 font-semibold hover:underline"
                    >
                      نسيت كلمة المرور؟
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
                />
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-100 text-red-700 text-xs px-3 py-2 rounded-lg">
                {error}
              </div>
            )}
            {notice && (
              <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs px-3 py-2 rounded-lg leading-relaxed">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-primary-800 hover:bg-primary-900 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
            >
              {busy ? (
                <><Loader2 size={16} className="animate-spin" /> جارٍ المعالجة...</>
              ) : mode === 'signin' ? (
                <><LogIn size={16} /> تسجيل الدخول</>
              ) : mode === 'signup' ? (
                <><UserPlus size={16} /> إنشاء الحساب</>
              ) : (
                <><Mail size={16} /> إرسال رابط إعادة التعيين</>
              )}
            </button>
          </form>

          <div className="text-center mt-5 text-xs text-slate-500">
            {mode === 'forgot' ? (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="inline-flex items-center gap-1 text-primary-700 font-semibold hover:underline"
              >
                <ArrowRight size={12} />
                رجوع إلى تسجيل الدخول
              </button>
            ) : mode === 'signin' ? (
              <>
                ليس لديك حساب؟{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="text-primary-700 font-semibold hover:underline"
                >
                  إنشاء حساب
                </button>
              </>
            ) : (
              <>
                لديك حساب بالفعل؟{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="text-primary-700 font-semibold hover:underline"
                >
                  تسجيل الدخول
                </button>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-primary-300 text-[11px] mt-6">
          © {new Date().getFullYear()} {BRAND.nameEn}. جميع الحقوق محفوظة.
        </p>
      </div>
    </div>
  );
}
