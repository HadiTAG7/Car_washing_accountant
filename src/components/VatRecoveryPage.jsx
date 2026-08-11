import { useMemo, useState } from 'react';
import {
  Percent, Receipt, Coins, Link as LinkIcon, FileText, Download, Calendar,
} from 'lucide-react';
import {
  formatCurrency, formatCurrencyPrecise, formatDate, formatNumber, extractVat, netOfVat,
} from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, EmptyState, SecondaryButton,
} from './UI';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { useTaxInvoices } from '../hooks/useTaxInvoices';
import { useStartupCosts } from '../hooks/useStartupCosts';
import { useAnnualExpenses } from '../hooks/useAnnualExpenses';
import { useMonthlyExpenses } from '../hooks/useMonthlyExpenses';
import { useVariableExpenses } from '../hooks/useVariableExpenses';
import { isSupabaseConfigured, missingEnvNames } from '../lib/supabaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

// Same guard the detail modal uses — only http(s) values become anchors.
function isSafeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

// ─── VAT return periods ──────────────────────────────────────────────────
// ZATCA files QUARTERLY for taxable supplies under SAR 40m (monthly only
// above that), so the report totals by quarter, not by month.
const QUARTER_NAMES = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
const QUARTER_MONTHS = [
  'يناير – مارس', 'أبريل – يونيو', 'يوليو – سبتمبر', 'أكتوبر – ديسمبر',
];
/** '2026-08-11' → '2026-Q3' ('' when the date is missing/invalid). */
function quarterOf(iso) {
  const s = String(iso || '');
  if (s.length < 7) return '';
  const y = s.slice(0, 4);
  const m = parseInt(s.slice(5, 7), 10);
  if (!Number.isFinite(m) || m < 1 || m > 12) return '';
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}
/** '2026-Q3' → 'الربع الثالث 2026 · يوليو – سبتمبر'. */
function quarterLabel(q) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(q || ''));
  if (!m) return q;
  const i = +m[2] - 1;
  return `الربع ${QUARTER_NAMES[i]} ${m[1]} · ${QUARTER_MONTHS[i]}`;
}
/** The quarter containing today, used as the report's default period. */
function currentQuarter() {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}
// A recurring monthly expense is claimable in each month of the period, so
// a quarterly return counts it three times.
const MONTHS_PER_QUARTER = 3;

