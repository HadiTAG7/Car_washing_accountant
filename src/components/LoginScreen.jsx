import { useState } from 'react';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';
import SweaterLogo from './SweaterLogo';
import { BRAND } from '../data/initialData';
import { useAuth } from '../hooks/useAuth';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [mode,     setMode]     = useState('signin'); // 'signin' | 'signup'
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');
  const [notice,   setNotice]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) return;
    setError('');
    setNotice('');
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
          <h2 className="text-lg font-bold text-slate-800 mb-1">
            {mode === 'signin' ? 'تسجيل الدخول' : 'إنشاء حساب جديد'}
          </h2>
          <p className="text-xs text-slate-500 mb-6">
            {mode === 'signin'
              ? 'استخدم بيانات حسابك للوصول إلى لوحة التحكم'
              : 'أدخل بيانات الاتصال لإنشاء حساب جديد'}
          </p>

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
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 text-left"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                كلمة المرور
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 text-red-700 text-xs px-3 py-2 rounded-lg">
                {error}
              </div>
            )}
            {notice && (
              <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs px-3 py-2 rounded-lg">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-primary-800 hover:bg-primary-900 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
            >
              {busy
                ? <><Loader2 size={16} className="animate-spin" /> جارٍ المعالجة...</>
                : mode === 'signin'
                  ? <><LogIn size={16} /> تسجيل الدخول</>
                  : <><UserPlus size={16} /> إنشاء الحساب</>}
            </button>
          </form>

          <div className="text-center mt-5 text-xs text-slate-500">
            {mode === 'signin' ? 'ليس لديك حساب؟ ' : 'لديك حساب بالفعل؟ '}
            <button
              type="button"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setNotice(''); }}
              className="text-primary-700 font-semibold hover:underline"
            >
              {mode === 'signin' ? 'إنشاء حساب' : 'تسجيل الدخول'}
            </button>
          </div>
        </div>

        <p className="text-center text-primary-300 text-[11px] mt-6">
          © {new Date().getFullYear()} {BRAND.nameEn}. جميع الحقوق محفوظة.
        </p>
      </div>
    </div>
  );
}
