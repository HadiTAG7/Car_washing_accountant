import { Eye, X } from 'lucide-react';
import { usePartnerView } from '../contexts/PartnerViewContext';

/**
 * Pinned top-of-screen banner that fires whenever a Pro-Rata partner
 * view is active — either because a partner is logged in, or because
 * an admin is simulating one. Mirrors DemoBanner's height + class
 * shape so the two can stack cleanly. Indigo palette keeps it visually
 * distinct from DemoBanner's amber.
 *
 * The admin preview is read-only and clearly distinguished from a real
 * partner login. Only previewing admins get a return-to-admin button.
 */
export default function PartnerViewBanner() {
  const {
    isPartnerView, viewedPartner,
    isAdmin, actingAsPartnerId, setActingAsPartnerId,
  } = usePartnerView();

  if (!isPartnerView || !viewedPartner) return null;

  // Only simulating admins get the "إنهاء المحاكاة" exit button.
  // Real partners can't escape their own view from the UI.
  const canExit = isAdmin && actingAsPartnerId;
  // ── لماذا لا تعليمات لفكّ الارتباط ──
  // كان هنا شرحٌ يدلّ الشريك على مسح `user_id` من Firestore ليعود إلى واجهة
  // المدير. سببان لحذفه: أنه يُعلّم المستثمر كيف يقطع رابط تحديد نطاقه — وهو
  // آخر من يُشرح له ذلك — وأنه صار **خاطئاً**: الدور صار يحكم لا الرابط، فمسحُ
  // الحقل ينتج حساباً مسدوداً لا واجهة مدير. تعليماتٌ تعِد بما لا يقع أسوأ من
  // غياب التعليمات.

  return (
    <div
      role="status"
      className="bg-indigo-50 dark:bg-indigo-500/10 border-b border-indigo-100 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-xs"
    >
      <div className="px-6 py-2 flex items-center gap-3">
        <Eye size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 leading-relaxed">
          <strong>{canExit ? 'معاينة حساب الشريك:' : 'وضع عرض الشريك:'}</strong> <span translate="no">{viewedPartner.partnerName}</span>
          {canExit && <span className="block text-[11px]">للقراءة فقط؛ حساب الشريك وبياناته لا تتغير.</span>}
        </span>
        {/* Chip-density controls on purpose: the banner mirrors DemoBanner's
            height so the two stack cleanly, which a full 40px pill would
            break. Same control radius / semantic colours as the system. */}
        {canExit && (
          <button
            type="button"
            onClick={() => setActingAsPartnerId(null)}
            className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-control text-[11px] font-semibold transition-colors shrink-0"
            title="الرجوع إلى حساب الأدمن"
          >
            <X size={11} strokeWidth={2.5} />
            الرجوع إلى حساب الأدمن
          </button>
        )}
      </div>

    </div>
  );
}

