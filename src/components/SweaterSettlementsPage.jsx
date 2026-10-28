import { useCallback, useMemo, useState } from 'react';
import {
  Handshake, Calculator, FileText, CheckCircle2, Landmark, Lock, AlertTriangle,
  Inbox, Filter, TrendingUp, Star, Timer, Ban,
} from 'lucide-react';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState } from './UI';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import Toast from './Toast';
import SweaterActionDialog from './SweaterActionDialog';
import SettlementInvoicePanel from './SettlementInvoicePanel';
import OperationsReadinessBanner from './OperationsReadinessBanner';
import {
  useSweaterSettlements, useSweaterBookings, useSweaterAdjustments, useSweaterVariances,
  useSweaterMetrics, useSweaterFirstPeriod,
} from '../hooks/useSweater';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { describeBackendError } from '../lib/firebaseClient';
import { formatCurrency, formatNumber } from '../data/initialData';
import {
  operationalKpis, reconciliationRows, filterBookings, filterOptions,
} from '../lib/sweater/dashboard';
import {
  SETTLEMENT_STATUS_AR, BOOKING_STATUS_AR, ADJUSTMENT_KIND_AR,
  ADJUSTMENT_APPROVAL_AR, REVIEW_REASON_AR, labelOf,
} from '../lib/sweater/labels';
import { settlementApprovalReadiness } from '../../functions/src/sweater/settlementReadiness.js';
import { SWEATER_METRICS } from '../../functions/src/sweater/metricsContract.js';
import { reviewGroups, dataPeriods, registeredMetric, METRIC_ADJUSTMENT_KEYS } from '../lib/sweater/settlementDisplay';

// ═══════════════════════════════════════════════════════════════════════════
// تسويات سويتر — المطابقة الرباعية، والمراجعة، والاعتماد الشهري الواحد
// ═══════════════════════════════════════════════════════════════════════════
// كل رقمٍ هنا مشتقٌّ من الخادم لا محسوبٌ في الشاشة: `figures` تأتي من
// `sweaterCalculateSettlement`، فالمعروض هو **نفس ما سيُرحَّل** بالضبط. شاشةٌ
// تحسب بنفسها تعرض رقماً قد يخالف ما يُثبت في الدفاتر، والفرق لا يُكتشف إلا
// بعد الاعتماد.
//
// ولا `scalingFactor` هنا: مستحق سويتر ذمّةٌ على المنصة، لا حصة شريك.
// ═══════════════════════════════════════════════════════════════════════════

const MONEY = (v) => (v == null ? '—' : formatCurrency(v));

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** الحالة كشارة — اللون يقول أين نحن من الرحلة بلا قراءة. */
function StatusChip({ status, reviewCount = 0 }) {
  const tone = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    calculated: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
    statement_received: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
    under_review: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    disputed: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    approved: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    invoiced: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    partially_collected: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    collected: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    closed: 'bg-slate-800 text-slate-100 dark:bg-slate-700',
  }[status] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`px-2.5 py-1 rounded-control text-[11px] font-bold whitespace-nowrap ${tone}`}>
      {labelOf(SETTLEMENT_STATUS_AR, status)}
      {reviewCount > 0 && ` · ${formatNumber(reviewCount)} تحتاج مراجعة`}
    </span>
  );
}

