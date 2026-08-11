import { useMemo, useState } from 'react';
import {
  Landmark, Wallet, Coins, Users, TrendingUp, PiggyBank, Receipt,
  DatabaseBackup, Loader2,
} from 'lucide-react';
import { formatCurrency, formatNumber, PER_WORKER_FEE } from '../data/initialData';
import TopBar from './TopBar';
import { Card, StatCard, ProgressBar, SectionHeader, EmptyState } from './UI';
import LoadingState from './LoadingState';
import { SetupRequiredCard } from './ErrorState';
import { ColumnTrend } from './charts/TrendCharts';
import Toast from './Toast';
import { downloadFullBackup } from '../lib/backupZip';
import { usePartners } from '../hooks/usePartners';
import { usePartnerPayments } from '../hooks/usePartnerPayments';
import { useStartupCosts } from '../hooks/useStartupCosts';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

// Last N months ending at the current one, as { key:'YYYY-MM', label } —
// Arabic month names, Latin digits (matches the rest of the dashboard).
function lastMonths(n) {
  const fmt = new Intl.DateTimeFormat('ar', { month: 'short', numberingSystem: 'latn' });
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({
      key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`,
      label: fmt.format(m),
    });
  }
  return out;
}

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
  const { payments } = usePartnerPayments();
  const {
    scalingFactor, isPartnerView, viewedPartner, canMutate,
  } = usePartnerView();

  // ── Monthly receipts trend (last 6 months) ───────────────────
  // Partner view narrows to the viewer's own receipts, mirroring the
  // capital section's scoping.
  const receiptsTrend = useMemo(() => {
    const months = lastMonths(6);
    const scoped = isPartnerView && viewedPartner
      ? payments.filter((p) => p.partnerId === viewedPartner.id)
      : payments;
    const byMonth = new Map(months.map((m) => [m.key, 0]));
    scoped.forEach((p) => {
      const key = String(p.paymentDate || '').slice(0, 7);
      if (byMonth.has(key)) byMonth.set(key, byMonth.get(key) + (p.amount || 0));
    });
    const values = months.map((m) => byMonth.get(m.key));
    return { months, values, total: values.reduce((s, v) => s + v, 0) };
  }, [payments, isPartnerView, viewedPartner]);

  // ── One-click full backup (admin only) ──────────────────────
  const [backupBusy, setBackupBusy] = useState(false);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success' });
  async function handleBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      await downloadFullBackup();
      setToast({ open: true, message: '✓ تم تنزيل النسخة الاحتياطية الكاملة (ZIP يضم كل الجداول).', tone: 'success' });
    } catch (err) {
      setToast({ open: true, message: err?.message || 'تعذّر إنشاء النسخة الاحتياطية.', tone: 'error' });
    } finally {
      setBackupBusy(false);
    }
  }

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
        actions={canMutate && isFirebaseConfigured ? (
          <button
            type="button"
            onClick={handleBackup}
            disabled={backupBusy}
            title="تنزيل نسخة احتياطية كاملة لكل الجداول (ZIP)"
            className="sw-button sw-button--sm sw-button--secondary sw-tap shrink-0"
          >
            {backupBusy
              ? <Loader2 size={14} className="animate-spin" />
              : <DatabaseBackup size={14} />}
            <span className="hidden sm:inline">نسخة احتياطية</span>
          </button>
        ) : null}
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

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
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">مكتمل</p>
                </div>
              </div>
              <ProgressBar value={capital.paid} max={capital.target || 1} color="emerald" className="h-3" />
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                <span>المتبقّي: <span className="font-bold text-amber-700 dark:text-amber-400">{formatCurrency(capital.remaining)}</span></span>
                {!isPartnerView && (
                  <span>{formatNumber(capital.settledCount)} من {formatNumber(capital.partnerCount)} سدّدوا بالكامل</span>
                )}
              </div>
            </Card>

            {/* ── KPI row ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
              <StatCard
                icon={Coins}
                tone="emerald"
                label="رأس المال المُحصّل"
                value={formatCurrency(capital.paid)}
                sub={`المتبقّي ${formatCurrency(capital.remaining)}`}
              />
              <StatCard
                icon={Landmark}
                tone="primary"
                label="إجمالي صرف التأسيس"
                value={formatCurrency(spend.actual)}
                sub={`من ${formatCurrency(spend.planned)} مخطط · ${formatNumber(Number(spend.pct.toFixed(0)))}%`}
              />
              <StatCard
                icon={PiggyBank}
                tone="indigo"
                label="النقد المتبقّي بعد الصرف"
                value={formatCurrency(capitalOnHand)}
                sub="المُحصّل ناقص صرف التأسيس"
              />
              <StatCard
                icon={Receipt}
                tone="amber"
                label="بنود التأسيس المكتملة"
                value={`${formatNumber(spend.completed)} / ${formatNumber(spend.itemCount)}`}
                sub="بنود أُنجز صرفها بالكامل"
              />
            </div>

            {/* ── Monthly receipts trend ───────────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title="تحصيل رأس المال شهرياً"
                subtitle={isPartnerView ? 'سنداتك خلال آخر ٦ أشهر' : 'مجموع سندات القبض خلال آخر ٦ أشهر'}
              />
              {receiptsTrend.total === 0 ? (
                <EmptyState
                  compact
                  icon={Coins}
                  title="لا توجد سندات قبض في آخر ٦ أشهر"
                  hint="سجّل الدفعات من صفحة «مدفوعات الشركاء» وسيظهر الاتجاه الشهري هنا."
                />
              ) : (
                <ColumnTrend
                  months={receiptsTrend.months}
                  values={receiptsTrend.values}
                  formatValue={formatCurrency}
                  valueName="التحصيل"
                />
              )}
            </Card>

            {/* ── Startup spend progress ───────────────────────── */}
            <Card className="p-6">
              <SectionHeader title="تقدّم صرف التأسيس" subtitle="الفعلي مقابل المخطط" />
              <div className="flex items-center justify-between mb-2 text-sm">
                <span className="tabular-nums text-slate-700 dark:text-slate-300">
                  {formatCurrency(spend.actual)} <span className="text-slate-500 dark:text-slate-400">/</span> {formatCurrency(spend.planned)}
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
                <EmptyState
                  compact
                  icon={Users}
                  title="لا يوجد شركاء مسجّلون بعد"
                  hint="أضف الشركاء من صفحة «إدارة الشركاء» لعرض توزيع رأس المال هنا."
                />
              ) : (
                <div className="space-y-3">
                  {partnerRows.map((p) => (
                    <div key={p.id}>
                      <div className="flex items-center justify-between gap-3 mb-1 text-sm">
                        <span className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 min-w-0">
                          <Users size={13} className="text-slate-500 dark:text-slate-400 shrink-0" />
                          <span className="truncate">{p.partnerName}</span>
                          <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
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

      <Toast
        open={toast.open}
        message={toast.message}
        tone={toast.tone}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
      />
    </>
  );
}
