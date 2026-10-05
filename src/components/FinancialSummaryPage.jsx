import { getLocale } from '../i18n/locale';
import { useLanguage } from '../i18n/useLanguage';
import { useBikers } from '../hooks/useBikers';
import { displayRecordedBikerName } from '../lib/bikerNames';
import { useMemo, useState } from 'react';
import {
  Wallet, TrendingDown, TrendingUp, Calendar, ListFilter, Download, Scale,
} from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, SecondaryButton } from './UI';
import LoadingState from './LoadingState';
import StatementRow from './statement/StatementRow';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import FinancialDetailsModal from './FinancialDetailsModal';
import IncomeStatementDetailsModal from './IncomeStatementDetailsModal';
import { LineTrend } from './charts/TrendCharts';
import { useWashes } from '../hooks/useWashes';
import { useVariableExpenses } from '../hooks/useVariableExpenses';
import { useMonthlyExpenses } from '../hooks/useMonthlyExpenses';
import { useAnnualExpenses } from '../hooks/useAnnualExpenses';
import { useLedger } from '../hooks/useLedger';
import { useFeeRules } from '../hooks/useFeeRules';
import { useAccountingSettings } from '../hooks/useAccountingSettings';
import {
  operationalWashSales, reconcileOperational,
} from '../lib/accounting/monthlyStatement';
import { isLiveSourceEntry } from '../lib/accounting/firestoreLedger';
import { taxPolicyAt } from '../lib/accounting/taxPolicy';
import { usePartnerView } from '../contexts/PartnerViewContext';
import {
  todayMonth, monthOf,
  formatMonthLabel,
  listAvailableMonths,
} from '../lib/variableExpenseTotals';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import { liveIncomeStatement } from '../lib/accounting/liveIncomeStatement';
import { useIncomeStatementSources } from '../hooks/useIncomeStatementSources';
import { mapWash } from '../lib/mappers';
import { payrollExpensePeriod } from '../lib/accounting/payrollExpensePeriod';

