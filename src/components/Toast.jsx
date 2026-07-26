import { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

// Semantic tones only — a toast is a status message, so it never wears the
// brand orange (that stays reserved for actions). `info` therefore reads
// indigo, matching the system's informational role.
const TONES = {
  success: {
    icon: CheckCircle2,
    classes: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
  },
  error: {
    icon: AlertTriangle,
    classes: 'bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/30 text-rose-700 dark:text-rose-300',
    iconClass: 'text-rose-600 dark:text-rose-400',
  },
  info: {
    icon: CheckCircle2,
    classes: 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300',
    iconClass: 'text-indigo-600 dark:text-indigo-400',
  },
};

export default function Toast({
  open, message, tone = 'success', onClose, duration = 3000,
}) {
  useEffect(() => {
    if (!open || !duration) return undefined;
    const t = setTimeout(() => { onClose?.(); }, duration);
    return () => clearTimeout(t);
  }, [open, duration, onClose]);

  if (!open || !message) return null;

  const variant = TONES[tone] || TONES.success;
  const Icon = variant.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] pointer-events-none"
    >
      <div
        className={`pointer-events-auto inline-flex items-center gap-3 px-4 py-3 rounded-control border ${variant.classes} animate-[toast-in_0.18s_ease-out]`}
        style={{ minWidth: 'min(360px, 90vw)', boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        <Icon size={18} className={variant.iconClass} />
        <span className="text-sm font-semibold flex-1 text-right">{message}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="sw-tap inline-flex items-center justify-center shrink-0 p-1 rounded-control text-current/70 hover:text-current transition-colors"
            aria-label="إغلاق"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
