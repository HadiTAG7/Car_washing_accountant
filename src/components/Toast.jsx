import { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

const TONES = {
  success: {
    icon: CheckCircle2,
    classes: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    iconClass: 'text-emerald-600',
  },
  error: {
    icon: AlertTriangle,
    classes: 'bg-red-50 border-red-200 text-red-800',
    iconClass: 'text-red-600',
  },
  info: {
    icon: CheckCircle2,
    classes: 'bg-primary-50 border-primary-200 text-primary-800',
    iconClass: 'text-primary-700',
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
        className={`pointer-events-auto inline-flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg ${variant.classes} animate-[toast-in_0.18s_ease-out]`}
        style={{ minWidth: 'min(360px, 90vw)' }}
      >
        <Icon size={18} className={variant.iconClass} />
        <span className="text-sm font-semibold flex-1 text-right">{message}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-current/70 hover:text-current p-0.5 rounded-md transition-colors"
            aria-label="إغلاق"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
