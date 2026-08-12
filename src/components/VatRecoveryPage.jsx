import { useMemo, useState } from 'react';
import {
  Percent, Receipt, Coins, Link as LinkIcon, FileText, Download, Calendar,
  ArrowUpRight, ArrowDownLeft, AlertTriangle, Scale,
} from 'lucide-react';
import {
  formatCurrency, formatCurrencyPrecise, formatDate, formatNumber,
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
import { useWashes } from '../hooks/useWashes';
import { useLedger } from '../hooks/useLedger';
import { useAccountingSettings } from '../hooks/useAccountingSettings';
import {
  buildVatReport, periodLabel, availablePeriods, currentPeriodKey,
  FILING_PERIOD_LABELS,
} from '../lib/accounting/vatReturn';
import { taxPolicyAt } from '../lib/accounting/taxPolicy';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

/** Where a deducted VAT figure actually came from — shown, never inferred. */
const TAX_SOURCE_LABELS = {
  invoice: 'مبلغ الفاتورة',
  'invoice-rate': 'نسبة الفاتورة',
  policy: 'سياسة تاريخ الفاتورة',
  default: 'النسبة الافتراضية',
};

// Same guard the detail modal uses — only http(s) values become anchors.
function isSafeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

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

/**
 * تقرير ضريبة القيمة المضافة — output tax, deductible input tax, and the net.
 *
 * Named a *report*, not a return: it covers the three headline figures but
 * not every field of a ZATCA declaration (zero-rated and exempt supplies,
 * imports, corrections of prior periods), so calling it an إقرار would
 * overstate what it is.
 *
 * The rule this page exists to enforce: **input tax is only deducted against
 * a real tax invoice**. A cost being recurring is not evidence that three
 * invoices exist. Anything without a date, an invoice number, a supplier and
 * an amount of its own is listed as غير مؤهلة with the missing fields named —
 * excluded from the claim, but never hidden.
 */
export default function VatRecoveryPage() {
  const { invoices, loading, error, sourceErrors, refetch } = useTaxInvoices();
  const { items: startupItems } = useStartupCosts();
  const { items: annualItems }  = useAnnualExpenses();
  const { items: monthlyItems } = useMonthlyExpenses();
  const { items: variableItems } = useVariableExpenses();
  const { items: washes } = useWashes();
  const { entries, lines } = useLedger();
  const { settings } = useAccountingSettings();
  const { scalingFactor } = usePartnerView();

  const filing = settings.vatFilingPeriod || 'quarterly';
  // Opens on the period actually being prepared — the only view whose totals
  // are directly usable.
  const [period, setPeriod] = useState('');

  const periods = useMemo(
    () => availablePeriods(invoices, filing, washes.map((w) => w.washDate)),
    [invoices, filing, washes],
  );

  // Switching the filing frequency changes the shape of a period key
  // ('2026-Q3' ↔ '2026-08'), so a selection made under the old setting no
  // longer names anything. Fall back to the current period rather than
  // rendering a select with no matching option.
  const selected = period === '__all__' || periods.includes(period)
    ? period
    : currentPeriodKey(filing);
  const activePeriod = selected === '__all__' ? '' : selected;

  // A posted wash reports what its own entry froze; an unposted one is split
  // under the policy in force on ITS date. Neither is re-derived from today's
  // switches — that is what made a July figure move when August changed.
  const washEntryBySource = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      if (e.status !== 'posted' || e.reversalOf) continue;
      if ((e.sourceKind || e.sourceType) !== 'wash') continue;
      m.set(String(e.sourceId ?? ''), e);
    }
    return m;
  }, [entries]);

  const report = useMemo(() => buildVatReport({
    inputs: invoices,
    washes,
    entries,
    lines,
    period: activePeriod,
    filing,
    policyAt: (date) => taxPolicyAt(date, settings),
    postedEntryOf: (w) => washEntryBySource.get(String(w.id)),
    vatRegistered: settings.vatRegistered,
    washPriceMode: settings.washPriceMode,
  }), [invoices, washes, entries, lines, activePeriod, filing, settings, washEntryBySource]);

  // Resolve parentId → item name across all sources (uuids can't collide, so
  // one merged map is enough).
  const itemNameById = useMemo(() => {
    const m = new Map();
    startupItems.forEach((i) => m.set(i.id, i.itemName));
    annualItems.forEach((i)  => m.set(i.id, i.expenseName));
    monthlyItems.forEach((i) => m.set(i.id, i.expenseName));
    variableItems.forEach((i) => m.set(i.id, i.expenseName));
    return m;
  }, [startupItems, annualItems, monthlyItems, variableItems]);

  // Money is scaled by the viewing partner's share, as elsewhere (admin → ×1).
  const s = scalingFactor;
  const outputTax = report.output.tax * s;
  const inputTax  = report.input.tax * s;
  const netTax    = report.netTax * s;

  function handleExport() {
    const rows = report.eligible.map((e) => [
      itemNameById.get(e.parentId) || '',
      SOURCE_META[e.source]?.label || e.source,
      e.description,
      e.supplier || '',
      e.invoiceNumber || '',
      e.claimDate,
      Number((e.gross * s).toFixed(2)),
      Number((e.net * s).toFixed(2)),
      Number((e.tax * s).toFixed(2)),
      TAX_SOURCE_LABELS[e.taxSource] || e.taxSource || '',
      isSafeHttpUrl(e.invoiceUrl) ? e.invoiceUrl : '',
    ]);
    rows.push(['إجمالي ضريبة المدخلات المؤهلة', '', '', '', '', '',
      Number((report.input.gross * s).toFixed(2)),
      Number((report.input.net * s).toFixed(2)),
      Number(inputTax.toFixed(2)), '', '']);
    rows.push(['ضريبة المخرجات (الغسلات)', '', '', '', '', '',
      Number((report.output.gross * s).toFixed(2)),
      Number((report.output.net * s).toFixed(2)),
      Number(outputTax.toFixed(2)), '', '']);
    rows.push([
      netTax >= 0 ? 'صافي الضريبة المستحقة للهيئة' : 'صافي الضريبة المستردة',
      '', '', '', '', '', '', '', Number(Math.abs(netTax).toFixed(2)), '', '',
    ]);
    // Rejected invoices travel with the export: an accountant reviewing the
    // period needs to see what was NOT claimed and why.
    for (const r of report.ineligible) {
      rows.push([
        itemNameById.get(r.parentId) || '', SOURCE_META[r.source]?.label || r.source,
        r.description, r.supplier || '', r.invoiceNumber || '', r.claimDate || '',
        Number(((Number(r.amount) || 0) * s).toFixed(2)), '', 0, '',
        `غير مؤهلة — ينقصها: ${r.missing.join('، ')}`,
      ]);
    }
    // Unresolved invoices travel too. They are NOT zero-VAT purchases and must
    // not read as if they were — the export says which they are and why.
    for (const r of report.unresolved) {
      rows.push([
        itemNameById.get(r.parentId) || '', SOURCE_META[r.source]?.label || r.source,
        r.description, r.supplier || '', r.invoiceNumber || '', r.claimDate || '',
        Number(((Number(r.amount) || 0) * s).toFixed(2)), '', '', 'غير محدَّد',
        `ضريبة غير محدَّدة — ${r.reason}`,
      ]);
    }
    downloadCsv(
      `تقرير-ضريبة-القيمة-المضافة-${activePeriod || 'كل-الفترات'}`,
      ['البند', 'المصدر', 'الوصف', 'المورّد', 'رقم الفاتورة', 'تاريخ الفاتورة',
        'شامل الضريبة', 'الصافي', 'الضريبة', 'مصدر الضريبة', 'رابط الفاتورة / ملاحظة'],
      rows,
    );
  }

  const anyRows = report.eligible.length > 0 || report.ineligible.length > 0
    || report.unresolved.length > 0 || report.output.count > 0;

  return (
    <>
      <TopBar
        title="تقرير ضريبة القيمة المضافة"
        subtitle={`ضريبة المخرجات والمدخلات والصافي — إقرار ${FILING_PERIOD_LABELS[filing]}`}
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
        {error && (
          <ErrorState title="تعذّر تحميل الفواتير الضريبية" error={error} onRetry={refetch} />
        )}
        {!error && sourceErrors.startup && (
          <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-4 py-2.5 rounded-control leading-relaxed">
            تعذّر تحميل فواتير <strong>رسوم التأسيس</strong> — تحقّق من اتصالك ومن صلاحيات
            حسابك، ثم حدّث الصفحة. بقية المصادر معروضة أدناه.
          </div>
        )}
        {!error && sourceErrors.annual && (
          <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-4 py-2.5 rounded-control leading-relaxed">
            تعذّر تحميل فواتير <strong>المصاريف السنوية</strong> — تحقّق من اتصالك ومن صلاحيات
            حسابك، ثم حدّث الصفحة. بقية المصادر معروضة أدناه.
          </div>
        )}

        {/* ── ما هذا التقرير، وما ليس هو ─────────────────────────── */}
        <div role="note" className="flex items-start gap-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs px-4 py-3 rounded-control leading-relaxed">
          <Scale size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-slate-900 dark:text-slate-100">ورقة عمل داخلية — ليست إقراراً ضريبياً.</p>
            <p className="mt-1">
              تغطي المخرجات والمدخلات والصافي فقط، ولا تشمل كل حقول الإقرار
              (التوريدات الصفرية والمعفاة، والاستيراد، وتصحيحات الفترات السابقة).
              <strong className="mx-1">ضريبة المدخلات تُحتسب من فواتير فعلية فقط</strong>
              لكل منها تاريخ ورقم فاتورة ومورّد ومبلغ مستقل — تكرار المصروف شهرياً
              ليس دليلاً على وجود فواتير.
            </p>
            <p className="mt-1">
              دورية الإقرار ({FILING_PERIOD_LABELS[filing]}) تُضبط من «إقفال الفترة ← إعدادات المحاسبة».
            </p>
          </div>
        </div>

        {!settings.vatRegistered && (
          <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-4 py-2.5 rounded-control leading-relaxed">
            المنشأة غير مسجّلة في ضريبة القيمة المضافة في الإعدادات — لذلك ضريبة
            المخرجات صفر، ويُسجَّل كامل مبلغ الغسلة إيراداً. غيّر ذلك من إعدادات المحاسبة
            إذا كانت مسجّلة فعلاً.
          </div>
        )}

        {/* ── الأرقام الثلاثة ───────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
          <StatCard
            icon={ArrowUpRight}
            tone="indigo"
            label="ضريبة المخرجات (المبيعات)"
            value={formatCurrencyPrecise(outputTax)}
            sub={report.output.source === 'ledger'
              ? 'من حركة حساب 2100 المُرحّلة — شاملة الإشعارات'
              : `${formatNumber(report.output.count)} غسلة مكتملة (لا توجد قيود بعد)`}
          />
          <StatCard
            icon={ArrowDownLeft}
            tone="emerald"
            label="ضريبة المدخلات المؤهلة"
            value={formatCurrencyPrecise(inputTax)}
            sub={`${formatNumber(report.input.count)} فاتورة مستوفية`}
          />
          <StatCard
            className="col-span-2 md:col-span-1"
            icon={Percent}
            tone={report.direction === 'refundable' ? 'emerald' : 'primary'}
            label={report.direction === 'refundable' ? 'صافي الضريبة المستردة' : 'صافي الضريبة المستحقة'}
            value={formatCurrencyPrecise(Math.abs(netTax))}
            sub={report.direction === 'refundable'
              ? 'المدخلات تفوق المخرجات'
              : report.direction === 'nil' ? 'لا مستحق ولا مسترد' : 'تُسدَّد للهيئة'}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
          <StatCard
            icon={Receipt}
            tone="slate"
            label="مشتريات مؤهلة (شامل الضريبة)"
            value={formatCurrency(report.input.gross * s)}
          />
          <StatCard
            icon={Coins}
            tone="slate"
            label="صافي المشتريات (قبل الضريبة)"
            value={formatCurrency(report.input.net * s)}
          />
          <StatCard
            className="col-span-2 md:col-span-1"
            icon={AlertTriangle}
            tone={report.ineligible.length ? 'amber' : 'slate'}
            label="ضريبة غير مطالَب بها"
            value={formatCurrencyPrecise(report.forfeitedTax * s)}
            sub={report.ineligible.length
              ? `${formatNumber(report.ineligible.length)} فاتورة ناقصة البيانات`
              : 'كل الفواتير مستوفية'}
          />
        </div>

        {/* ── مطابقة التقرير بالدفاتر ────────────────────────────
            Both sides get the same treatment: a figure the report claims but
            the ledger has never seen is a gap worth naming, not averaging. */}
        {(report.outputMismatch !== 0 || report.inputMismatch !== 0) && (
          <div role="alert" className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs px-4 py-3 rounded-control leading-relaxed">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-bold">التقرير لا يطابق الدفاتر — عمليات لم تُرحَّل بعد.</p>
              {report.outputMismatch !== 0 && (
                <p className="mt-1">
                  <span className="font-semibold">المخرجات:</span> من الغسلات{' '}
                  <strong className="tabular-nums">{formatCurrencyPrecise(report.operationalOutput.tax)}</strong>{' '}
                  · في الدفاتر (حساب 2100){' '}
                  <strong className="tabular-nums">{formatCurrencyPrecise(report.ledgerOutput.tax)}</strong>{' '}
                  · الفرق{' '}
                  <strong className="tabular-nums">{formatCurrencyPrecise(report.outputMismatch)}</strong>
                </p>
              )}
              {report.inputMismatch !== 0 && (
                <p className="mt-1">
                  <span className="font-semibold">المدخلات:</span> من الفواتير المؤهلة{' '}
                  <strong className="tabular-nums">{formatCurrencyPrecise(report.input.tax)}</strong>{' '}
                  · في الدفاتر (حساب 1200){' '}
                  <strong className="tabular-nums">{formatCurrencyPrecise(report.ledgerInput.tax)}</strong>{' '}
                  · الفرق{' '}
                  <strong className="tabular-nums">{formatCurrencyPrecise(report.inputMismatch)}</strong>
                </p>
              )}
              <p className="mt-1">شغّل «إقفال الفترة ← فحص غير المُرحّل ← ترحيل» لتتطابق الأرقام.</p>
            </div>
          </div>
        )}

        {/* ── المؤهلة غير المُرحّلة ───────────────────────────────── */}
        {report.unpostedEligible.length > 0 && (
          <Card className="p-6">
            <SectionHeader
              title="فواتير مؤهلة لم تُرحَّل إلى الدفاتر"
              subtitle={`${formatNumber(report.unpostedEligible.length)} فاتورة بضريبة ${formatCurrencyPrecise(report.unpostedInputTax * s)} — مطالَب بها في التقرير وغير موجودة في حساب 1200`}
            />
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">البند</th>
                    <th className="py-3 px-4 whitespace-nowrap">المورّد</th>
                    <th className="py-3 px-4 whitespace-nowrap">تاريخ الفاتورة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الضريبة</th>
                  </tr>
                </thead>
                <tbody>
                  {report.unpostedEligible.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                      <td className="py-3 px-4 whitespace-normal break-words min-w-[160px] text-slate-800 dark:text-slate-200">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {r.description}
                          <SourceBadge source={r.source} />
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-300">{r.supplier}</td>
                      <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400">{formatDate(r.claimDate)}</td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-amber-700 dark:text-amber-300">
                        {formatCurrencyPrecise(r.tax * s)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── فواتير المدخلات المؤهلة ───────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="فواتير المدخلات المؤهلة للخصم"
            subtitle={activePeriod ? periodLabel(activePeriod) : 'كل الفترات'}
            action={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Calendar size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
                  <select
                    value={selected}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="appearance-none h-10 pr-8 pl-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-semibold tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
                    aria-label="فلترة حسب الفترة"
                  >
                    {periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
                    <option value="__all__">كل الفترات</option>
                  </select>
                </div>
                <SecondaryButton icon={Download} onClick={handleExport} disabled={!anyRows}>
                  تصدير CSV
                </SecondaryButton>
              </div>
            }
          />

          {loading && !anyRows ? (
            <LoadingState message="جارٍ تحميل الفواتير الضريبية..." />
          ) : report.eligible.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="لا توجد فواتير مدخلات مؤهلة في هذه الفترة"
              hint="الفاتورة تصبح مؤهلة عندما تحمل تاريخاً ورقم فاتورة واسم مورّد ومبلغاً — أكمل هذه الحقول في المصروف ليُحتسب خصمه."
              compact
            />
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">البند</th>
                    <th className="py-3 px-4 whitespace-nowrap">المورّد</th>
                    <th className="py-3 px-4 whitespace-nowrap">رقم الفاتورة</th>
                    <th className="py-3 px-4 whitespace-nowrap">تاريخ الفاتورة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">شامل الضريبة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الصافي</th>
                    {/* No fixed «15%» in the caption: a 5%-era purchase keeps
                        its own rate, so the number is shown with WHERE it came
                        from rather than a percentage that may contradict it. */}
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الضريبة</th>
                    <th className="py-3 px-4 whitespace-nowrap">مصدر الضريبة</th>
                    <th className="py-3 px-4 whitespace-nowrap">الفاتورة</th>
                  </tr>
                </thead>
                <tbody>
                  {report.eligible.map((e) => (
                    <tr key={e.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 whitespace-normal break-words min-w-[160px] text-slate-800 dark:text-slate-200">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {e.description}
                          <SourceBadge source={e.source} />
                        </span>
                        <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                          {itemNameById.get(e.parentId) || '—'}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-300">{e.supplier}</td>
                      <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300" dir="ltr">{e.invoiceNumber}</td>
                      <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400">{formatDate(e.claimDate)}</td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(e.gross * s)}</td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(e.net * s)}</td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-emerald-700 dark:text-emerald-300">{formatCurrencyPrecise(e.tax * s)}</td>
                      <td className="py-3 px-4 whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">
                        {TAX_SOURCE_LABELS[e.taxSource] || e.taxSource || '—'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {isSafeHttpUrl(e.invoiceUrl) ? (
                          <a href={e.invoiceUrl} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary-700 dark:text-primary-300 hover:underline font-semibold text-[12px]"
                            title={e.invoiceUrl}>
                            <LinkIcon size={12} />
                            عرض
                          </a>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    <td colSpan={4} className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">الإجمالي</td>
                    <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(report.input.gross * s)}</td>
                    <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(report.input.net * s)}</td>
                    <td className="py-3 px-4 text-left font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">{formatCurrencyPrecise(inputTax)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        {/* ── فواتير مؤهلة بضريبة غير محدَّدة ─────────────────────
            These qualify on every field the deduction needs, but nobody can
            say what their VAT is: no amount on the paper, no rate of their
            own, and a date the policy record does not reach. Putting them in
            `eligible` with tax 0 would file a deduction of nothing and call it
            correct — a deductible tax vanishing in silence is exactly as bad
            as one appearing from nowhere. */}
        {report.unresolved.length > 0 && (
          <Card className="p-6">
            <SectionHeader
              title="فواتير بضريبة غير محدَّدة"
              subtitle="مؤهلة للخصم لكن مبلغ ضريبتها غير معروف — لم تُخصم ولم تُحتسب صفراً"
            />
            <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs px-4 py-3 rounded-control leading-relaxed mb-4">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <p>
                {formatNumber(report.unresolvedCount)} فاتورة بإجمالي{' '}
                {formatCurrency(report.unresolvedGross * s)}. أدخل مبلغ الضريبة المكتوب عليها
                أو نسبتها، أو هيّئ السجل التاريخي للسياسة الضريبية من «إقفال الفترة».
              </p>
            </div>
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">البند</th>
                    <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المبلغ</th>
                    <th className="py-3 px-4 whitespace-nowrap">السبب</th>
                  </tr>
                </thead>
                <tbody>
                  {report.unresolved.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                      <td className="py-3 px-4 whitespace-normal break-words min-w-[160px] text-slate-800 dark:text-slate-200">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {r.description}
                          <SourceBadge source={r.source} />
                        </span>
                        <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                          {itemNameById.get(r.parentId) || '—'}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400">
                        {r.claimDate ? formatDate(r.claimDate) : '—'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCurrency((Number(r.amount) || 0) * s)}
                      </td>
                      <td className="py-3 px-4 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                        {r.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── الفواتير غير المؤهلة ──────────────────────────────── */}
        {report.ineligible.length > 0 && (
          <Card className="p-6">
            <SectionHeader
              title="فواتير غير مؤهلة للخصم"
              subtitle="مستبعدة من الإقرار حتى تكتمل بياناتها — لكل صف ما ينقصه بالضبط"
            />
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">البند</th>
                    <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المبلغ</th>
                    <th className="py-3 px-4 whitespace-nowrap">الناقص</th>
                  </tr>
                </thead>
                <tbody>
                  {report.ineligible.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                      <td className="py-3 px-4 whitespace-normal break-words min-w-[160px] text-slate-800 dark:text-slate-200">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {r.description}
                          <SourceBadge source={r.source} />
                        </span>
                        <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                          {itemNameById.get(r.parentId) || '—'}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400">
                        {r.claimDate ? formatDate(r.claimDate) : <span className="text-amber-700 dark:text-amber-300 font-semibold">بلا تاريخ</span>}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCurrency((Number(r.amount) || 0) * s)}
                      </td>
                      <td className="py-3 px-4 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                        {r.missing.join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-3">
              المصروف المتكرر بلا تاريخ لا يُخصم: تكراره شهرياً لا يثبت استلام فاتورة عن كل شهر.
              ولّد له سنداً مؤرَّخاً لكل فترة من «إقفال الفترة ← سندات المصاريف المتكررة»،
              ثم أدخل رقم الفاتورة والمورّد.
            </p>
          </Card>
        )}
      </main>
    </>
  );
}
