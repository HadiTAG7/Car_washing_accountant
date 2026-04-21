import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Error banner with an optional retry action.
 * Pass the raw Supabase error as `error` — we'll unwrap its message.
 */
export default function ErrorState({ error, onRetry, title = 'تعذّر تحميل البيانات' }) {
  const message = error?.message || error?.details || 'حدث خطأ غير متوقع أثناء الاتصال بقاعدة البيانات';

  return (
    <div className="bg-red-50 border border-red-100 rounded-2xl p-5 flex items-start gap-4">
      <div className="bg-red-100 text-red-600 w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
        <AlertTriangle size={20} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-red-900">{title}</p>
        <p className="text-xs text-red-700 mt-1 leading-relaxed">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            type="button"
            className="mt-3 inline-flex items-center gap-2 bg-white border border-red-200 hover:bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
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
 * Small banner shown when the Supabase env vars are missing — the app
 * continues to work with seed data but warns the user that writes won't
 * persist.
 */
export function DemoBanner() {
  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs px-6 py-2 flex items-center gap-2">
      <AlertTriangle size={14} className="shrink-0" />
      <span>
        <strong>وضع العرض التجريبي:</strong> لم يتم ضبط متغيرات Supabase — البيانات المعروضة تجريبية ولن يتم حفظ التعديلات.
      </span>
    </div>
  );
}
