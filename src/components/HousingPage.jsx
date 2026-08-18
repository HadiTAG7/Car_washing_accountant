import { useCallback, useMemo, useState } from 'react';
import {
  Home, Users, Wallet, Scale, Pencil, UserPlus, X as XIcon, Inbox,
} from 'lucide-react';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState } from './UI';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import Toast from './Toast';
import EditHousingUnitModal from './EditHousingUnitModal';
import { useBikers } from '../hooks/useBikers';
import { useStartupCosts } from '../hooks/useStartupCosts';
import { useAllStartupEntries } from '../hooks/useStartupCostEntries';
import { useHousingUnits } from '../hooks/useHousingUnits';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { describeBackendError } from '../lib/firebaseClient';
import { formatCurrency, formatNumber } from '../data/initialData';
import { buildHousingRows, unhousedBikers } from '../lib/housingStats';

// ═══════════════════════════════════════════════════════════════════════════
// السكن — من يسكن أين، وكم كلّف السكن للساكن الواحد مقابل التقدير
// ═══════════════════════════════════════════════════════════════════════════
// Everything here is a JOIN over data other tabs already own: the unit list
// from the startup plan, each unit's cost from the expense ledger, the
// residents from the bikers registry (`residence`). Assigning a man to a
// unit WRITES TO HIS BIKER ROW — so this tab and the bikers tab can never
// tell two different stories about where he lives. The only thing stored
// here is what nothing else knows: planned capacity and notes per unit.
//
// ── لا scalingFactor هنا، عمداً ──
// The same argument BikersPage makes for salaries: «التكلفة للساكن» is a
// fact about a housing unit, not a share of anything. Scaling it by a
// partner's percentage would show ٩٨ for housing that cost ٣٩١ a head and
// make the whole comparison against the ٣٠٠ estimate meaningless. Partner
// view reads this page unscaled; mutations stay behind canMutate.
// ═══════════════════════════════════════════════════════════════════════════

/** لون الفارق عن التقدير: أخضر تحته، كهرمان حتى +١٠٪، وردي فوق ذلك. */
function deltaTone(pct) {
  if (pct === null) return 'text-slate-500 dark:text-slate-400';
  if (pct <= 0) return 'text-emerald-700 dark:text-emerald-400';
  if (pct <= 10) return 'text-amber-700 dark:text-amber-400';
  return 'text-rose-700 dark:text-rose-400';
}

