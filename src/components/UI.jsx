/**
 * Shared UI primitives — Sweater Design System v1.
 *
 * These are the app's only sanctioned recipes for a surface, a KPI, a
 * button, a badge, a bar and an empty state. Pages compose them instead of
 * re-declaring paddings and colours, so a token change lands everywhere.
 *
 * System notes applied here:
 *   • Radii come from the system: cards 20px (--sw-radius-card), compact
 *     cards 15px, controls 8px, buttons pill.
 *   • Orange is reserved for emphasis and actions. Surfaces stay white /
 *     #f8f9fa (light) and #292929 over #0b0b0b (dark) — never a brand wash.
 *   • Elevation on data surfaces uses the neutral card shadow; the brand
 *     shadow is for actions only, so tables don't sit in an orange glow.
 *   • Every figure carries `tabular-nums`, which the token layer routes to
 *     Inter with fixed-width digits so money columns align.
 */

/** Container card (page sections, modals, KPI shells). */
export function Card({ className = '', children, style, ...props }) {
  return (
    <div
      {...props}
      className={`bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 transition-colors duration-200 ${className}`}
      style={{ borderRadius: 'var(--sw-radius-card)', boxShadow: 'var(--sw-shadow-card)', ...style }}
    >
      {children}
    </div>
  );
}

/** Section header with optional action on the left (RTL: left edge). */
export function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-5">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Icon-chip tones for StatCard. Every tone pairs a light AND dark recipe —
 * pages must never hand a light-only `bg-*-50` to iconBg (it glows white
 * on the dark theme). Pass `tone="emerald"`; the explicit iconBg/iconColor
 * props remain an escape hatch and win when provided.
 *
 * Tones map to the system's semantic roles: primary = brand/action,
 * emerald = success, amber = warning, rose = danger, indigo = info.
 */
const STAT_TONES = {
  primary: { bg: 'bg-primary-50 dark:bg-primary-500/15', color: 'text-primary-700 dark:text-primary-300' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/15', color: 'text-emerald-700 dark:text-emerald-300' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-500/15',     color: 'text-amber-700 dark:text-amber-300' },
  rose:    { bg: 'bg-rose-50 dark:bg-rose-500/15',       color: 'text-rose-700 dark:text-rose-300' },
  indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-500/15',   color: 'text-indigo-700 dark:text-indigo-300' },
  slate:   { bg: 'bg-slate-100 dark:bg-slate-800',       color: 'text-slate-700 dark:text-slate-300' },
  accent:  { bg: 'bg-accent-50 dark:bg-accent-500/15',   color: 'text-accent-700 dark:text-accent-300' },
};

/** Compact KPI card. Tighter paddings below `sm` so a 2-col phone grid
 *  keeps the table above the fold. */
export function StatCard({ icon: Icon, tone = 'primary', iconColor, iconBg, label, value, trend, trendPositive, sub, className = '' }) {
  const t = STAT_TONES[tone] || STAT_TONES.primary;
  const chipBg    = iconBg    || t.bg;
  const chipColor = iconColor || t.color;
  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 sm:p-5 transition-all duration-200 ${className}`}
      style={{ borderRadius: 'var(--sw-radius-small-card)', boxShadow: 'var(--sw-shadow-card)' }}
    >
      <div className="flex items-start justify-between">
        <div
          className={`${chipBg} ${chipColor} w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center`}
          style={{ borderRadius: 'var(--sw-radius-control)' }}
        >
          {Icon && <Icon size={20} strokeWidth={2.2} />}
        </div>
        {trend !== undefined && (
          <span
            className={`text-xs font-bold px-2 py-1 rounded-lg tabular-nums ${
              trendPositive
                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300'
            }`}
          >
            {trendPositive ? '▲' : '▼'} {trend}
          </span>
        )}
      </div>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-3 sm:mt-4 mb-1">{label}</p>
      <p className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">{sub}</p>}
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
        <div
          className="w-14 h-14 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mb-4 border border-slate-100 dark:border-slate-700"
          style={{ borderRadius: 'var(--sw-radius-small-card)' }}
        >
          <Icon size={26} strokeWidth={1.8} />
        </div>
      )}
      <p className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">{title}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Status badge with colored dot — semantic states only. */
export function StatusBadge({ status, children }) {
  const styles = {
    critical:  'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-500/30',
    overdue:   'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30',
    'due-soon':'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30',
    good:      'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30',
    over:      'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-500/30',
    under:     'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30',
    on:        'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    neutral:   'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  };
  const dot = {
    critical:  'bg-rose-600',
    overdue:   'bg-amber-500',
    'due-soon':'bg-amber-500',
    good:      'bg-emerald-600',
    over:      'bg-rose-600',
    under:     'bg-emerald-600',
    on:        'bg-slate-400 dark:bg-slate-500',
    neutral:   'bg-slate-400 dark:bg-slate-500',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 border text-[11px] font-semibold ${styles[status] || styles.neutral}`}
      style={{ borderRadius: 'var(--sw-radius-round)' }}
    >
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
    red:     'bg-rose-500',
    white:   'bg-white',
  };
  return (
    <div className={`w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full ${fills[color] || fills.primary}`}
        style={{ width: `${pct}%`, transition: 'width var(--sw-duration-slow) var(--sw-ease-entrance)' }}
      />
    </div>
  );
}

/**
 * Primary action button — the system's pill CTA at admin density.
 * Carries the action colour and brand shadow; lifts 2px on hover exactly
 * as the published `.sw-button--primary` does.
 */
export function PrimaryButton({ icon: Icon, children, onClick, className = '', type = 'button', disabled = false, title }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`sw-button sw-button--sm sw-button--primary ${className}`}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

/** Secondary (outline) button — same pill geometry, neutral surface. */
export function SecondaryButton({ icon: Icon, children, onClick, className = '', type = 'button', disabled = false, title }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`sw-button sw-button--sm sw-button--secondary ${className}`}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}