export default function FinancialSummaryPage() {
  const { language } = useLanguage();
  const { bikers } = useBikers();
  const { items: initialWashes, loading: washesLoading, error: washesError, refetch: refetchWashes } = useWashes();
  const { items: variables, loading: varLoading,      error: varError,      refetch: refetchVariables } = useVariableExpenses();
  const { items: monthlies, loading: monthlyLoading,  error: monthlyError,  refetch: refetchMonthly }  = useMonthlyExpenses();
  const { items: annuals,   loading: annualLoading,   error: annualError,   refetch: refetchAnnual }   = useAnnualExpenses();
  // ── the statement's actual source ──
  // The chart classifies posted and registered operational contributions.
  const {
    accounts,
    loading: ledgerLoading, error: ledgerError, refetch: refetchLedger,
  } = useLedger();
  const live = useIncomeStatementSources();
  const { sources, entries, lines } = live;
  const washes = useMemo(() => isFirebaseConfigured ? sources.washes.map(mapWash) : initialWashes, [sources.washes, initialWashes]);
  const { rules: feeRules } = useFeeRules();
  // The same two switches the wash poster reads. Without them the operational
  // side would be compared gross against a net statement, and VAT alone would
  // read as a posting gap.
  const { settings } = useAccountingSettings();
  // isPartnerView also gates the drill-down modal: its rows are the RAW
  // company-level records (each row IS what it is — a 200 ر.س wash can't
  // honestly display as 72 ر.س), so opening it under a scaled headline
  // would both contradict the statement and leak full-company figures to
  // a partner. Partners get the scaled statement only.
  const { scalingFactor, isPartnerView, role } = usePartnerView();
  const canReadDetails = !isPartnerView && role !== 'supervisor';

  const [selectedMonth, setSelectedMonth] = useState(todayMonth());
  const [detailCategory, setDetailCategory] = useState(null);
  const [statementDetail, setStatementDetail] = useState(null);
  const openStatementDetail = key => canReadDetails ? () => setStatementDetail({ key, month: selectedMonth }) : undefined;

  // Every month the statement could have something to say about. The ledger is
  // included alongside the operational registers: a standalone sales invoice
  // posts into a month that may hold no wash at all, and a month you cannot
  // select is a month whose figures nobody can read.
  const availableMonths = useMemo(() => {
    const set = new Set(listAvailableMonths(washes, variables).filter((key) => key !== '__invalid__'));
    const byEntry = new Map(entries.map(entry => [entry.id, entry]));
    for (const e of entries) {
      const key = String(e.periodKey || String(e.entryDate || '').slice(0, 7));
      if (/^\d{4}-\d{2}$/.test(key)) set.add(key);
      const payrollPeriod = payrollExpensePeriod(e, byEntry);
      if (payrollPeriod) set.add(payrollPeriod.periodKey);
    }
    for (const row of [...sources.variables, ...sources.monthlies, ...sources.annualEntries, ...sources.vouchers]) {
      const month = monthOf(row.invoice_date || row.invoiceDate || row.logged_date || row.spent_date || row.dueDate);
      if (month) set.add(month);
    }
    return [...set].sort().reverse();
  }, [washes, variables, entries, sources]);

  // ── the statement itself ──────────────────────────────────────────────
  // One pure function over the live sources. Pro-rata for the partner view is
  // applied inside it, once, because every line is linear in that factor.
  const statement = useMemo(
    () => liveIncomeStatement({
      accounts, entries, lines, periodKey: selectedMonth, feeRules, scalingFactor,
      sources, policyAt: date => taxPolicyAt(date, settings),
    }),
    [accounts, entries, lines, selectedMonth, feeRules, scalingFactor, sources, settings],
  );

  const netRevenue          = statement.netRevenue;
  const variableTotal       = statement.directCosts;
  const fixedExpensesTotal  = statement.operatingExpenses;
  const totalCosts          = statement.totalCosts;
  const grossProfit         = statement.grossProfit;
  const netProfitBeforeFees = statement.netProfitBeforeFees;
  const finalNetProfit      = statement.netProfit;
  const isProfit            = finalNetProfit >= 0;

  const monthLabel = formatMonthLabel(selectedMonth);

  // The tax rules in force in the month being viewed, not the ones in force
  // today — said out loud, because it is the difference between a reconciled
  // month and a phantom gap.

  // ── مطابقة التشغيل بالدفاتر ──
  // Both answers side by side, with every explainable part named. Only the
  // unexplained remainder is a discrepancy — an unposted wash and a credit
  // note are both accounted for, and neither is a "missing posting".
  // The live wash entry per source id — so a posted wash reports the figures
  // its own entry froze rather than a re-derivation under today's switches.
  const washEntryBySource = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      if (!isLiveSourceEntry(e, 'wash', 'wash')) continue;
      m.set(String(e.sourceId ?? ''), e);
    }
    return m;
  }, [entries]);

  const reconciliation = useMemo(() => {
    const operational = operationalWashSales(washes, {
      periodKey: selectedMonth,
      // Unposted washes only: the rules that were in force on THEIR date.
      policyAt: (date) => taxPolicyAt(date, settings),
      isPosted: (w) => washEntryBySource.has(String(w.id)),
      postedEntryOf: (w) => washEntryBySource.get(String(w.id)),
    });
    return reconcileOperational({ operational, statement: { ...statement, netRevenue: statement.ledgerNetRevenue }, entries, lines, scalingFactor });
  }, [washes, selectedMonth, settings, washEntryBySource, entries, lines, statement, scalingFactor]);

  // ── 6-month trend ending at the selected month ────────────────────────
  // The SAME function, run six times, so the chart cannot disagree with the
  // statement above it.
  const trend = useMemo(() => {
    const [yy, mm] = selectedMonth.split('-').map(Number);
    if (!yy || !mm) return null;
    const fmt = new Intl.DateTimeFormat(getLocale(language), { month: 'short', numberingSystem: 'latn' });
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(yy, mm - 1 - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: fmt.format(d),
      });
    }
    const rows = months.map(({ key }) => liveIncomeStatement({
      accounts, entries, lines, periodKey: key, feeRules, scalingFactor,
      sources, policyAt: date => taxPolicyAt(date, settings),
    }));
    return {
      months,
      revenue: rows.map((r) => r.netRevenue),
      costs:   rows.map((r) => r.totalCosts),
      net:     rows.map((r) => r.netProfit),
      any:     rows.some((r) => r.netRevenue !== 0 || r.totalCosts !== 0),
    };
  }, [selectedMonth, accounts, entries, lines, feeRules, scalingFactor, language, sources, settings]);

  const anyError    = live.error || ledgerError || washesError || varError || monthlyError || annualError;
  const anyLoading  = live.loading || ledgerLoading || washesLoading || varLoading || monthlyLoading || annualLoading;
  const noData      = !entries.length && !washes.length && !variables.length && !monthlies.length && !annuals.length;

  function retryAll() {
    live.refetch();
    refetchLedger?.();
    refetchWashes?.();
    refetchVariables?.();
    refetchMonthly?.();
    refetchAnnual?.();
  }

  // Recorded expense detail uses the same source contribution as the statement.
  const detailData = useMemo(() => {
    const revenue = washes.filter(w => w.status === 'مكتملة' && monthOf(w.washDate) === selectedMonth).map(w => {
      const split = operationalWashSales([w], { periodKey: selectedMonth,
        policyAt: date => taxPolicyAt(date, settings), isPosted: row => washEntryBySource.has(String(row.id)),
        postedEntryOf: row => washEntryBySource.get(String(row.id)) });
      return { id: w.id, date: w.washDate, biker: displayRecordedBikerName(w, bikers, language),
        quantity: w.quantity, price: w.quantity ? split.net / w.quantity : 0, total: split.net };
    });
    const group = key => statement.expenseBreakdown?.groups.find(row => row.key === key)?.items || [];
    const variable = group('variable').map(row => ({ id: row.id, name: row.description, category: row.accountName,
      quantity: 1, unitCost: row.rawAmount, total: row.rawAmount }));
    const monthly = group('monthly').map(row => ({ id: row.id, name: row.description, category: row.accountName,
      amount: row.rawAmount }));
    const annual = group('annual').map(row => ({ id: row.id, name: row.description, date: row.entryDate, amount: row.rawAmount }));
    return { revenue, variable, monthly, annual };
  }, [washes, selectedMonth, settings, washEntryBySource, bikers, language, statement]);

  return (
    <>
      <TopBar
        title="قائمة الدخل الشهرية"
        subtitle="عرض محاسبي للإيرادات والتكاليف وصافي الربح وفق فترة شهرية محددة"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {anyError && (
          <ErrorState
            title="تعذّر تحميل بعض البيانات المالية"
            error={anyError}
            onRetry={retryAll}
          />
        )}

        {/* ── Period selector ─────────────────────────────────────── */}
        <div
          className="rounded-card border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-5 transition-colors duration-200"
          style={{ boxShadow: 'var(--sw-shadow-card)' }}
        >
          <div className="flex items-start gap-4">
            <div className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-12 h-12 rounded-control flex items-center justify-center shrink-0">
              <Calendar size={22} strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0">
              <label
                htmlFor="period-selector"
                className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                فترة التقرير (الشهر)
              </label>
              <select
                id="period-selector"
                value={selectedMonth}
                onChange={(e) => { setSelectedMonth(e.target.value); setStatementDetail(null); setDetailCategory(null); }}
                className="w-full max-w-xs px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-bold tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
              >
                {availableMonths.map((ym) => (
                  <option key={ym} value={ym}>{formatMonthLabel(ym)}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                اختر الشهر؛ الرواتب حسب فترة الاستحقاق، وبقية المصروفات حسب تاريخ تسجيلها وتصنيفها، دون إدراج ميزانيات أو مشتريات رأسمالية كمصروف تشغيلي.
              </p>
            </div>
          </div>
        </div>

        {(washes.some((row) => !monthOf(row.washDate)) || variables.some((row) => !monthOf(row.loggedDate))) && <p role="status" className="text-sm text-amber-800 dark:text-amber-300">توجد سجلات تشغيل بتواريخ غير صالحة أو مفقودة لا يمكن إسنادها إلى شهر. راجع مجموعة التواريخ غير الصالحة في المصاريف المتغيرة وسجل الغسلات؛ لم تُحذف هذه السجلات.</p>}
        {anyLoading && noData ? (
          <LoadingState rows={4} />
        ) : (
          <>
            {/* ── Top 3 KPI cards ─────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
              <StatCard
                className="col-span-2 md:col-span-1"
                icon={Wallet}
                tone="primary"
                label="صافي الإيرادات"
                value={formatCurrency(netRevenue)}
                sub={statement.salesReturns > 0
                  ? `بعد خصم مردودات بقيمة ${formatCurrency(statement.salesReturns)} لشهر ${monthLabel}`
                  : `إيرادات مسجلة لشهر ${monthLabel}`}
              />
              <StatCard
                icon={TrendingDown}
                tone="slate"
                label="إجمالي تكاليف الشهر"
                value={formatCurrency(totalCosts)}
                sub="تكاليف مباشرة + مصاريف تشغيلية مسجلة"
              />
              <StatCard
                icon={isProfit ? TrendingUp : TrendingDown}
                tone={isProfit ? 'emerald' : 'rose'}
                label="صافي نتيجة الشركة بعد الرسوم"
                value={`${isProfit ? '' : '−'}${formatCurrency(Math.abs(finalNetProfit))}`}
                sub={statement.fees.length
                  ? `بعد خصم ${statement.fees.map((f) => f.label).join(' و')}`
                  : 'بلا رسوم مُعرَّفة'}
              />
            </div>

            {/* ── مطابقة التشغيل بالدفاتر ───────────────────────────
                Six named lines, not one subtraction. The old strip took the
                operational total (gross, VAT included) away from the ledger's
                net revenue and called the whole remainder "unposted washes" —
                so a perfectly reconciled month showed a difference equal to
                its output tax, and a credit note was reported as a missing
                posting. Here every part that CAN be explained is named, and
                only what is left over is called a discrepancy. */}
            {!reconciliation.clean && (
              <Card className="p-6">
                <SectionHeader
                  title="مطابقة سجل التشغيل بالدفاتر"
                  subtitle={reconciliation.matched
                    ? 'الفرق مفسَّر بالكامل — لا يوجد اختلاف غير معروف السبب'
                    : 'يوجد فرق غير مفسَّر — راجعه قبل اعتماد الشهر'}
                />
                <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
                  <table className="w-full min-w-[560px] text-sm">
                    <tbody>
                      {[
                        ['أ', 'صافي المبيعات التشغيلية (غسلات مكتملة، بعد استبعاد الضريبة)',
                          reconciliation.operationalNet,
                          `${reconciliation.washCount} غسلة · إجمالي ${formatCurrency(reconciliation.operationalGross)}`
                            + (reconciliation.operationalVat > 0
                              ? ` منها ضريبة ${formatCurrency(reconciliation.operationalVat)}` : '')],
                        ['ب', 'إيرادات الغسلات المُرحّلة في الدفاتر',
                          reconciliation.postedWashNet, 'حساب 4000 من قيود مصدرها غسلة'],
                        ['ج', 'غسلات مكتملة غير مُرحّلة',
                          reconciliation.unpostedNet,
                          reconciliation.unpostedCount
                            ? `${reconciliation.unpostedCount} غسلة — تظهر في القائمة فور التسجيل`
                            : 'لا يوجد'],
                        ['د', 'مردودات المبيعات (إشعارات دائنة)',
                          reconciliation.salesReturns, 'تخفض الدفاتر ولا تمسّ سجل الغسلات'],
                        ['هـ', 'إيرادات أخرى مُرحّلة',
                          reconciliation.otherRevenue, 'فواتير بيع مستقلة · إشعارات مدينة · إيرادات غير تشغيلية'],
                        ['و', 'فرق غير مفسَّر',
                          reconciliation.unexplained, 'أ − ب − ج'],
                      ].map(([key, label, amount, hint]) => {
                        const isGap = key === 'و';
                        const bad = isGap && Math.abs(amount) >= 0.005;
                        return (
                          <tr
                            key={key}
                            className={isGap
                              ? `border-t-2 ${bad
                                ? 'border-rose-100 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30'
                                : 'border-emerald-100 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30'}`
                              : 'border-b border-slate-50 dark:border-slate-800/60'}
                          >
                            <td className="py-3 px-4 align-top w-8 text-slate-500 dark:text-slate-400 font-bold">{key})</td>
                            <td className="py-3 px-4">
                              <span className={`block ${isGap ? 'font-bold' : ''} text-slate-800 dark:text-slate-200`}>{label}</span>
                              <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</span>
                            </td>
                            <td className={`py-3 px-4 text-left whitespace-nowrap tabular-nums font-bold ${
                              bad ? 'text-rose-700 dark:text-rose-400'
                                : isGap ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-900 dark:text-slate-100'}`}
                            >
                              {formatCurrency(amount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
                  <Scale size={14} className="shrink-0 mt-0.5" />
                  <span>
                    القائمة تشمل المسجل غير المرحّل، والمقارنة على الصافي دون الضريبة.
                  </span>
                </p>
              </Card>
            )}

            {/* ── Vertical Income Statement table ─────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title={`هيكل قائمة الدخل — ${monthLabel}`}
                subtitle="تتحدث من التسجيل؛ المصادر المرحّلة تُحتسب مرة واحدة، والضريبة مستبعدة من الإيراد"
                action={
                  <SecondaryButton
                    icon={Download}
                    onClick={() => downloadCsv(
                      `قائمة-الدخل-${selectedMonth}`,
                      ['البند', 'المبلغ'],
                      // Mirrors the on-screen statement line-for-line, off the
                      // same `statement` object — the screen and the file can
                      // only ever show the same number. Amounts are passed as
                      // numbers so the CSV layer's formula-injection guard
                      // (text-only) leaves them intact.
                      [
                        ['إيرادات المبيعات', Number(statement.grossRevenue.toFixed(2))],
                        ['يُخصم منه: مردودات وخصومات المبيعات', Number((-statement.salesReturns).toFixed(2))],
                        ...(statement.otherRevenue !== 0
                          ? [['إيرادات أخرى', Number(statement.otherRevenue.toFixed(2))]] : []),
                        ['صافي الإيرادات', Number(netRevenue.toFixed(2))],
                        ['التكاليف المباشرة والعمولات', Number((-variableTotal).toFixed(2))],
                        ['مجمل الربح التشغيلي', Number(grossProfit.toFixed(2))],
                        ['المصاريف التشغيلية', Number((-fixedExpensesTotal).toFixed(2))],
                        ['صافي الربح قبل الرسوم', Number(netProfitBeforeFees.toFixed(2))],
                        ...statement.fees.map((f) => [f.label, Number((-f.amount).toFixed(2))]),
                        ['صافي نتيجة الشركة بعد الرسوم', Number(finalNetProfit.toFixed(2))],
                      ],
                    )}
                  >
                    تصدير CSV
                  </SecondaryButton>
                }
              />
              <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                      <th className="py-3 px-4 whitespace-nowrap">البند</th>
                      <th className="py-3 px-4 whitespace-nowrap text-left">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Details follow the exact accepted calculation sources. */}
                    <StatementRow
                      label="إيرادات المبيعات"
                      amount={statement.grossRevenue}
                      onClick={openStatementDetail('grossRevenue')}
                      kind="plus"
                    />
                    {/* Shown only when there are returns — but shown on its own
                        line when there are, because netting a credit note into
                        the revenue figure is what hid it in the first place. */}
                    {statement.salesReturns !== 0 && (
                      <StatementRow
                        label="يُخصم منه: مردودات وخصومات المبيعات (إشعارات دائنة)"
                        amount={statement.salesReturns}
                        onClick={openStatementDetail('salesReturns')}
                        kind="minus"
                      />
                    )}
                    {statement.otherRevenue !== 0 && (
                      <StatementRow
                        label="إيرادات أخرى"
                        amount={statement.otherRevenue}
                        onClick={openStatementDetail('otherRevenue')}
                        kind="plus"
                      />
                    )}
                    <StatementRow
                      label="= صافي الإيرادات"
                      amount={netRevenue}
                      onClick={openStatementDetail('netRevenue')}
                      kind="subtotal"
                    />
                    <StatementRow
                      label="يُخصم منه: التكاليف المباشرة والعمولات"
                      amount={variableTotal}
                      onClick={openStatementDetail('directCosts')}
                      kind="minus"
                    />
                    <StatementRow
                      label="= مجمل الربح التشغيلي"
                      amount={grossProfit}
                      onClick={openStatementDetail('grossProfit')}
                      kind="subtotal"
                    />
                    <StatementRow
                      label="يُخصم منه: المصاريف التشغيلية"
                      amount={fixedExpensesTotal}
                      onClick={openStatementDetail('operatingExpenses')}
                      kind="expenseSubtotal"
                    />
                    <StatementRow
                      label="= صافي الربح قبل الرسوم"
                      amount={netProfitBeforeFees}
                      onClick={openStatementDetail('netProfitBeforeFees')}
                      kind="subtotal"
                    />
                    {statement.fees.map((f) => (
                      <StatementRow
                        key={f.key}
                        label={`يُخصم منه: ${f.label}`}
                        amount={f.amount}
                        onClick={openStatementDetail(`fee:${f.key}`)}
                        kind="minus"
                      />
                    ))}
                    <StatementRow
                      label="= صافي نتيجة الشركة بعد الرسوم"
                      amount={finalNetProfit}
                      onClick={openStatementDetail('netProfit')}
                      kind="final"
                    />
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
                {canReadDetails && 'اضغط على المبلغ أو البند لعرض مكوناته ومصادره. '}
                مصروف الرواتب يتبع فترة الاستحقاق المحفوظة بالمسير؛ تاريخ الدفع وحركة النقد في الدفتر يبقيان في تاريخ الصرف الفعلي.
              </p>
              {(statement.costRows.length > 0 || statement.expenseRows.length > 0) && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
                  التكاليف والمصاريف أعلاه مجمّعة من حسابات:
                  {' '}
                  {[...statement.costRows, ...statement.expenseRows]
                    .map((r) => `${r.code} ${r.nameArabic || r.name || ''}`.trim()).join(' · ')}.
                </p>
              )}

              {/* ── التفاصيل التشغيلية ─────────────────────────────────
                  Deliberately separated from the statement above and labelled
                  as what it is. These lists are the operational registers, not
                  the ledger: a wash typed in but not posted appears here and
                  not there, and a credit note appears there and not here. That
                  gap is the point of the reconciliation, so the two are never
                  presented as the same figure. */}
              {canReadDetails && (
                <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2">
                    تفاصيل تشغيلية للمطابقة — سجلات مُدخَلة، وليست أرقام القائمة أعلاه
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ['revenue',  'الغسلات المكتملة'],
                      ['variable', 'التكاليف المتغيرة'],
                      ['monthly',  'المصاريف الشهرية'],
                      ['annual',   'المصاريف السنوية'],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDetailCategory(key)}
                        className="inline-flex items-center gap-1.5 min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-primary-700 dark:hover:text-primary-400 hover:border-primary-200 dark:hover:border-primary-500/40 transition-colors"
                      >
                        <ListFilter size={13} strokeWidth={2.2} aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* ── 6-month trend ─────────────────────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title="اتجاه ٦ أشهر"
                subtitle={`الإيرادات مقابل التكاليف وصافي الربح حتى ${monthLabel}`}
              />
              {trend?.any ? (
                <LineTrend
                  months={trend.months}
                  formatValue={formatCurrency}
                  series={[
                    {
                      id: 'revenue',
                      label: 'الإيرادات',
                      values: trend.revenue,
                      stroke: 'stroke-[#4f46e5] dark:stroke-[#6366f1]',
                      dot:    'fill-[#4f46e5] dark:fill-[#6366f1]',
                      swatch: 'bg-[#4f46e5] dark:bg-[#6366f1]',
                    },
                    {
                      id: 'costs',
                      label: 'التكاليف',
                      values: trend.costs,
                      stroke: 'stroke-[#e63946]',
                      dot:    'fill-[#e63946]',
                      swatch: 'bg-[#e63946]',
                    },
                    {
                      id: 'net',
                      label: 'صافي الربح',
                      values: trend.net,
                      stroke: 'stroke-[#059669]',
                      dot:    'fill-[#059669]',
                      swatch: 'bg-[#059669]',
                    },
                  ]}
                />
              ) : (
                <EmptyState
                  compact
                  icon={TrendingUp}
                  title="لا توجد حركة مالية في آخر ٦ أشهر"
                  hint="سجّل الغسلات والمصاريف وسيظهر الاتجاه الشهري هنا تلقائياً."
                />
              )}
            </Card>
          </>
        )}
      </main>

      {canReadDetails && <FinancialDetailsModal
        category={detailCategory}
        monthLabel={monthLabel}
        data={detailData}
        onClose={() => setDetailCategory(null)}
      />}
      {canReadDetails && !anyLoading && statementDetail?.month === selectedMonth && (
        <IncomeStatementDetailsModal
          key={`${selectedMonth}:${statementDetail.key}`}
          statement={statement}
          detailKey={statementDetail.key}
          onSelect={key => setStatementDetail({ key, month: selectedMonth })}
          onPeriodSelect={(month, key) => { setSelectedMonth(month); setStatementDetail({ key, month }); setDetailCategory(null); }}
          onClose={() => setStatementDetail(null)}
        />
      )}
    </>
  );
}
