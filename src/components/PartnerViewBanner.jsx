import { Eye, X } from 'lucide-react';
import { formatNumber } from '../data/initialData';
import { usePartnerView } from '../contexts/PartnerViewContext';

/**
 * Pinned top-of-screen banner that fires whenever a Pro-Rata partner
 * view is active — either because a partner is logged in, or because
 * an admin is simulating one. Mirrors DemoBanner's height + class
 * shape so the two can stack cleanly. Indigo palette keeps it visually
 * distinct from DemoBanner's amber.
 */
export default function PartnerViewBanner() {
  const {
    isPartnerView, viewedPartner, totalWorkers,
    isAdmin, actingAsPartnerId, setActingAsPartnerId,
  } = usePartnerView();

  if (!isPartnerView || !viewedPartner) return null;

  const share = totalWorkers > 0
    ? (viewedPartner.workersCount || 0) / totalWorkers * 100
    : 0;
  // toFixed(1) keeps the banner compact; formatNumber forces Latin
  // digits inside the Arabic locale (the share itself is a number, not
  // currency, so we sidestep formatCurrency here).
  const pct = formatNumber(Number(share.toFixed(1)));

  // Only simulating admins get the "إنهاء المحاكاة" exit button.
  // Real partners can't escape their own view.
  const canExit = isAdmin && actingAsPartnerId;

  return (
    <div className="bg-indigo-50 dark:bg-indigo-500/15 border-b border-indigo-200 dark:border-indigo-500/40 text-indigo-900 dark:text-indigo-200 text-xs px-6 py-2 flex items-center gap-3">
      <Eye size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 leading-relaxed">
        <strong>وضع عرض الشريك:</strong> {viewedPartner.partnerName}
        {' '}<span className="text-indigo-400 dark:text-indigo-500/70">|</span>{' '}
        النسبة الحالية: <span className="tabular-nums font-bold">{pct}%</span>
      </span>
      {canExit && (
        <button
          type="button"
          onClick={() => setActingAsPartnerId(null)}
          className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/40 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors shrink-0"
          title="رجوع إلى عرض المشرف الكامل"
        >
          <X size={11} strokeWidth={2.5} />
          إنهاء المحاكاة
        </button>
      )}
    </div>
  );
}