// Tiny source chip next to the parent item name — tells the admin which
// page the invoice was logged from.
const SOURCE_META = {
  startup: { label: 'تأسيس', cls: 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-100 dark:border-primary-500/30' },
  annual:  { label: 'سنوي',  cls: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30' },
  monthly: { label: 'شهري',  cls: 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-500/30' },
  variable:{ label: 'متغيّر', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700' },
};
function SourceBadge({ source }) {
  const meta = SOURCE_META[source];
  if (!meta) return null;
  return (
    <span className={`inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

export default function VatRecoveryPage() {
  const { invoices, loading, error, sourceErrors, refetch } = useTaxInvoices();
  const { items: startupItems } = useStartupCosts();
  const { items: annualItems }  = useAnnualExpenses();
  const { items: monthlyItems } = useMonthlyExpenses();
  const { items: variableItems } = useVariableExpenses();
  const { scalingFactor } = usePartnerView();

  // ZATCA returns are filed per period — let the admin narrow to one
  // quarter (YYYY-Qn) before totalling / exporting. '' = all periods.
  // Defaults to the CURRENT quarter: that is the return actually being
  // prepared, and it is the only view whose totals are directly filable.
  const [period, setPeriod] = useState(currentQuarter);

  // Every quarter present in the data, newest first, plus the current one so
  // a fresh quarter is selectable before its first invoice is logged.
  const periods = useMemo(() => {
    const set = new Set(invoices.map((e) => quarterOf(e.spentDate)).filter(Boolean));
    set.add(currentQuarter());
    return [...set].sort().reverse();
  }, [invoices]);

  // A recurring monthly invoice has no single spend date — its VAT is
  // reclaimable in EVERY return period, so it stays visible whichever quarter
  // is selected. One-off rows filter by their own date as before.
  const filtered = useMemo(
    () => (period
      ? invoices.filter((e) => e.recurring || quarterOf(e.spentDate) === period)
      : invoices),
    [invoices, period],
  );

  // How many times a recurring row counts in the selected view: three within
  // a quarter, once when no period is chosen (there is no defined span to
  // multiply across, and over-stating a reclaim is the costlier error).
  const recurringMultiplier = period ? MONTHS_PER_QUARTER : 1;

  // Resolve parentId → item name across both sources (uuids can't
  // collide, so one merged map is enough).
  const itemNameById = useMemo(() => {
    const m = new Map();
    startupItems.forEach((i) => m.set(i.id, i.itemName));
    annualItems.forEach((i)  => m.set(i.id, i.expenseName));
    monthlyItems.forEach((i) => m.set(i.id, i.expenseName));
    variableItems.forEach((i) => m.set(i.id, i.expenseName));
    return m;
  }, [startupItems, annualItems, monthlyItems, variableItems]);

  // All money figures are scaled by the viewing partner's share for
  // consistency with the rest of the dashboard (admin → ×1).
  const kpis = useMemo(() => {
    let inclusive = 0, vat = 0, net = 0;
    filtered.forEach((e) => {
      // A recurring monthly invoice is claimed in each month of the quarter.
      const n = e.recurring ? recurringMultiplier : 1;
      inclusive += (e.amount || 0) * n;
      vat       += extractVat(e.amount, true) * n;
      net       += netOfVat(e.amount, true) * n;
    });
    return {
      inclusive: inclusive * scalingFactor,
      vat:       vat       * scalingFactor,
      net:       net       * scalingFactor,
      count:     filtered.length,
    };
  }, [filtered, scalingFactor, recurringMultiplier]);

  function handleExport() {
    const rows = filtered.map((e) => {
      const n = e.recurring ? recurringMultiplier : 1;
      return [
        itemNameById.get(e.parentId) || '',
        SOURCE_META[e.source]?.label || e.source,
        e.description,
        e.recurring ? 'متكرر شهرياً' : e.spentDate,
        // The count carried into the period, so the accountant can see why a
        // recurring line totals more than its single-month value.
        n,
        // Amounts as numbers, not strings — the CSV layer's formula-injection
        // guard neutralizes only text, so numbers keep Excel interpretation.
        Number(((e.amount || 0) * n * scalingFactor).toFixed(2)),
        Number((extractVat(e.amount, true) * n * scalingFactor).toFixed(2)),
        Number((netOfVat(e.amount, true) * n * scalingFactor).toFixed(2)),
        isSafeHttpUrl(e.invoiceUrl) ? e.invoiceUrl : '',
      ];
    });
    // Totals row for the accountant.
    rows.push(['الإجمالي', '', '', '', '', Number(kpis.inclusive.toFixed(2)), Number(kpis.vat.toFixed(2)), Number(kpis.net.toFixed(2)), '']);
    const label = period || 'كل-الفترات';
    downloadCsv(
      `الضريبة-المستردة-${label}`,
      ['البند الأصلي', 'المصدر', 'الوصف', 'التاريخ', 'عدد الأشهر', 'شامل الضريبة', 'الضريبة 15%', 'الصافي', 'رابط الفاتورة'],
      rows,
    );
  }

  return (
    <>
      <TopBar
        title="الضريبة المستردة"
        subtitle="الإقرار الضريبي ربع سنوي — إجمالي ضريبة القيمة المضافة المتوقع استردادها"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isSupabaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {/* Full ErrorState only when BOTH sources failed. A single
            failed source (usually its migration hasn't run yet) gets a
            compact amber note below while the healthy source's invoices
            keep rendering. */}
        {error && (
          <ErrorState
            title="تعذّر تحميل الفواتير الضريبية"
            error={error}
            onRetry={refetch}
          />
        )}
        {!error && sourceErrors.startup && (
          <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-4 py-2.5 rounded-control leading-relaxed">
            تعذّر تحميل فواتير <strong>رسوم التأسيس</strong> — إن لم تكن قد شغّلت{' '}
            <code className="bg-amber-100 dark:bg-amber-500/20 px-1 rounded-control" dir="ltr">2026_06_startup_cost_entries_ALL.sql</code>{' '}
            في Supabase SQL Editor، شغّله ثم حدّث الصفحة. الفواتير السنوية معروضة أدناه.
          </div>
        )}
        {!error && sourceErrors.annual && (
          <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-4 py-2.5 rounded-control leading-relaxed">
            تعذّر تحميل فواتير <strong>المصاريف السنوية</strong> — إن لم تكن قد شغّلت{' '}
            <code className="bg-amber-100 dark:bg-amber-500/20 px-1 rounded-control" dir="ltr">2026_06_annual_expense_entries_ALL.sql</code>{' '}
            في Supabase SQL Editor، شغّله ثم حدّث الصفحة. فواتير التأسيس معروضة أدناه.
          </div>
        )}

        {/* ── KPI summary ──────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
          <StatCard
            className="col-span-2 md:col-span-1"
            icon={Percent}
            tone="emerald"
            label="إجمالي الضريبة المتوقع استردادها"
            value={formatCurrencyPrecise(kpis.vat)}
            sub={`${formatNumber(kpis.count)} فاتورة ضريبية${period ? ` · ${period}` : ''}`}
          />
          <StatCard
            icon={Receipt}
            tone="slate"
            label="إجمالي الفواتير (شامل الضريبة)"
            value={formatCurrency(kpis.inclusive)}
            sub="مجموع المبالغ المدفوعة فعلياً"
          />
          <StatCard
            icon={Coins}
            tone="primary"
            label="صافي قيمة السلع (قبل الضريبة)"
            value={formatCurrency(kpis.net)}
            sub="الإجمالي مطروحاً منه الضريبة"
          />
        </div>

        {/* ── Tax invoices table ───────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="الفواتير الضريبية"
            subtitle={period ? quarterLabel(period) : 'كل الفترات'}
            action={
              <div className="flex items-center gap-2">
                {/* Period filter */}
                <div className="relative">
                  <Calendar size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
                  <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="appearance-none h-10 pr-8 pl-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-semibold tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
                    aria-label="فلترة حسب الفترة"
                  >
                    <option value="">كل الفترات</option>
                    {periods.map((p) => <option key={p} value={p}>{quarterLabel(p)}</option>)}
                  </select>
                </div>
                <SecondaryButton
                  icon={Download}
                  onClick={handleExport}
                  disabled={filtered.length === 0}
                >
                  تصدير CSV
                </SecondaryButton>
              </div>
            }
          />

          {loading && filtered.length === 0 ? (
            <LoadingState message="جارٍ تحميل الفواتير الضريبية..." />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={period ? 'لا توجد فواتير ضريبية في هذه الفترة' : 'لا توجد فواتير ضريبية مسجّلة بعد'}
              hint={period
                ? 'جرّب اختيار فترة أخرى أو "كل الفترات".'
                : 'افتح أي بند في صفحة "رسوم التأسيس" أو "المصاريف السنوية"، أضف مصروفاً، وفعّل خيار "فاتورة ضريبية" — وسيظهر هنا تلقائياً.'}
            />
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">البند الأصلي</th>
                    <th className="py-3 px-4 whitespace-nowrap">الوصف</th>
                    <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">شامل الضريبة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الضريبة (15%)</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الصافي</th>
                    <th className="py-3 px-4 whitespace-nowrap">الفاتورة</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    // Recurring lines are claimed once per month of the
                    // period, so the row shows the period total — otherwise
                    // the column would not add up to the footer.
                    const times     = e.recurring ? recurringMultiplier : 1;
                    const inclusive = (e.amount || 0) * times * scalingFactor;
                    const vat       = extractVat(e.amount, true) * times * scalingFactor;
                    const net       = netOfVat(e.amount, true) * times * scalingFactor;
                    return (
                      <tr
                        key={e.id}
                        className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1.5">
                            {itemNameById.get(e.parentId) || '—'}
                            <SourceBadge source={e.source} />
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-normal break-words min-w-[160px] font-medium text-slate-800 dark:text-slate-200">
                          {e.description}
                          {e.notes && (
                            <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                              {e.notes}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400">
                          {/* A recurring monthly invoice has no single spend
                              date — say so instead of rendering an empty cell. */}
                          {e.recurring
                            ? (
                              <span className="text-indigo-700 dark:text-indigo-300 font-semibold">
                                متكرر شهرياً
                                {times > 1 && (
                                  <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mr-1 tabular-nums">
                                    (×{times} أشهر)
                                  </span>
                                )}
                              </span>
                            )
                            : formatDate(e.spentDate)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">
                          {formatCurrency(inclusive)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-emerald-700 dark:text-emerald-300">
                          {formatCurrencyPrecise(vat)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">
                          {formatCurrency(net)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {e.invoiceUrl && isSafeHttpUrl(e.invoiceUrl) ? (
                            <a
                              href={e.invoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary-700 dark:text-primary-300 hover:underline font-semibold text-[12px]"
                              title={e.invoiceUrl}
                            >
                              <LinkIcon size={12} />
                              عرض
                            </a>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    <td colSpan={3} className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">
                      الإجمالي
                    </td>
                    <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatCurrency(kpis.inclusive)}
                    </td>
                    <td className="py-3 px-4 text-left font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                      {formatCurrency(kpis.vat)}
                    </td>
                    <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatCurrency(kpis.net)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}