export default function HousingPage() {
  const { bikers, loading: bikersLoading, error: bikersError, updateBiker } = useBikers();
  const { items, loading: itemsLoading, error: itemsError, refetch: refetchItems } = useStartupCosts();
  const { entries, loading: entriesLoading, error: entriesError, refetch: refetchEntries } = useAllStartupEntries();
  const { metaRows, error: metaError, upsertUnitMeta, refetch: refetchMeta } = useHousingUnits();
  const { canMutate } = usePartnerView();

  const [editingUnit, setEditingUnit] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  const loading = bikersLoading || itemsLoading || entriesLoading;
  const queryError = bikersError || itemsError || entriesError;

  // الصورة كلها مشتقة في خطوة واحدة — البنود ذات التقسيمات، بساكنيها وتكلفتها.
  const housingRows = useMemo(
    () => buildHousingRows({ items, entries, bikers, metaRows }),
    [items, entries, bikers, metaRows],
  );

  const allUnitNames = useMemo(
    () => housingRows.flatMap((r) => r.units.map((u) => u.name)),
    [housingRows],
  );

  const unhoused = useMemo(
    () => unhousedBikers(bikers, allUnitNames),
    [bikers, allUnitNames],
  );

  const kpis = useMemo(() => {
    const units = housingRows.flatMap((r) => r.units);
    const residents = units.reduce((s, u) => s + u.residents.length, 0);
    const capacity = units.reduce((s, u) => s + (u.capacity ?? 0), 0);
    const cost = units.reduce((s, u) => s + u.cost, 0)
      + housingRows.reduce((s, r) => s + r.unassignedCost, 0);
    const per = residents > 0
      ? units.reduce((s, u) => s + u.cost, 0) / residents
      : null;
    // التقدير المعروض إجمالاً هو تقدير أول بندٍ له تقسيمات — عملياً بند واحد.
    const benchmark = housingRows[0]?.benchmark ?? null;
    return { unitCount: units.length, residents, capacity, cost, per, benchmark };
  }, [housingRows]);

  async function guarded(label, fn) {
    try {
      setMutationError(null);
      await fn();
      showToast(label);
      return true;
    } catch (e) {
      console.error('🔥 Firestore Error (HousingPage):', e);
      setMutationError(e);
      showToast(describeBackendError(e) || e?.message || 'تعذّر تنفيذ العملية', 'error');
      return false;
    }
  }

  // الإسكان كتابةٌ على صف البايكر نفسه — المصدر الواحد الذي يقرأه التابان.
  const houseBiker = (bikerId, unitName) => guarded(
    `أُسكن في «${unitName}»`,
    () => updateBiker(bikerId, { residence: unitName }),
  );

  const unhouseBiker = (biker) => guarded(
    `أُخرج ${biker.name} من سكنه — صار «بلا سكن مرتبط»`,
    () => updateBiker(biker.id, { residence: '' }),
  );

  const saveUnitMeta = async (patch) => {
    const ok = await guarded('حُفظت بيانات السكن', () => upsertUnitMeta(editingUnit.name, patch));
    if (!ok) throw new Error('save-failed'); // المودال يبقى مفتوحاً عند الفشل
  };

  const refetchAll = () => { refetchItems(); refetchEntries(); refetchMeta(); };

  /** منتقي إسكانٍ يُقرأ كزرّ: يعود فارغاً بعد كل اختيار، كمنتقي التعيين الجماعي. */
  function AssignSelect({ unitName, exclude }) {
    const excludeIds = new Set(exclude.map((b) => b.id));
    const candidates = bikers.filter((b) => !excludeIds.has(b.id));
    if (!candidates.length) return null;
    return (
      <select
        value=""
        onChange={(e) => e.target.value && houseBiker(e.target.value, unitName)}
        aria-label={`أسكِن بايكراً في ${unitName}`}
        className="text-[11px] px-2 py-1.5 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 focus:outline-none focus:border-primary-500 transition-colors max-w-[11rem]"
      >
        <option value="">+ أسكِن بايكراً…</option>
        {candidates.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}{b.residence ? ` — ${b.residence}` : ''}
          </option>
        ))}
      </select>
    );
  }

  return (
    <>
      <TopBar
        title="السكن"
        subtitle="من يسكن أين، وكم كلّف تجهيز كل سكن للساكن الواحد مقابل التقدير"
      />
      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {mutationError && (
          <ErrorState title="تعذّر تنفيذ العملية" error={mutationError} onRetry={() => setMutationError(null)} />
        )}
        {queryError && (
          <ErrorState title="تعذّر تحميل بيانات السكن" error={queryError} onRetry={refetchAll} />
        )}
        {/* ميتا السكنات لها خانتها: فشلُها لا يمنع عرض بقية الصفحة —
            الأسماء والتكاليف تأتي من مجموعات أخرى مسموحة أصلاً. */}
        {metaError && !queryError && (
          <ErrorState
            title="تعذّر تحميل سعات السكنات وملاحظاتها"
            error={metaError}
            onRetry={refetchMeta}
          />
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
          <StatCard
            icon={Home}
            tone="primary"
            label="عدد السكنات"
            value={formatNumber(kpis.unitCount)}
            sub="التقسيمات المعرَّفة على بنود التجهيز"
          />
          <StatCard
            icon={Users}
            tone="indigo"
            label="الساكنون المرتبطون"
            value={kpis.capacity > 0
              ? `${formatNumber(kpis.residents)} / ${formatNumber(kpis.capacity)}`
              : formatNumber(kpis.residents)}
            sub={kpis.capacity > 0 ? 'من السعة المخطّطة' : 'من سجل البايكر'}
          />
          <StatCard
            icon={Wallet}
            tone="emerald"
            label="تكلفة التجهيز"
            value={formatCurrency(kpis.cost)}
            sub="كل مصاريف بنود السكن حتى اليوم"
          />
          <StatCard
            icon={Scale}
            tone={kpis.per !== null && kpis.benchmark && kpis.per > kpis.benchmark ? 'amber' : 'emerald'}
            label="التكلفة للساكن"
            value={kpis.per === null ? '—' : formatCurrency(kpis.per)}
            sub={kpis.benchmark
              ? `التقدير: ${formatCurrency(kpis.benchmark)} للساكن`
              : 'اربط الساكنين ليُحسب'}
          />
        </div>

        {loading && housingRows.length === 0 ? (
          <Card className="p-6"><LoadingState message="جارٍ تحميل بيانات السكن..." /></Card>
        ) : housingRows.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              icon={Inbox}
              title="لا سكنات معرَّفة بعد"
              hint="أضِف التقسيمات على بند تجهيز السكن (رسوم التأسيس ← تعديل البند) وستظهر هنا ببطاقاتها."
            />
          </Card>
        ) : housingRows.map((row) => (
          <Card key={row.itemId} className="p-6">
            <SectionHeader
              title={row.itemName}
              subtitle={row.benchmark
                ? `التقدير: ${formatCurrency(row.benchmark)} للساكن الواحد`
                : undefined}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {row.units.map((u) => {
                const over = u.capacity !== null && u.residents.length > u.capacity;
                return (
                  <div
                    key={u.key}
                    className="border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 space-y-3 bg-white dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          <Home size={15} className="text-primary-600 dark:text-primary-400 shrink-0" />
                          <span className="truncate">{u.name}</span>
                        </p>
                        <p className={`mt-0.5 text-[12px] tabular-nums ${over ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                          {formatNumber(u.residents.length)}
                          {u.capacity !== null && <> / {formatNumber(u.capacity)}</>}
                          {' '}ساكناً{over && ' — فوق السعة'}
                        </p>
                      </div>
                      {canMutate && (
                        <button
                          type="button"
                          onClick={() => setEditingUnit(u)}
                          title="السعة والملاحظات"
                          aria-label={`تعديل بيانات ${u.name}`}
                          className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/15 transition-colors shrink-0"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>

                    {/* الساكنون — شارات من سجل البايكر، والإخراج كتابةٌ عليه */}
                    <div className="flex flex-wrap gap-1.5">
                      {u.residents.length === 0 && (
                        <span className="text-[12px] text-slate-500 dark:text-slate-400">
                          لا ساكن مرتبطاً بعد — أسكِن من القائمة أدناه.
                        </span>
                      )}
                      {u.residents.map((b) => (
                        <span
                          key={b.id}
                          className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-control bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        >
                          {b.name}
                          {canMutate && (
                            <button
                              type="button"
                              onClick={() => unhouseBiker(b)}
                              title={`إخراج ${b.name} من ${u.name}`}
                              aria-label={`إخراج ${b.name} من ${u.name}`}
                              className="sw-tap text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                            >
                              <XIcon size={12} />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>

                    {canMutate && (
                      <AssignSelect unitName={u.name} exclude={u.residents} />
                    )}

                    <div className="grid grid-cols-2 gap-3 text-sm border-t border-slate-100 dark:border-slate-800 pt-3">
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">تكلفة التجهيز ({formatNumber(u.entryCount)} فاتورة)</p>
                        <p className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(u.cost)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">للساكن الواحد</p>
                        <p className={`font-bold tabular-nums ${deltaTone(u.vsBenchmarkPct)}`}>
                          {u.perResident === null ? '—' : formatCurrency(u.perResident)}
                          {u.vsBenchmarkPct !== null && (
                            <span className="mr-1 text-[11px] font-semibold">
                              ({u.vsBenchmarkPct > 0 ? '+' : ''}{u.vsBenchmarkPct.toFixed(0)}%)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {u.notes && (
                      <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-2 whitespace-pre-wrap">
                        {u.notes}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {row.unassignedCost > 0 && (
              <p className="mt-4 text-[12px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-control px-3 py-2.5 leading-relaxed">
                {formatNumber(row.unassignedCount)} مصروفاً بمجموع{' '}
                <strong className="tabular-nums">{formatCurrency(row.unassignedCost)}</strong>{' '}
                بلا تقسيم — وزّعها من سجل مصاريف البند في تاب رسوم التأسيس.
              </p>
            )}
          </Card>
        ))}

        {/* من لا سكن معروفاً له — بنصّه الخام، فلا يختفي «حي النسيم» القديم */}
        {unhoused.length > 0 && housingRows.length > 0 && (
          <Card className="p-6">
            <SectionHeader
              title="بلا سكن مرتبط"
              subtitle="بايكرية حقل سكنهم فارغ أو لا يطابق أي سكن معرَّف"
            />
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {unhoused.map(({ biker, residenceText }) => (
                <li key={biker.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{biker.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {residenceText ? `مكتوب حالياً: ${residenceText}` : 'لم يُذكر سكن'}
                    </p>
                  </div>
                  {canMutate && (
                    <select
                      value=""
                      onChange={(e) => e.target.value && houseBiker(biker.id, e.target.value)}
                      aria-label={`أسكِن ${biker.name}`}
                      className="shrink-0 text-[11px] px-2 py-1.5 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 focus:outline-none focus:border-primary-500 transition-colors max-w-[10rem]"
                    >
                      <option value="">أسكِنه في…</option>
                      {allUnitNames.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </main>

      <EditHousingUnitModal
        isOpen={Boolean(editingUnit)}
        onClose={() => setEditingUnit(null)}
        unit={editingUnit}
        onSave={saveUnitMeta}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        tone={toast.tone}
        duration={toast.duration}
        onClose={closeToast}
      />
    </>
  );
}
