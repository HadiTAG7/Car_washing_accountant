import { useEffect, useState } from 'react';
import {
  X, KeyRound, Loader2, CheckCircle2,
} from 'lucide-react';
import { updatePassword } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebaseClient';
import { translateAuthError } from '../lib/authErrors';

/**
 * In-app password change — for any signed-in user (admin OR partner) who
 * knows their current password and wants to change it. Distinct from the
 * email-based reset flow (forgot password): no email round-trip, just
 * Firebase's `updatePassword` against the active session.
 *
 * Firebase accepts a password change on a RECENT session without re-asking
 * for the old one; if the session is stale it returns
 * `auth/requires-recent-login`, which authErrors turns into an Arabic
 * "sign in again" message.
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

      <div
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-md mx-4 my-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-control flex items-center justify-center shrink-0">
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
            className="sw-tap flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-control hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="p-5 sm:p-6">
            <div
              className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 rounded-control p-4 text-sm flex items-start gap-2"
              role="status"
            >
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
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
              />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">٦ أحرف على الأقل.</p>
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

            {error && (
              <div
                className="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs px-3 py-2.5 rounded-control leading-relaxed"
                role="alert"
              >
                {error}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={!isValid || busy}
                className="sw-button sw-button--sm sw-button--primary flex-1"
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
                className="sw-button sw-button--sm sw-button--secondary"
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
