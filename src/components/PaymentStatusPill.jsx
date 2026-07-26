/**
 * Status toggle pill (paid ↔ pending; flashes red when due today).
 * Shared by the Annual + Monthly expense pages — the two copies were
 * byte-identical before extraction (2026-06 audit cleanup).
 * FinancialDetailsModal keeps its own read-only variant (different
 * contract: no toggle, no due highlighting).
 */
export default function PaymentStatusPill({ status, dueToday, onChange, disabled }) {
  const isPaid = status === 'paid';
  const next   = isPaid ? 'pending' : 'paid';
  const dueAndPending = dueToday && !isPaid;
  // Semantic tones, each with its dark counterpart — the pill sits in a
  // table row, so an unpaired light tint would glow on the dark theme.
  let classes, dotClass;
  if (isPaid) {
    classes  = 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/20';
    dotClass = 'bg-emerald-500';
  } else if (dueAndPending) {
    classes  = 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-500/30 hover:bg-rose-100 dark:hover:bg-rose-500/20';
    dotClass = 'bg-rose-500 animate-pulse';
  } else {
    classes  = 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20';
    dotClass = 'bg-amber-500';
  }
  const title = disabled
    ? 'غير متاح في وضع عرض الشريك'
    : isPaid
      ? 'انقر للتراجع إلى قيد الانتظار'
      : (dueAndPending
          ? 'موعد الصرف اليوم — اضغط لتسجيل المدفوع'
          : 'انقر لتسجيل المصروف كمدفوع');
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(next)}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${classes} ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {isPaid ? 'مدفوع' : 'قيد الانتظار'}
    </button>
  );
}
