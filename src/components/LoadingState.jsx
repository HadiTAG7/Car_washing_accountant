import { Loader2 } from 'lucide-react';

/**
 * Inline loading indicator. Pass `rows` to render skeleton rows,
 * otherwise a centered spinner + message is shown.
 */
export default function LoadingState({ message = 'جارٍ تحميل البيانات...', rows }) {
  if (rows && rows > 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-14 bg-slate-100 dark:bg-slate-800 rounded-control animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500 dark:text-slate-400">
      <Loader2 size={28} className="animate-spin text-primary-700 dark:text-primary-400 mb-3" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}
