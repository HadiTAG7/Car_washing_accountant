import { useEffect, useState } from 'react';
import {
  X, KeyRound, Loader2, CheckCircle2,
} from 'lucide-react';
import { updatePassword } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebaseClient';
import { translateAuthError } from '../lib/authErrors';

/**
 * In-app password change — for any signed-in user (admin OR partner)
 * who knows their current password and wants to change it. Distinct
 * from the email-based reset flow (forgot password): no email round-
 * trip, no Supabase URL Configuration dependency, just `updateUser`
 * directly with the active session.
 *
 * The user is already authenticated (session token in localStorage),
 * which Supabase treats as sufficient proof to allow a password
 * change — we don't re-verify the current password. Spec-wise this
 * matches Supabase's own dashboard behavior.
 */
export default function ChangePasswordModal({ isOpen, onClose, userEmail }) {
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy,            setBusy]            = useState(false);
  const [error,           setError]           = useState('');
  const [success,         setSuccess]         = useState(false);

  // Reset state when the modal opens — never carry an in-flight error
  // from a previous attempt into a fresh modal.
  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess(false);
    setBusy(false);
  }, [isOpen]);

  const passwordsMatch    = password.length > 0 && password === confirmPassword;
  const passwordLongEnough = password.length >= 6;
  const isValid           = passwordsMatch && passwordLongEnough;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || busy) return;
    setError('');
    setBusy(true);
    try {
      if (!isFirebaseConfigured) {
        setError('Firebase غير مُهيّأ — لا يمكن تغيير كلمة المرور في وضع العرض التجريبي.');
        return;
      }
      if (!auth.currentUser) {
        setError('انتهت الجلسة — أعد تسجيل الدخول ثم حاول مرة أخرى.');
        return;
      }
      await updatePassword(auth.currentUser, password);
      setSuccess(true);
      // Auto-close after 2s so the user can see the green check.
      setTimeout(() => onClose(), 2000);
    } catch (err) {
      setError(translateAuthError(err, 'تعذّر تحديث كلمة المرور.'));
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 my-4 max-h-[92vh] overflow-y-auto border border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-xl flex items-center justify-center">
              <KeyRound size={18} />
            </span>
            <span className="min-w-0">
              <span className="block">تغيير كلمة المرور</span>
              {userEmail && (
                <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate" dir="ltr">
                  {userEmail}
                </span>
              )}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="p-5 sm:p-6">
            <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-200 rounded-xl p-4 text-sm flex items-start gap-2">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">✓ تم تحديث كلمة المرور بنجاح</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1 leading-relaxed">
                  استخدم كلمة المرور الجديدة في المرة القادمة عند تسجيل الدخول.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="newPassword">
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
                className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
              />
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">٦ أحرف على الأقل.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="confirmPassword">
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
                className={`w-full px-4 py-2.5 border rounded-xl text-sm text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors ${
                  confirmPassword && !passwordsMatch
                    ? 'border-red-300 dark:border-red-500/50'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              />
              {confirmPassword && !passwordsMatch && (
                <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">كلمتا المرور غير متطابقتين.</p>
              )}
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-500/15 border border-red-100 dark:border-red-500/40 text-red-700 dark:text-red-300 text-xs px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={!isValid || busy}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-600 dark:hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
              >
                {busy ? (
                  <><Loader2 size={16} className="animate-spin" /> جارٍ الحفظ...</>
                ) : (
                  <><KeyRound size={16} /> حفظ كلمة المرور الجديدة</>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors"
              >
                إلغاء
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
