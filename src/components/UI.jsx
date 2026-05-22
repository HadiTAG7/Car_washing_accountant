/**
 * Shared UI primitives for the Monster Wash dashboard.
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
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Compact KPI card. */
export function StatCard({ icon: Icon, iconColor = 'text-primary-600', iconBg = 'bg-primary-50', label, value, trend, trendPositive, sub }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 shadow-sm dark:shadow-slate-950/40 hover:shadow-md dark:hover:shadow-slate-950/50 transition-all duration-200">
      <div className="flex items-start justify-between">
        <div className={`${iconBg} ${iconColor} w-11 h-11 rounded-xl flex items-center justify-center`}>
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
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 mb-1">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
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
