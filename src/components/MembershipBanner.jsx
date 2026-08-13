import { useState } from 'react';
import { ShieldAlert, RefreshCw, KeyRound, Loader2, Copy, Check } from 'lucide-react';
import { describeBackendError } from '../lib/firebaseClient';

/**
 * «مسجَّل الدخول، وغير معروف للنظام» — قِيلت صراحةً، ومعها طريق الخروج.
 *
 * The rules read membership from a DOCUMENT:
 *
 *     isMember()  =  exists(users/<uid>)  ||  exists(app_admins/<uid>)
 *
 * An account created straight in the Firebase Auth console has neither, so
 * every read is refused — while the sidebar, which never consults a role,
 * renders every admin page. Each page then shows «تم رفض الطلب بواسطة قواعد
 * الأمان — تأكد من صلاحيات حسابك», which is true and useless: the account has
 * no permissions because it has no record, and no amount of checking reveals
 * that.
 *
 * Three ways out, in order of how little they ask of the person reading:
 *
 *   1. **The button** — only when the installation is still UNCLAIMED (no
 *      users, no admins at all). One click, server-side, transactional.
 *   2. **The console recipe** — one document, typed by hand, no tooling at
 *      all. Works even when the functions have never been deployed.
 *   3. **The script** — `npm run bootstrap:admin`, for anyone who has a
 *      service-account key and would rather not click anything.
 */
export default function MembershipBanner({ user, membership, onRecheck }) {
  const [copied, setCopied] = useState('');
  const uid = user?.id || '<uid>';
  const email = user?.email || '<your-email>';

  const copy = (key, text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => {});
  };

  return (
    <div
      role="alert"
      className="mx-4 sm:mx-6 lg:mx-8 mt-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-card p-5"
    >
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-9 h-9 rounded-control bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 flex items-center justify-center">
          <ShieldAlert size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-rose-900 dark:text-rose-200">
            حسابك مسجَّل الدخول لكنه غير مُسجَّل في النظام
          </h3>
          <p className="text-sm text-rose-800 dark:text-rose-300 leading-relaxed mt-1.5">
            الدخول شيء والعضوية شيء آخر: القواعد تقرأ الصلاحية من مستند، وحسابك
            لا يملك <code className="font-mono text-[12px]">users/{uid}</code>
            {' '}ولا <code className="font-mono text-[12px]">app_admins/{uid}</code>.
            لذلك تُرفض كل قراءة، وتظهر رسالة «لا صلاحيات» في كل صفحة — بينما
            القائمة الجانبية تعرض كل شيء لأنها لا تسأل عن الدور أصلاً.
          </p>

          {/* ── ١) الزر، حين يكون النظام بلا مالك بعد ───────────────── */}
          {membership?.unclaimed && (
            <div className="mt-4 p-4 rounded-control bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-500/30">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                لا يوجد أي مستخدم مسجَّل في هذا النظام بعد
              </p>
              <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                فلك أن تطالب بدور المدير الآن. تُنفَّذ على الخادم في معاملة
                واحدة، ولا تعمل إلا ما دام السجل فارغاً تماماً — وبعدها يُغلق
                هذا الباب نهائياً.
              </p>
              <button
                type="button"
                onClick={() => membership.claimFirstAdmin()}
                disabled={membership.claiming}
                className="mt-3 inline-flex items-center gap-2 min-h-touch px-4 rounded-control bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60"
              >
                {membership.claiming
                  ? <Loader2 size={15} className="animate-spin" />
                  : <KeyRound size={15} />}
                {membership.claiming ? 'جارٍ التهيئة...' : 'اجعلني المدير'}
              </button>
              {membership.claimError && (
                <p role="alert" className="text-[12px] text-rose-700 dark:text-rose-400 mt-2">
                  {describeBackendError(membership.claimError)}
                </p>
              )}
            </div>
          )}

          {/* ── ٢) بلا أدوات إطلاقاً ────────────────────────────────── */}
          <details className="mt-4 group" open={!membership?.unclaimed}>
            <summary className="text-sm font-semibold text-rose-900 dark:text-rose-200 cursor-pointer select-none">
              أو أنشئ المستند يدوياً من Firebase Console (دقيقة، بلا أدوات)
            </summary>
            <ol className="mt-2 space-y-1.5 text-[13px] text-rose-800 dark:text-rose-300 leading-relaxed list-decimal pr-5">
              <li>Firebase Console ← <strong>Firestore Database</strong></li>
              <li>
                أنشئ مجموعة اسمها <code className="font-mono">users</code>
              </li>
              <li>
                معرّف المستند (Document ID) = معرّفك أدناه
                <span className="inline-flex items-center gap-2 mt-1 w-full">
                  <code dir="ltr" className="font-mono text-[12px] px-2 py-1 rounded bg-slate-900 text-slate-100 overflow-x-auto">{uid}</code>
                  <button type="button" onClick={() => copy('uid', uid)}
                    className="shrink-0 p-1.5 rounded text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20">
                    {copied === 'uid' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </span>
              </li>
              <li>
                حقلان نصّيان: <code className="font-mono">role</code> =
                {' '}<code className="font-mono">admin</code> و
                {' '}<code className="font-mono">email</code> = <span dir="ltr">{email}</span>
              </li>
              <li>احفظ، ثم اضغط «إعادة الفحص» أدناه.</li>
            </ol>
          </details>

          {/* ── ٣) بسكربت، لمن عنده مفتاح خدمة ─────────────────────── */}
          <details className="mt-3">
            <summary className="text-sm font-semibold text-rose-900 dark:text-rose-200 cursor-pointer select-none">
              أو بسكربت، إن كان لديك مفتاح خدمة
            </summary>
            <pre
              dir="ltr"
              className="mt-2 px-4 py-3 rounded-control bg-slate-900 text-slate-100 text-[12px] font-mono overflow-x-auto"
            >
{`npm run bootstrap:admin -- ${email}`}
            </pre>
          </details>

          {onRecheck && (
            <button
              type="button"
              onClick={onRecheck}
              className="mt-4 inline-flex items-center gap-2 min-h-touch px-4 rounded-control bg-rose-600 text-white text-sm font-semibold"
            >
              <RefreshCw size={15} />
              إعادة الفحص
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
