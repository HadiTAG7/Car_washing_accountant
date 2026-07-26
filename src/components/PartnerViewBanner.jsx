import { useState } from 'react';
import { Eye, X, Info, Copy, Check } from 'lucide-react';
import { formatNumber } from '../data/initialData';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useAuth } from '../hooks/useAuth';

/**
 * Pinned top-of-screen banner that fires whenever a Pro-Rata partner
 * view is active — either because a partner is logged in, or because
 * an admin is simulating one. Mirrors DemoBanner's height + class
 * shape so the two can stack cleanly. Indigo palette keeps it visually
 * distinct from DemoBanner's amber.
 *
 * Extra UX: when the *project owner's own email* is linked to a
 * partner row, they end up locked into partner view with no admin
 * dropdown to escape. We detect that case (a real partner login, not
 * an admin simulation) and surface a small "How do I get back to
 * admin view?" toggle that reveals the exact SQL to copy-paste into
 * the Supabase SQL Editor.
 */
export default function PartnerViewBanner() {
  const {
    isPartnerView, viewedPartner, totalWorkers,
    isAdmin, actingAsPartnerId, setActingAsPartnerId,
  } = usePartnerView();
  const { user } = useAuth();
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied,   setCopied]   = useState(false);

  if (!isPartnerView || !viewedPartner) return null;

  const share = totalWorkers > 0
    ? (viewedPartner.workersCount || 0) / totalWorkers * 100
    : 0;
  const pct = formatNumber(Number(share.toFixed(1)));

  // Only simulating admins get the "إنهاء المحاكاة" exit button.
  // Real partners can't escape their own view from the UI.
  const canExit = isAdmin && actingAsPartnerId;
  // A "self-view" partner is a non-admin user whose own user_id matches
  // the viewedPartner row. They're stuck unless the partner row is
  // unlinked at the DB level. The unlink SQL stub below makes that
  // surgical for the project owner.
  const isSelfPartner = !isAdmin && viewedPartner.userId === user?.id;

  const unlinkSql = user?.email
    ? `update public.partners
   set user_id = null
 where user_id = (select id from auth.users where email = '${user.email}');`
    : '';

  async function copyUnlinkSql() {
    if (!unlinkSql) return;
    try {
      await navigator.clipboard.writeText(unlinkSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* admin can still select + copy manually */ }
  }

  return (
    <div
      role="status"
      className="bg-indigo-50 dark:bg-indigo-500/10 border-b border-indigo-100 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-xs"
    >
      <div className="px-6 py-2 flex items-center gap-3">
        <Eye size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 leading-relaxed">
          <strong>وضع عرض الشريك:</strong> {viewedPartner.partnerName}
          {' '}<span className="text-indigo-300 dark:text-indigo-500/70">|</span>{' '}
          النسبة الحالية: <span className="tabular-nums font-bold">{pct}%</span>
        </span>
        {/* Chip-density controls on purpose: the banner mirrors DemoBanner's
            height so the two stack cleanly, which a full 40px pill would
            break. Same control radius / semantic colours as the system. */}
        {isSelfPartner && (
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-control text-[11px] font-semibold transition-colors shrink-0"
            title="حسابك مربوط بشريك — اضغط لمعرفة كيفية الرجوع لواجهة المدير"
          >
            <Info size={11} strokeWidth={2.5} />
            {helpOpen ? 'إخفاء' : 'الرجوع لواجهة المدير؟'}
          </button>
        )}
        {canExit && (
          <button
            type="button"
            onClick={() => setActingAsPartnerId(null)}
            className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-control text-[11px] font-semibold transition-colors shrink-0"
            title="رجوع إلى عرض المشرف الكامل"
          >
            <X size={11} strokeWidth={2.5} />
            إنهاء المحاكاة
          </button>
        )}
      </div>

      {/* Collapsible help block — only when the locked-in self-partner
          asks for it. Self-contained, doesn't push the rest of the
          dashboard down unless opened. */}
      {isSelfPartner && helpOpen && (
        <div className="px-6 pb-3 -mt-1">
          <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-500/30 rounded-smallcard p-3 text-[11px] leading-relaxed text-indigo-700 dark:text-indigo-300">
            <p className="font-bold mb-2">
              حسابك ({user?.email}) مربوط بصف الشريك &quot;{viewedPartner.partnerName}&quot;.
              للرجوع إلى واجهة المدير، شغّل هذا الـ SQL في Supabase Dashboard
              → SQL Editor:
            </p>
            <div className="relative bg-slate-900 dark:bg-slate-950 text-slate-100 rounded-control p-3 font-mono text-[11px] leading-relaxed select-all" dir="ltr">
              <pre className="whitespace-pre-wrap break-words">{unlinkSql}</pre>
              <button
                type="button"
                onClick={copyUnlinkSql}
                className="absolute top-2 left-2 inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded-control text-[10px] font-bold transition-colors"
                title="نسخ"
              >
                {copied ? <><Check size={10} /> نُسخت</> : <><Copy size={10} /> نسخ</>}
              </button>
            </div>
            <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-2 leading-relaxed">
              بعد التنفيذ، سجّل خروج وارجع ادخل بنفس الإيميل — رح تظهر لك
              قائمة &quot;محاكاة عرض شريك&quot; في الـ TopBar لمعاينة كل شريك متى ما تبي.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

