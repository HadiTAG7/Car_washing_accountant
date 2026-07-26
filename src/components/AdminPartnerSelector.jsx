import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { usePartners } from '../hooks/usePartners';
import { usePartnerView } from '../contexts/PartnerViewContext';
import CategorySelect from './CategorySelect';

/**
 * AdminPartnerSelector — admin-only TopBar control that flips the
 * dashboard into a simulated partner view. Renders nothing for partners
 * (they can't escape their own view). Shape mirrors the rest of the
 * TopBar right-cluster controls: chip-height pill with an icon prefix.
 *
 * Sat in the TopBar's `actions` slot via each page's TopBar instantiation.
 */
export default function AdminPartnerSelector() {
  const { partners } = usePartners();
  const { isAdmin, actingAsPartnerId, setActingAsPartnerId } = usePartnerView();

  // Reshape into CategorySelect's { id, label } contract. Only partners
  // with an active status get to be simulated — there's no reason to
  // show an archived partner in the picker.
  const options = useMemo(
    () => partners
      .filter((p) => p.status === 'active')
      .map((p) => ({ id: p.id, label: p.partnerName })),
    [partners],
  );

  // Partners (non-admins) don't see this control at all.
  if (!isAdmin) return null;
  // Nothing to simulate yet.
  if (options.length === 0) return null;

  return (
    <div
      className="hidden md:flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-control pr-2 pl-1 py-1"
      title="محاكاة عرض شريك معيّن"
    >
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 pr-1">
        <Users size={13} strokeWidth={2.3} />
        محاكاة عرض شريك
      </span>
      <div className="min-w-[180px]">
        <CategorySelect
          categories={options}
          value={actingAsPartnerId}
          onChange={(id) => setActingAsPartnerId(id || null)}
          placeholder="— عرض المشرف الكامل —"
          emptyLabel="— لا يوجد شركاء —"
          ariaLabel="اختر شريكاً لمحاكاة عرضه"
        />
      </div>
    </div>
  );
}
