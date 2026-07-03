/**
 * Shared UI primitives for the Sweater dashboard.
 *
 * Light mode is the default; every container/text/border declares a
 * `dark:` counterpart so flipping `.dark` on <html> propagates cleanly.
 */

/** Container card (page sections, modals, KPI shells). */
export function Card({ className = '', children }) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-slate-950/40 border border-slate-100 dark:border-slate-800 transition-colors duration-200 ${className}`}>
      {children}
    </div>
  );
}

/** Section header with optional action on the left (RTL: left edge). */
export function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-5">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Icon-chip tones for StatCard. Every tone pairs a light AND dark recipe —
 * pages must never hand a light-only `bg-*-50` to iconBg (it glows white
 * on the dark theme). Pass `tone="emerald"` etc.; the explicit
 * iconBg/iconColor props remain as an escape hatch and win when provided.
 */
const STAT_TONES = {
  primary: { bg: 'bg-primary-50 dark:bg-primary-500/15', color: 'text-primary-700 dark:text-primary-300' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/15', color: 'text-emerald-700 dark:text-emerald-400' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-500/15',     color: 'text-amber-700 dark:text-amber-400' },
  rose:    { bg: 'bg-rose-50 dark:bg-rose-500/15',       color: 'text-rose-700 dark:text-rose-400' },
  indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-500/15',   color: 'text-indigo-700 dark:text-indigo-400' },
  slate:   { bg: 'bg-slate-100 dark:bg-slate-800',       color: 'text-slate-700 dark:text-slate-300' },
  accent:  { bg: 'bg-accent-50 dark:bg-accent-500/15',   color: 'text-accent-600 dark:text-accent-400' },
};

/** Compact KPI card. Tighter paddings below `sm` so a 2-col phone grid
 *  keeps the table above the fold. */
export function StatCard({ icon: Icon, tone = 'primary', iconColor, iconBg, label, value, trend, trendPositive, sub, className = '' }) {
  const t = STAT_TONES[tone] || STAT_TONES.primary;
  const chipBg    = iconBg    || t.bg;
  const chipColor = iconColor || t.color;
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-3.5 sm:p-5 shadow-sm dark:shadow-slate-950/40 hover:shadow-md dark:hover:shadow-slate-950/50 transition-all duration-200 ${className}`}>
      <div className="flex items-start justify-between">
        <div className={`${chipBg} ${chipColor} w-9 h-9 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center`}>
          {Icon && <Icon size={20} strokeWidth={2.2} />}
        </div>
        {trend !== undefined && (
          <span
            className={`text-xs font-bold px-2 py-1 rounded-lg ${
              trendPositive
                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
            }`}
          >
            {trendPositive ? '▲' : '▼'} {trend}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2.5 sm:mt-4 mb-1">{label}</p>
      <p className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

/**
 * Shared empty-state block (icon disc + bold title + hint + optional CTA).
 * One recipe for every "no data yet" moment — tables and lists alike.
 */
export function EmptyState({ icon: Icon, title, hint, action, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-14'}`}>
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center mb-4">
          <Icon size={26} strokeWidth={1.8} />
        </div>
      )}
      <p className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">{title}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Status badge with colored dot. */
export function StatusBadge({ status, children }) {
  const styles = {
    critical:  'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-100 dark:border-red-500/30',
    overdue:   'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-500/30',
    'due-soon':'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-500/30',
    good:      'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/30',
    over:      'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-100 dark:border-red-500/30',
    under:     'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/30',
    on:        'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    neutral:   'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  };
  const dot = {
    critical:  'bg-red-500',
    overdue:   'bg-amber-500',
    'due-soon':'bg-amber-500',
    good:      'bg-emerald-500',
    over:      'bg-red-500',
    under:     'bg-emerald-500',
    on:        'bg-slate-400 dark:bg-slate-500',
    neutral:   'bg-slate-400 dark:bg-slate-500',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${styles[status] || styles.neutral}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot[status] || dot.neutral}`} />
      {children}
    </span>
  );
}

/** Horizontal progress bar. */
export function ProgressBar({ value, max = 100, className = '', color = 'primary' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const fills = {
    primary: 'bg-primary-500',
    emerald: 'bg-emerald-500',
    amber:   'bg-amber-500',
    red:     'bg-red-500',
    white:   'bg-white',
  };
  return (
    <div className={`w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${fills[color] || fills.primary}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Primary button. */
export function PrimaryButton({ icon: Icon, children, onClick, className = '', type = 'button', disabled = false, title }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-600 dark:hover:bg-primary-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors duration-200 shadow-sm ${className}`}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

/** Secondary (outline) button. */
export function SecondaryButton({ icon: Icon, children, onClick, className = '', type = 'button', disabled = false, title }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors duration-200 ${className}`}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}
