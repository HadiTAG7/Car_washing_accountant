import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { usePartners } from '../hooks/usePartners';
import { usePartnerView } from '../contexts/PartnerViewContext';
import CategorySelect from './CategorySelect';

/**
 * AdminPartnerSelector — admin-only TopBar control that flips the
 * dashboard into a simulated partner view. Renders nothing for partners
 * (they can't escape their own view). Its own TopBar row works on mobile
 * as well as desktop, without changing authentication or any partner data.
 */
export default function AdminPartnerSelector() {
  const { isAdmin, role, actingAsPartnerId, setActingAsPartnerId } = usePartnerView();
  const allowed = isAdmin && role === 'admin';
  const { partners, loading, error, refetch } = usePartners({ enabled: allowed });

  // Include every recorded partner, irrespective of operating status.
  // This changes only the local preview, never the authenticated account.
  const options = useMemo(
    () => [{ id: '', label: 'عرض الأدمن' }, ...partners
      .map((p) => ({ id: p.id, label: p.partnerName }))],
    [partners],
  );

  // Partners (non-admins) don't see this control at all.
  if (!allowed) return null;

  return (
    <div
      className="px-4 sm:px-6 lg:px-8 pb-3"
    >
      <div className="max-w-xl flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
        <Eye size={15} strokeWidth={2.3} />
        حسابات الشركاء
      </span>
      <div className="flex-1 min-w-0">
        {loading ? <p role="status" className="text-xs text-slate-500">نحمّل حسابات الشركاء...</p>
          : error ? <div className="flex flex-wrap items-center gap-2 text-xs">
            <p role="alert" className="text-red-700 dark:text-red-300">تعذّر تحميل حسابات الشركاء</p>
            <button type="button" onClick={refetch} className="sw-button sw-button--sm sw-button--secondary">إعادة تحميل حسابات الشركاء</button>
          </div> :
        <CategorySelect
          categories={options}
          value={actingAsPartnerId}
          onChange={(id) => setActingAsPartnerId(id || null)}
          placeholder="اختر حساب الشريك للمعاينة"
          ariaLabel="اختر حساب الشريك للمعاينة"
        />
        }
      </div>
      </div>
    </div>
  );
}
