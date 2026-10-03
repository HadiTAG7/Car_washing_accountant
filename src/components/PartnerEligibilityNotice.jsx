import { Users } from 'lucide-react';

// Receives only the scoped server allowlist, never another partner's settings.
export default function PartnerEligibilityNotice({ eligibility, periodKey }) {
  if (!eligibility?.suspendedWorkers) return null;
  return <section aria-label="أهلية بايكرزك" className="p-4 rounded-card border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200">
    <h2 className="font-bold flex items-center gap-2"><Users size={18} /> بايكرزك اللي ينحسبون في التشغيل — {periodKey}</h2>
    <div className="grid grid-cols-3 gap-3 mt-3 text-sm"><p>العدد الأصلي<strong className="block text-xl mt-1">{eligibility.originalWorkers}</strong></p><p>المؤهل للتشغيل<strong className="block text-xl mt-1">{eligibility.eligibleWorkers}</strong></p><p>موقوف مؤقتاً<strong className="block text-xl mt-1">{eligibility.suspendedWorkers}</strong></p></div>
    <p className="text-xs leading-6 mt-3">إيراداتك ومصاريفك التشغيلية محسوبة على العدد المؤهل لهالشهر. العدد الأصلي ورأس مالك ورسوم تأسيسك ما تغيّرت. الإدارة هي اللي تقدر ترجع التفعيل.</p>
  </section>;
}