export default function SweaterSettlementsPage() {
  const [periodKey, setPeriodKey] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('period');
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(requested || '') ? requested : currentPeriod();
  });
  const [filters, setFilters] = useState({ driver: '', region: '', serviceType: '' });
  const [busy, setBusy] = useState(null);
  // نوافذ داخلية بدل `prompt` — الأخيرة محجوبةٌ في المتصفح الآلي، ولا تتحقق
  // من رقمٍ ولا تاريخ. `dialog` اسمُ النافذة المفتوحة، أو `null`.
  const [dialog, setDialog] = useState(null);
  const [dialogError, setDialogError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });
  const [newKeySecret] = useState(null);

  const { canMutate } = usePartnerView();
  const settlementsApi = useSweaterSettlements();
  const { settlements, loading: sLoading, error: sError } = settlementsApi;
  const { bookings, loading: bLoading, error: bError, refetch: refetchBookings } = useSweaterBookings(periodKey);
  const adjustmentsApi = useSweaterAdjustments(periodKey);
  const variancesApi = useSweaterVariances(periodKey);
  const metricsApi = useSweaterMetrics(periodKey);
  const firstPeriodApi = useSweaterFirstPeriod();

  const settlement = useMemo(
    () => settlements.find((s) => s.periodKey === periodKey) ?? null,
    [settlements, periodKey],
  );

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  /** كل فعلٍ خادميّ يمرّ من هنا — فرفضه يُعرض ولا يُبتلع. */
  const guarded = useCallback(async (name, fn) => {
    setBusy(name);
    setActionError(null);
    try {
      const r = await fn();
      showToast('تمّ');
      return r;
    } catch (e) {
      console.error('🔥 Sweater:', e);
      setActionError(describeBackendError(e) || e?.message || 'تعذّر تنفيذ العملية');
      showToast(describeBackendError(e) || e?.message || 'تعذّر تنفيذ العملية', 'error');
      return null;
    } finally {
      setBusy(null);
    }
  }, [showToast]);

  const visible = useMemo(() => filterBookings(bookings, {
    driver: filters.driver || null,
    region: filters.region || null,
    serviceType: filters.serviceType || null,
  }), [bookings, filters]);

  const options = useMemo(() => filterOptions(bookings), [bookings]);
  const kpis = useMemo(
    () => operationalKpis(visible, { adjustments: adjustmentsApi.adjustments }),
    [visible, adjustmentsApi.adjustments],
  );
  const recon = useMemo(() => reconciliationRows(settlement), [settlement]);

  const figures = settlement?.figures ?? null;
  const unresolved = variancesApi.variances.filter((v) => v.resolution === 'unresolved');
  const loading = sLoading || bLoading;
  const queryError = sError || bError;
  const approval = settlementApprovalReadiness({ settlement, variances: variancesApi.variances, bookings,
    readsPending: loading || variancesApi.loading || adjustmentsApi.loading,
    readError: Boolean(queryError || variancesApi.error || adjustmentsApi.error) });
  const groups = reviewGroups(figures);
  const allKpis = useMemo(() => operationalKpis(bookings), [bookings]);

  const periods = useMemo(() => {
    return dataPeriods(firstPeriodApi.firstPeriod, settlements.map(s => s.periodKey), currentPeriod());
  }, [settlements, firstPeriodApi.firstPeriod]);

  return (
    <>
      <TopBar title="تسويات سويتر" subtitle="المطابقة الشهرية بين خدمات المنصة وكشفها وفاتورتها وتحصيلها" />

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        {queryError && <ErrorState error={queryError} />}
        {actionError && (
          <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-control px-3 py-2.5 text-[12px] text-rose-700 dark:text-rose-300 font-medium leading-relaxed">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1 break-words">{actionError}</span>
          </div>
        )}
        {newKeySecret && null}

        {/* ── الفترة والحالة ── */}
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="sweaterPeriod">
              الشهر
            </label>
            <select
              id="sweaterPeriod"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              className="px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500"
            >
              {periods.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <StatusChip status={settlement?.status ?? 'draft'} reviewCount={approval.reviewCount} />
            {settlement?.journalEntryNumber && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                قيد رقم {settlement.journalEntryNumber}
              </span>
            )}
            {settlement?.invoiceNumber && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                فاتورة {settlement.invoiceNumber}
              </span>
            )}
          </div>
          {firstPeriodApi.error && <p role="alert" className="mt-2 text-xs">تعذرت قراءة أول شهر للبيانات؛ قائمة الأشهر قد تكون غير مكتملة.</p>}
          <p className="mt-3 text-sm leading-relaxed" aria-label="أعداد الشهر">
            حجوزات سويتر المستوردة: {bLoading || bError ? 'غير متاح' : formatNumber(bookings.length)} · المكتملة بالحالة المسجلة: {bLoading || bError ? 'غير متاح' : formatNumber(allKpis.completed.value)} · المؤهلة للإيراد حسب آخر احتساب: {figures ? formatNumber(figures.counts.eligible) : 'لم يُحتسب'} · عدد سويتر من اللقطة: {metricsApi.loading ? 'جارٍ القراءة' : metricsApi.error ? 'تعذرت قراءة اللقطة' : metricsApi.snapshot?.metrics?.completedWashes == null ? 'ما وصلت بيانات سويتر' : formatNumber(metricsApi.snapshot.metrics.completedWashes)}
          </p>
          {settlement?.calculatedAtIso && <p className="mt-1 text-xs text-slate-500">آخر احتساب محفوظ: {new Date(settlement.calculatedAtIso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })} · الأعداد الحالية قد تكون أحدث منه.</p>}
          {metricsApi.snapshot?.metricSources?.completedWashes && <p className="mt-1 text-xs text-slate-500">وقت قراءة عدد سويتر: {new Date(metricsApi.snapshot.metricSources.completedWashes.extractedAtIso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })} · لقطة شهرية، وليست حجوزات مستوردة أو إيرادًا مرحلًا.</p>}
        </Card>

        <OperationsReadinessBanner periodKey={periodKey}/>
        {loading && !settlement ? (
          <Card className="p-6"><LoadingState message="جارٍ تحميل التسوية..." /></Card>
        ) : (
          <>
            {/* ── الأرقام المالية ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
              <StatCard
                icon={Handshake} tone="primary" label="خدمات مؤهّلة"
                value={formatNumber(figures?.counts?.eligible ?? 0)}
                sub={figures ? `من ${formatNumber(figures.counts.imported)} حجزًا وقت آخر احتساب محفوظ، لا العدد الحالي` : 'احتسب الشهر أولاً'}
              />
              <StatCard
                icon={TrendingUp} tone="emerald" label="الإيراد قبل الضريبة"
                value={MONEY(figures?.services?.net)}
                sub={figures ? `الضريبة ${MONEY(figures.services.vat)} · الإجمالي ${MONEY(figures.services.gross)}` : 'احتسب الشهر أولاً'}
              />
              <StatCard
                icon={Ban} tone="amber" label="خصومات معتمدة"
                value={MONEY(figures?.deductions)}
                sub={figures?.pendingAdjustments
                  ? `و${formatNumber(figures.pendingAdjustments)} بانتظار المراجعة — لا تُحتسب`
                  : 'حوافز وتعويضات: ' + MONEY((figures?.incentives ?? 0) + (figures?.compensations ?? 0))}
              />
              <StatCard
                icon={Landmark} tone="indigo" label="صافي المستحق"
                value={MONEY(figures?.netDue)}
                sub={settlement?.collectedTotal ? `المُحصَّل ${MONEY(settlement.collectedTotal)}` : 'قبل التحصيل'}
              />
            </div>

            {/* ── المطابقة الرباعية ── */}
            <Card className="p-4 sm:p-6">
              <SectionHeader
                title="المطابقة"
                subtitle="المتوقع مقابل كشف سويتر والفاتورة والتحصيل — وكل فرقٍ يُسجَّل بسببه"
              />
              <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 mt-4">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                      <th className="py-3 px-4">البند</th>
                      <th className="py-3 px-4 text-left tabular-nums">المبلغ</th>
                      <th className="py-3 px-4 text-left tabular-nums">الفرق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recon.map((r) => (
                      <tr key={r.label} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                        <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">{r.label}</td>
                        <td className="py-3 px-4 text-left tabular-nums font-semibold">
                          {r.value == null
                            ? <span className="text-slate-400">{r.expected ? 'احتسب الشهر أولاً' : 'لم يصل بعد'}</span>
                            : MONEY(r.value)}
                        </td>
                        <td className={`py-3 px-4 text-left tabular-nums font-semibold ${
                          r.difference == null ? 'text-slate-400'
                            : r.matches ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'}`}
                        >
                          {r.difference == null ? (r.expected ? 'قيمة مرجعية' : 'بانتظار اكتمال البيانات')
                            : r.difference === 0 ? '✓ مطابق'
                              : `${r.difference > 0 ? '+' : ''}${formatCurrency(r.difference)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {unresolved.length > 0 && (
                <p className="mt-4 text-[12px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-control px-3 py-2.5 leading-relaxed">
                  {formatNumber(unresolved.length)} فرقٌ غير محلول — لا تُقفل التسوية إلا بقرار المدير مع سبب مكتوب.
                </p>
              )}
            </Card>

            {/* ── الأفعال ── */}
            {canMutate && (
              <Card className="p-4 sm:p-5">
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => guarded('calc', async () => {
                      await settlementsApi.calculate(periodKey);
                      await refetchBookings();
                    })}
                    className="sw-button sw-button--sm sw-button--secondary"
                  >
                    <Calculator size={16} /> {busy === 'calc' ? 'جارٍ الاحتساب…' : 'احتسب الشهر'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null || !figures}
                    onClick={() => { setDialogError(null); setDialog('statement'); }}
                    className="sw-button sw-button--sm sw-button--secondary"
                  >
                    <FileText size={16} /> سجّل كشف سويتر
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null || !approval.allowed}
                    aria-describedby="settlement-approval-gaps"
                    onClick={() => { if (approval.allowed) guarded('approve', () => settlementsApi.approve(periodKey)); }}
                    className="sw-button sw-button--sm sw-button--primary"
                  >
                    <CheckCircle2 size={16} /> اعتمد وارحّل الشهر
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => { setDialogError(null); setDialog('collection'); }}
                    className="sw-button sw-button--sm sw-button--secondary"
                  >
                    <Landmark size={16} /> سجّل تحصيلاً بنكياً
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => { setDialogError(null); setDialog('close'); }}
                    className="sw-button sw-button--sm sw-button--secondary"
                  >
                    <Lock size={16} /> أقفل التسوية
                  </button>
                </div>
                <div id="settlement-approval-gaps" className="mt-3 text-sm leading-relaxed">
                  <strong>{approval.allowed ? 'متطلبات الاعتماد مكتملة؛ الترحيل يحتاج قرارك.' : 'الناقص قبل الاعتماد والترحيل:'}</strong>
                  {approval.problems.length > 0 && <ul className="mt-2 list-disc ps-5 space-y-1">{approval.problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
                </div>
                <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  الاعتماد يُثبت إيراد الشهر في الدفاتر (مدين ذمم سويتر · دائن إيراد سويتر · دائن ضريبة
                  المخرجات). والفاتورة بعده توثّق المطالبة ولا تُنشئ قيداً ثانياً.
                </p>
              </Card>
            )}

            {/* ── المؤشرات التشغيلية ── */}
            {canMutate && <SettlementInvoicePanel key={periodKey} settlement={settlement} periodKey={periodKey} busy={busy !== null}
              onIssue={fn => guarded('invoice', async () => { const result = await fn(); await settlementsApi.refetch(); return result; })} />}
            <Card className="p-4 sm:p-6">
              <SectionHeader title="المؤشرات التشغيلية" subtitle="كل رقمٍ مبنيٌّ على صفوفٍ يمكن عدّها" />
              <div className="flex flex-wrap gap-2.5 mt-3 mb-4">
                <Filter size={14} className="mt-2 text-slate-400" />
                {[['driver', 'كل السائقين', options.drivers],
                  ['region', 'كل المناطق', options.regions],
                  ['serviceType', 'كل الخدمات', options.serviceTypes]].map(([k, all, list]) => (
                    <select
                      key={k}
                      value={filters[k]}
                      onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))}
                      aria-label={all}
                      className="text-[12px] px-2.5 py-1.5 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 focus:outline-none focus:border-primary-500"
                    >
                      <option value="">{all}</option>
                      {list.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                ))}
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { icon: Handshake, label: 'إجمالي الحجوزات', v: formatNumber(kpis.totalBookings.value), sub: `مكتملة: ${formatNumber(kpis.completed.value)}` },
                  { icon: Star, label: 'متوسط التقييم', v: kpis.averageRating.value ?? 'ما وصلت التقييمات', sub: kpis.averageRating.denominator ? `من ${formatNumber(kpis.averageRating.denominator)} تقييماً · ٥ نجوم: ${formatNumber(kpis.fiveStarCount.value)}` : 'غير المتاح ليس تقييمًا منخفضًا' },
                  { icon: Timer, label: 'الالتزام بالوقت', v: kpis.onTimeRate.value == null ? '—' : `${kpis.onTimeRate.value}٪`, sub: kpis.onTimeRate.note || `تأخّر ${formatNumber(kpis.lateCount.value)} مرة` },
                  { icon: Ban, label: 'الإلغاءات الإدارية', v: formatNumber(kpis.cancelled.value), sub: kpis.cancellationRate.value == null ? '—' : `${kpis.cancellationRate.value}٪ من الحجوزات` },
                  { icon: AlertTriangle, label: 'مخالفات وأضرار', v: formatNumber(kpis.violations.value), sub: `المعتمد منها ${MONEY(kpis.violations.amount)}` },
                  { icon: Inbox, label: 'شكاوى وتعويضات', v: formatNumber(kpis.complaints.value), sub: `المعتمد منها ${MONEY(kpis.complaints.amount)}` },
                  { icon: CheckCircle2, label: 'حجوزات بلا خصومات', v: formatNumber(kpis.withoutDeductions.value), sub: kpis.averageRating.denominator ? `تقييم منخفض: ${formatNumber(kpis.lowRatedCount.value)}` : 'ما وصلت التقييمات' },
                  { icon: AlertTriangle, label: 'حالات غير معروفة', v: formatNumber(kpis.unknownStatus.value), sub: 'لا يُعترف بإيرادها حتى تُصنَّف' },
                ].map((c) => (
                  <div key={c.label} className="border border-slate-100 dark:border-slate-800 rounded-smallcard p-3">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <c.icon size={12} className="shrink-0" />{c.label}
                    </p>
                    <p className="mt-1 font-bold text-slate-900 dark:text-slate-100 tabular-nums">{c.v}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{c.sub}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* ── قائمة المراجعة ── */}
            {groups.length > 0 && (
              <Card className="p-4 sm:p-6">
                <SectionHeader
                  title={`تحتاج مراجعة (${formatNumber(approval.reviewCount)})`}
                  subtitle="لا يُعترف بإيرادها — وهي وحدها ما يُعرض عليك، لا كل حجز"
                />
                <div className="mt-4 space-y-2">
                  {groups.map(group => <details key={group.key} className="border border-amber-200 dark:border-amber-700 rounded-control p-3">
                    <summary className="cursor-pointer font-semibold">{labelOf(REVIEW_REASON_AR, group.key)} · {formatNumber(group.rows.length)} حجزًا</summary>
                    <p className="mt-2 text-sm">{group.reason}</p>
                    <a className="inline-block mt-2 text-primary-500 underline" href={group.href}>فتح مسار الإصلاح</a>
                    <ul className="mt-3 max-h-64 overflow-auto text-sm space-y-2">{group.rows.map(row => <li key={row.sspBookingId}><span dir="ltr">{row.sspBookingId}</span> · {row.reasonAr || labelOf(REVIEW_REASON_AR, row.reasonCode)}</li>)}</ul>
                  </details>)}
                </div>
              </Card>
            )}

            {/* ── التسويات (خصومات وحوافز) ── */}
            <Card className="p-4 sm:p-6">
              <SectionHeader
                title="الخصومات والحوافز والتعويضات"
                subtitle="لا يُرحَّل شيءٌ منها بمجرد استيراده — الاعتماد قرارٌ بمستنده"
              />
              <div className="mt-4 overflow-x-auto" aria-label="مقارنة بنود سويتر">
                <table className="w-full text-sm min-w-[600px]"><thead><tr><th className="text-right p-2">البند والوحدة</th><th className="text-right p-2">سويتر من اللقطة</th><th className="text-right p-2">المسجل هنا قبل الاعتماد</th></tr></thead>
                  <tbody>{Object.keys(METRIC_ADJUSTMENT_KEYS).map(key => {
                    const labels = { violations: 'المخالفات', damages: 'الأضرار', compensations: 'التعويضات', freeWashCompensation: 'الغسلات المجانية', cancelledByCustomer: 'إلغاء العميل', cancelledByBiker: 'إلغاء البايكر', cancelledMaintenance: 'إلغاء الصيانة' };
                    const unit = SWEATER_METRICS[key].unit, source = metricsApi.snapshot?.metricSources?.[key], value = metricsApi.snapshot?.metrics?.[key];
                    const registered = registeredMetric(adjustmentsApi.adjustments, key, unit);
                    const display = n => unit === 'sar' ? formatCurrency(n) : `${formatNumber(n)} حجز`;
                    return <tr key={key} className="border-t border-slate-200 dark:border-slate-700"><td className="p-2">{labels[key]} · {unit === 'sar' ? 'ريال' : 'عدد'} · {SWEATER_METRICS[key].direction === 'addition' ? 'إضافة' : 'خصم'}</td>
                      <td className="p-2">{metricsApi.loading ? 'جارٍ القراءة' : metricsApi.error ? 'تعذرت قراءة اللقطة' : value == null ? 'ما وصلت بيانات سويتر' : display(value)}{source && <small className="block text-slate-500">{new Date(source.extractedAtIso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })}</small>}</td>
                      <td className="p-2">{adjustmentsApi.loading || adjustmentsApi.error ? 'غير متاح' : registered.value == null ? `العدد غير مسجل · ${registered.records} بند · ${formatCurrency(registered.amount)}` : display(registered.value)}</td></tr>;
                  })}</tbody></table>
                <p className="mt-2 text-xs text-slate-500">المقارنة للعرض فقط؛ لا تحول الأعداد إلى ريالات ولا تنشئ خصمًا أو قيدًا. البنود العامة غير المصنفة لا توزّع بالافتراض.</p>
              </div>
              {adjustmentsApi.adjustments.length === 0 ? (
                <div className="mt-4">
                  <EmptyState compact icon={Inbox} title="لا تسويات في هذا الشهر" hint="تُسجَّل يدوياً أو تصل من كشف سويتر." />
                </div>
              ) : (
                <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 mt-4">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                        <th className="py-3 px-4">النوع</th>
                        <th className="py-3 px-4">التاريخ</th>
                        <th className="py-3 px-4">الحجز</th>
                        <th className="py-3 px-4 text-left tabular-nums">المبلغ</th>
                        <th className="py-3 px-4">الاعتماد</th>
                        <th className="py-3 px-4 text-left w-28">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adjustmentsApi.adjustments.map((a) => (
                        <tr key={a.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                          <td className="py-3 px-4">
                            <span className="font-medium text-slate-800 dark:text-slate-200">{a.nameArabic || a.typeKey}</span>
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                              {labelOf(ADJUSTMENT_KIND_AR, a.kind)}
                            </span>
                          </td>
                          <td className="py-3 px-4 tabular-nums text-slate-600 dark:text-slate-400">{a.effectiveDate}</td>
                          <td className="py-3 px-4 font-mono text-[12px] text-slate-600 dark:text-slate-400">{a.sspBookingId || '—'}</td>
                          <td className="py-3 px-4 text-left tabular-nums font-semibold">{formatCurrency(a.amount)}</td>
                          <td className="py-3 px-4">
                            <span className={`text-[11px] font-bold ${a.approvalStatus === 'approved' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                              {labelOf(ADJUSTMENT_APPROVAL_AR, a.approvalStatus)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-left">
                            {canMutate && a.approvalStatus !== 'approved' && (
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => guarded('adj', () => adjustmentsApi.approve(a.id))}
                                className="text-[12px] px-2.5 py-1.5 rounded-control border border-slate-200 dark:border-slate-700 hover:border-primary-500 text-slate-600 dark:text-slate-400 transition-colors"
                              >
                                اعتمِد
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* ── الحجوزات ── */}
            <Card className="p-4 sm:p-6" id="settlement-bookings">
              <SectionHeader
                title={`حجوزات ${periodKey}`}
                subtitle={`${formatNumber(visible.length)} من ${formatNumber(bookings.length)} بعد الترشيح`}
              />
              {visible.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    compact icon={Inbox} title="لا حجوزات في هذا الشهر"
                    hint="تصل تلقائياً من وكيل المتصفح عبر باب التكامل — راجع تبويب «تكامل سويتر»."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 mt-4">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                        <th className="py-3 px-4">رقم الحجز</th>
                        <th className="py-3 px-4">التاريخ</th>
                        <th className="py-3 px-4">الخدمة</th>
                        <th className="py-3 px-4">السائق</th>
                        <th className="py-3 px-4">المنطقة</th>
                        <th className="py-3 px-4">الحالة</th>
                        <th className="py-3 px-4 text-left tabular-nums">مبلغ المنصة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.slice(0, 200).map((row) => {
                        const r = row.record ?? row;
                        return (
                          <tr key={r.sspBookingId} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-4 font-mono text-[12px] text-slate-700 dark:text-slate-300">{r.sspBookingId}</td>
                            <td className="py-3 px-4 tabular-nums text-slate-600 dark:text-slate-400">{r.serviceDate}</td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{r.serviceTypeLabel || r.serviceType}</td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{r.driverName || '—'}</td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{r.region || '—'}</td>
                            <td className="py-3 px-4">
                              <span className={`text-[11px] font-medium ${r.normalizedStatus === 'unknown' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400'}`}>
                                {labelOf(BOOKING_STATUS_AR, r.normalizedStatus)}
                                {r.normalizedStatus === 'unknown' && r.rawStatus ? ` («${r.rawStatus}»)` : ''}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-left tabular-nums text-slate-600 dark:text-slate-400">
                              {r.platformAmount == null ? '—' : formatCurrency(r.platformAmount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {visible.length > 200 && (
                    <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                      يُعرض أول ٢٠٠ من {formatNumber(visible.length)} — رشّح لتضييق القائمة.
                    </p>
                  )}
                </div>
              )}
            </Card>
          </>
        )}
      </main>

      {/* ── كشف سويتر ── */}
      <SweaterActionDialog
        open={dialog === 'statement'}
        title={`كشف سويتر — ${periodKey}`}
        subtitle="الرقم كما ورد في الكشف، لا كما نتوقّعه. والفرق يُسجَّل بسببه."
        icon={FileText}
        busy={busy === 'stmt'}
        error={dialogError}
        confirmLabel="سجّل الكشف"
        busyLabel="جارٍ التسجيل…"
        context={figures ? (
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-control px-3 py-2.5 text-[12px] text-slate-600 dark:text-slate-400">
            صافي المستحق المتوقع: <strong className="tabular-nums text-slate-800 dark:text-slate-200">{MONEY(figures.netDue)}</strong>
          </div>
        ) : null}
        fields={[{
          name: 'statedNetDue',
          label: 'صافي المستحق في الكشف (ر.س)',
          type: 'number',
          required: true,
          min: 0,
          hint: 'اختلافه عن المتوقع يُنشئ فرقاً يمنع الإقفال حتى يُحسم.',
        }]}
        onClose={() => { setDialog(null); setDialogError(null); }}
        onConfirm={async ({ statedNetDue }) => {
          setDialogError(null);
          setBusy('stmt');
          try {
            await settlementsApi.recordStatement({ periodKey, statedNetDue });
            setDialog(null);
            showToast('سُجّل الكشف');
          } catch (e) {
            console.error('🔥 Sweater.recordStatement:', e);
            setDialogError(describeBackendError(e) || e?.message || 'تعذّر تسجيل الكشف');
          } finally { setBusy(null); }
        }}
      />

      {/* ── التحصيل: المبلغ والتاريخ في نافذةٍ واحدة ──
          كانا سؤالين متتاليين بـ`prompt`، فإلغاءُ الثاني يترك المستخدم وقد
          أجاب الأول بلا أثر — والأسوأ أن فراغ المبلغ كان يمرّ صفراً. */}
      <SweaterActionDialog
        open={dialog === 'collection'}
        title={`تسجيل تحصيل — ${periodKey}`}
        subtitle="تحويلٌ بنكي وارد من سويتر. لا يُسجَّل في الصندوق."
        icon={Landmark}
        busy={busy === 'collect'}
        error={dialogError}
        confirmLabel="سجّل التحصيل"
        busyLabel="جارٍ التسجيل…"
        context={figures ? (
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-control px-3 py-2.5 text-[12px] text-slate-600 dark:text-slate-400 space-y-1">
            <p>صافي المستحق: <strong className="tabular-nums text-slate-800 dark:text-slate-200">{MONEY(figures.netDue)}</strong></p>
            {settlement?.collectedTotal > 0 && (
              <p>المُحصَّل حتى الآن: <strong className="tabular-nums">{MONEY(settlement.collectedTotal)}</strong></p>
            )}
          </div>
        ) : null}
        fields={[
          {
            name: 'amount',
            label: 'المبلغ المُحصَّل (ر.س)',
            type: 'number',
            required: true,
            positive: true,
            hint: 'تحصيلٌ جزئي مقبول — الحالة تتبع المجموع.',
          },
          {
            name: 'receivedDate',
            label: 'تاريخ الاستلام',
            type: 'date',
            required: true,
            hint: 'تاريخ وصول التحويل إلى الحساب البنكي، وبه يُؤرَّخ القيد.',
          },
        ]}
        onClose={() => { setDialog(null); setDialogError(null); }}
        onConfirm={async ({ amount, receivedDate }) => {
          setDialogError(null);
          setBusy('collect');
          try {
            await settlementsApi.recordCollection({ periodKey, amount, receivedDate });
            setDialog(null);
            showToast('سُجّل التحصيل');
          } catch (e) {
            console.error('🔥 Sweater.recordCollection:', e);
            setDialogError(describeBackendError(e) || e?.message || 'تعذّر تسجيل التحصيل');
          } finally { setBusy(null); }
        }}
      />

      {/* ── الإقفال: السبب إلزامي عند وجود فروق ── */}
      <SweaterActionDialog
        open={dialog === 'close'}
        title={`إقفال تسوية ${periodKey}`}
        subtitle={unresolved.length
          ? 'فروقٌ غير محلولة — الإقفال بقرار المدير وسببٍ مكتوب.'
          : 'لا فروق معلّقة. الإقفال نهائي ولا تتغيّر حالته بعده.'}
        icon={Lock}
        tone={unresolved.length ? 'danger' : 'primary'}
        busy={busy === 'close'}
        error={dialogError}
        confirmLabel="أقفل التسوية"
        busyLabel="جارٍ الإقفال…"
        context={unresolved.length ? (
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-control px-3 py-2.5 text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">
            {formatNumber(unresolved.length)} فرقٌ غير محلول سيبقى مسجَّلاً بعد الإقفال،
            ويُكتب عددُه وسببُك في سجل التدقيق.
          </div>
        ) : null}
        fields={unresolved.length ? [{
          name: 'reason',
          label: 'سبب الإقفال رغم الفروق',
          type: 'textarea',
          required: true,
          placeholder: 'مثال: فرقٌ بـ١٢ ريالاً قيد التفاوض مع سويتر، وسيُسوّى الشهر القادم.',
          hint: 'يُقرأ في المراجعة — تسويةٌ أُقفلت على فرقٍ بلا تفسير لا يُدافَع عنها.',
        }] : []}
        onClose={() => { setDialog(null); setDialogError(null); }}
        onConfirm={async ({ reason }) => {
          setDialogError(null);
          setBusy('close');
          try {
            await settlementsApi.close(periodKey, reason ?? null);
            setDialog(null);
            showToast('أُقفلت التسوية');
          } catch (e) {
            console.error('🔥 Sweater.closeSettlement:', e);
            setDialogError(describeBackendError(e) || e?.message || 'تعذّر إقفال التسوية');
          } finally { setBusy(null); }
        }}
      />

      <Toast open={toast.open} message={toast.message} tone={toast.tone} duration={toast.duration} onClose={closeToast} />
    </>
  );
}
