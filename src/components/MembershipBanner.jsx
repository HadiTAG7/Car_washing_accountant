import { ShieldAlert, RefreshCw } from 'lucide-react';

/**
 * «مسجَّل الدخول، وغير معروف للنظام» — قِيلت صراحةً.
 *
 * The rules read membership from a DOCUMENT:
 *
 *     isMember()  =  exists(users/<uid>)  ||  exists(app_admins/<uid>)
 *
 * An account created straight in the Firebase Auth console has neither, so
 * every read is refused — while the sidebar, which never consults a role,
 * renders every admin page. Each page then shows «تم رفض الطلب بواسطة قواعد
 * الأمان — تأكد من صلاحيات حسابك», which is true and useless: the account has
 * no permissions because it has no record, and no amount of checking will
 * reveal that.
 *
 * It also cannot fix itself. `users/{uid}` create requires `isAdmin()`,
 * `isAdmin()` requires one of those two documents, and `app_admins` is closed
 * to every client because privilege escalation would otherwise be one browser
 * write away. So the banner names the account, names the missing document, and
 * gives the exact command — the only step that can break the deadlock.
 */
export default function MembershipBanner({ user, onRecheck }) {
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
            لا يملك <code className="font-mono text-[12px]">users/{user?.id || '<uid>'}</code>
            {' '}ولا <code className="font-mono text-[12px]">app_admins/{user?.id || '<uid>'}</code>.
            لذلك تُرفض كل قراءة، وتظهر رسالة «لا صلاحيات» في كل صفحة — بينما
            القائمة الجانبية تعرض كل شيء لأنها لا تسأل عن الدور أصلاً.
          </p>
          <p className="text-sm text-rose-800 dark:text-rose-300 leading-relaxed mt-2">
            ولا يمكن إصلاحه من المتصفح: إنشاء <code className="font-mono text-[12px]">users</code>
            {' '}يحتاج مديراً، وكونك مديراً يحتاج أحد المستندين، و
            <code className="font-mono text-[12px]">app_admins</code> مغلق أمام كل عميل حتى لا
            يصير رفع الصلاحية كتابةً واحدة من المتصفح. فأول مدير يُهيَّأ من
            خارج التطبيق:
          </p>
          <pre
            dir="ltr"
            className="mt-3 px-4 py-3 rounded-control bg-slate-900 text-slate-100 text-[12px] font-mono overflow-x-auto"
          >
{`npm run bootstrap:admin -- ${user?.email || '<your-email>'}`}
          </pre>
          <p className="text-[12px] text-rose-700 dark:text-rose-400 leading-relaxed mt-2">
            يُشغَّل مرة واحدة باعتماد إداري (service account أو
            {' '}<code className="font-mono">gcloud auth application-default login</code>)، وهو
            آمن للتكرار. ثم اضغط «إعادة الفحص».
          </p>
          {onRecheck && (
            <button
              type="button"
              onClick={onRecheck}
              className="mt-3 inline-flex items-center gap-2 min-h-touch px-4 rounded-control bg-rose-600 text-white text-sm font-semibold"
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
