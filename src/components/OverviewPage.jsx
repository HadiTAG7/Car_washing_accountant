import { useMemo } from 'react';
import {
  Landmark, Wallet, Coins, Users, TrendingUp, PiggyBank, Receipt,
} from 'lucide-react';
import { formatCurrency, formatNumber, PER_WORKER_FEE } from '../data/initialData';
import TopBar from './TopBar';
import { Card, StatCard, ProgressBar, SectionHeader } from './UI';
import LoadingState from './LoadingState';
import { SetupRequiredCard } from './ErrorState';
import { usePartners } from '../hooks/usePartners';
import { useStartupCosts } from '../hooks/useStartupCosts';
import { isSupabaseConfigured, missingEnvNames } from '../lib/supabaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

/**
 * Landing overview — the "where do we stand" screen. Built for the
 * pre-launch reality of the business: the two things actually happening
 * are (1) raising partner capital and (2) spending it on startup costs.
 * Everything here reads existing hooks; no new tables.
 *
 * In partner view the money figures scale to the viewer's share, and the
 * capital section narrows to that partner's own contribution.
 */
export default function OverviewPage() {
  const { partners, loading: pLoading } = usePartners();
  const { items: startupItems, loading: sLoading } = useStartupCosts();
  const {
    scalingFactor, isPartnerView, viewedPartner,
  } = usePartnerView();

  // ── Capital raise ────────────────────────────────────────────
  const capital = useMemo(() => {
    const scoped = isPartnerView && viewedPartner
      ? partners.filter((p) => p.id === viewedPartner.id)
      : partners;
    const workers = scoped.reduce((s, p) => s + (p.workersCount || 0), 0);
    const target  = workers * PER_WORKER_FEE;
    const paid     = scoped.reduce((s, p) => s + (p.paidAmount || 0), 0);
    const remaining = Math.max(0, target - paid);
    const pct = target > 0 ? Math.min(100, (paid / target) * 100) : 0;
    const settledCount = scoped.filter(
      (p) => (p.workersCount || 0) * PER_WORKER_FEE > 0
        && (p.paidAmount || 0) >= (p.workersCount || 0) * PER_WORKER_FEE,
    ).length;
    return {
      partnerCount: scoped.length, workers, target, paid, remaining, pct, settledCount,
    };
  }, [partners, isPartnerView, viewedPartner]);

  // ── Startup spend ────────────────────────────────────────────
  const spend = useMemo(() => {
    const planned = startupItems.reduce((s, i) => s + (i.plannedAmount || 0), 0) * scalingFactor;
    const actual  = startupItems.reduce((s, i) => s + (i.actualAmount || 0), 0) * scalingFactor;
    const remaining = Math.max(0, planned - actual);
    const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;
    const completed = startupItems.filter((i) => i.status === 'completed').length;
    return { planned, actual, remaining, pct, completed, itemCount: startupItems.length };
  }, [startupItems, scalingFactor]);

  // Capital collected minus what's been spent on setup — the cash the
  // franchise still has in hand from raised capital (rough, pre-launch).
  const capitalOnHand = Math.max(0, capital.paid - spend.actual);

  const loading = pLoading || sLoading;

  // Per-partner leaderboard (admin view only — partners see just their own).
  const partnerRows = useMemo(() => {
    const scoped = isPartnerView && viewedPartner
      ? partners.filter((p) => p.id === viewedPartner.id)
      : partners;
    return scoped
      .map((p) => {
        const required = (p.workersCount || 0) * PER_WORKER_FEE;
        const paid = p.paidAmount || 0;
        const pct = required > 0 ? Math.min(100, (paid / required) * 100) : 0;
        return { ...p, required, paid, remaining: Math.max(0, required - paid), pct };
      })
      .sort((a, b) => b.paid - a.paid);
  }, [partners, isPartnerView, viewedPartner]);

  return (
    <>
      <TopBar
        title="نظرة عامة"
        subtitle="ملخص رأس المال المُجمّع وصرف التأسيس"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isSupabaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {loading && partners.length === 0 && startupItems.length === 0 ? (
          <LoadingState message="جارٍ تحميل النظرة العامة..." />
        ) : (
          <>
            {/* ── Capital raise hero ───────────────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title="جمع رأس المال"
                subtitle={isPartnerView
                  ? 'حصتك من رأس مال الامتياز'
                  : `${formatNumber(capital.partnerCount)} شريك · ${formatNumber(capital.workers)} عامل · الرسم ${formatCurrency(PER_WORKER_FEE)}/عامل`}
              />
              <div className="flex items-end justify-between gap-4 mb-3">
                <div>
                  <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatCurrency(capital.paid)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    من إجمالي <span className="font-bold tabular-nums">{formatCurrency(capital.target)}</span> مستهدف
                  </p>
                </div>
                <div className="text-left shrink-0">
                  <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {formatNumber(Number(capital.pct.toFixed(1)))}%
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">مكتمل</p>
                </div>
              </div>
              <ProgressBar value={capital.paid} max={capital.target || 1} color="emerald" className="h-3" />
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                <span>المتبقّي: <span className="font-bold text-amber-600 dark:text-amber-400">{formatCurrency(capital.remaining)}</span></span>
                {!isPartnerView && (
                  <span>{formatNumber(capital.settledCount)} من {formatNumber(capital.partnerCount)} سدّدوا بالكامل</span>
                )}
              </div>
            </Card>

            {/* ── KPI row ──────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              <StatCard
                icon={Coins}
                iconBg="bg-emerald-50 dark:bg-emerald-500/15"
                iconColor="text-emerald-600 dark:text-emerald-400"
                label="رأس المال المُحصّل"
                value={formatCurrency(capital.paid)}
                sub={`المتبقّي ${formatCurrency(capital.remaining)}`}
              />
              <StatCard
                icon={Landmark}
                iconBg="bg-primary-50 dark:bg-primary-500/15"
                iconColor="text-primary-700 dark:text-primary-400"
                label="إجمالي صرف التأسيس"
                value={formatCurrency(spend.actual)}
                sub={`من ${formatCurrency(spend.planned)} مخطط · ${formatNumber(Number(spend.pct.toFixed(0)))}%`}
              />
              <StatCard
                icon={PiggyBank}
                iconBg="bg-indigo-50 dark:bg-indigo-500/15"
                iconColor="text-indigo-600 dark:text-indigo-400"
                label="النقد المتبقّي بعد الصرف"
                value={formatCurrency(capitalOnHand)}
                sub="المُحصّل ناقص صرف التأسيس"
              />
              <StatCard
                icon={Receipt}
                iconBg="bg-amber-50 dark:bg-amber-500/15"
                iconColor="text-amber-600 dark:text-amber-400"
                label="بنود التأسيس المكتملة"
                value={`${formatNumber(spend.completed)} / ${formatNumber(spend.itemCount)}`}
                sub="بنود أُنجز صرفها بالكامل"
              />
            </div>

            {/* ── Startup spend progress ───────────────────────── */}
            <Card className="p-6">
              <SectionHeader title="تقدّم صرف التأسيس" subtitle="الفعلي مقابل المخطط" />
              <div className="flex items-center justify-between mb-2 text-sm">
                <span className="tabular-nums text-slate-700 dark:text-slate-300">
                  {formatCurrency(spend.actual)} <span className="text-slate-400">/</span> {formatCurrency(spend.planned)}
                </span>
                <span className="tabular-nums font-bold text-slate-500 dark:text-slate-400">
                  {formatNumber(Number(spend.pct.toFixed(0)))}%
                </span>
              </div>
              <ProgressBar
                value={spend.actual}
                max={spend.planned || 1}
                color={spend.pct >= 100 ? 'red' : 'primary'}
                className="h-3"
              />
            </Card>

            {/* ── Per-partner capital leaderboard ──────────────── */}
            <Card className="p-6">
              <SectionHeader
                title={isPartnerView ? 'حصتك من رأس المال' : 'رأس المال حسب الشريك'}
                subtitle={isPartnerView ? undefined : 'مرتّب حسب المُسدَّد'}
              />
              {partnerRows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
                  لا يوجد شركاء مسجّلون بعد.
                </p>
              ) : (
                <div className="space-y-3">
                  {partnerRows.map((p) => (
                    <div key={p.id}>
                      <div className="flex items-center justify-between gap-3 mb-1 text-sm">
                        <span className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 min-w-0">
                          <Users size={13} className="text-slate-400 dark:text-slate-500 shrink-0" />
                          <span className="truncate">{p.partnerName}</span>
                          <span className="text-[10px] font-normal text-slate-400 dark:text-slate-500 tabular-nums shrink-0">
                            {formatNumber(p.workersCount)} عامل
                          </span>
                        </span>
                        <span className="tabular-nums text-slate-600 dark:text-slate-400 shrink-0">
                          {formatCurrency(p.paid)} <span className="text-slate-300 dark:text-slate-600">/</span> {formatCurrency(p.required)}
                        </span>
                      </div>
                      <ProgressBar
                        value={p.paid}
                        max={p.required || 1}
                        color={p.pct >= 100 ? 'emerald' : 'primary'}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </>
  );
}
