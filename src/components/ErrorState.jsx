import { AlertTriangle, RefreshCw, Settings2 } from 'lucide-react';
import { describeSupabaseError, maskedSupabaseUrl } from '../lib/supabaseClient';

/**
 * Error banner with an optional retry action.
 * Pass the raw Supabase error as `error` — we'll unwrap and localize it.
 */
export default function ErrorState({ error, onRetry, title = 'تعذّر تحميل البيانات' }) {
  const friendly = describeSupabaseError(error);
  const message  = friendly || 'حدث خطأ غير متوقع أثناء الاتصال بقاعدة البيانات';
  const url      = maskedSupabaseUrl();

  return (
    <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/30 rounded-2xl p-5 flex items-start gap-4">
      <div className="bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
        <AlertTriangle size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-red-900 dark:text-red-200">{title}</p>
        <p className="text-xs text-red-700 dark:text-red-300 mt-1 leading-relaxed">{message}</p>
        {url && (
          <p className="text-[11px] text-red-500 dark:text-red-400 mt-2 font-mono break-all" dir="ltr">
            URL: {url}
          </p>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            type="button"
            className="mt-3 inline-flex items-center gap-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-500/40 hover:bg-red-50 dark:hover:bg-red-500/20 text-red-700 dark:text-red-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
          >
            <RefreshCw size={13} />
            إعادة المحاولة
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Small top-of-screen banner shown when Supabase env vars are missing.
 */
export function DemoBanner({ missing = [] }) {
  const detail = missing.length
    ? `المتغيرات المفقودة: ${missing.join('، ')}`
    : 'لم يتم ضبط متغيرات Supabase';
  return (
    <div className="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-300 text-xs px-6 py-2 flex items-center gap-2">
      <AlertTriangle size={14} className="shrink-0" />
      <span>
        <strong>وضع العرض التجريبي:</strong> {detail} — البيانات لن تُحفظ.
      </span>
    </div>
  );
}

/**
 * Prominent setup card shown inside the page when Supabase isn't configured.
 */
export function SetupRequiredCard({ missing = [] }) {
  const list = missing.length ? missing : ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  return (
    <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-500/40 rounded-2xl p-6 shadow-sm transition-colors duration-200">
      <div className="flex items-start gap-4">
        <div className="bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 w-12 h-12 rounded-2xl flex items-center justify-center shrink-0">
          <Settings2 size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">إعداد Supabase مطلوب</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
            لا يمكن للتطبيق الاتصال بقاعدة البيانات لأن متغيرات البيئة التالية غير مضبوطة:
          </p>

          <ul className="mt-3 space-y-1.5" dir="ltr">
            {list.map((name) => (
              <li
                key={name}
                className="inline-flex items-center gap-2 bg-slate-900 dark:bg-slate-950 text-amber-300 text-[12px] font-mono px-2.5 py-1 rounded-lg mr-2"
              >
                {name}
              </li>
            ))}
          </ul>

          <div className="mt-4 text-xs text-slate-600 dark:text-slate-400 leading-relaxed space-y-2">
            <p>
              <strong className="text-slate-800 dark:text-slate-200">للتطوير المحلي:</strong> أنشئ ملف{' '}
              <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px] text-slate-700 dark:text-slate-300" dir="ltr">.env.local</code>
              {' '}في جذر المشروع وأضف القيمتين، ثم أعد تشغيل{' '}
              <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px] text-slate-700 dark:text-slate-300" dir="ltr">npm run dev</code>.
            </p>
            <p>
              <strong className="text-slate-800 dark:text-slate-200">للنشر على Vercel:</strong> أضفهما في{' '}
              Project Settings → Environment Variables، ثم أعد النشر.
            </p>
            <p className="text-slate-500 dark:text-slate-500">
              تجد القيم في لوحة Supabase ضمن Project Settings → API. تأكد من نسخها بدون مسافات أو علامات اقتباس.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
