import { useMemo, useState } from 'react';
import { Scale, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import AccountCode from './AccountCode';
import { accountDisplayName, isPartnerCapital } from '../lib/accountDisplay';
import ScrollableTable from './ScrollableTable';
import { formatCurrency, todayISO } from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, SecondaryButton } from './UI';
import DateField from './DateField';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { useLedger } from '../hooks/useLedger';
import { useTrialReconciliation } from '../hooks/useTrialReconciliation';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useTrialBalanceSums } from '../hooks/useTrialBalanceSums';
import { trialBalancePeriod, trialBalancePeriodFromSums, ledgerPeriodHref } from '../lib/trialBalanceView';
import { dataSource, isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';

const COST_REASONS = {
  'transferred-out': 'رواتب تخص شهرًا آخر', 'transferred-in': 'رواتب هذا الشهر رُحلت في شهر آخر',
  payroll: 'رواتب غير مرحلة', variable: 'مصاريف متغيرة غير مرحلة', monthly: 'مصاريف شهرية غير مرحلة',
  voucher: 'سندات غير مرحلة', annual: 'مصاريف سنوية غير مرحلة', other: 'مستندات أخرى', rounding: 'تقريب',
};
const cell = 'py-3 px-3 text-start whitespace-nowrap tabular-nums';
function SignedBalance({ amount }) {
  return <span dir="auto">{formatCurrency(Math.abs(amount))} <small>{amount > 0 ? 'مدين' : amount < 0 ? 'دائن' : ''}</small></span>;
}

function Reconciliation({ data, today }) {
  return <Card className="p-4 sm:p-6" id="subledger-reconciliation">
    <SectionHeader title="مطابقة الدفاتر الفرعية" subtitle={`الصفحات الحالية حتى ${today} — مستقلة عن فلتر حركة الفترة أعلاه`} />
    <p className="text-sm mb-4">فرق المطابقة = رقم الصفحة − رقم الدفتر. لا يسجل هذا القسم أي قيد.</p>
    <ScrollableTable className="overflow-x-auto"><table className="w-full min-w-[48rem] text-sm">
      <thead><tr>{['الحساب الرقابي', 'في الدفتر', 'في الصفحة', 'الفرق', 'أساس المقارنة'].map(label => <th className={cell} key={label}>{label}</th>)}</tr></thead>
      <tbody>{data.rows.map(row => <tr key={row.key} className="border-t border-slate-200 dark:border-slate-700">
        <th className={cell}><a className="text-primary-600 underline" href={row.href}>{row.label}</a><small className="block" dir="ltr">{row.code}</small></th>
        <td className={cell}>{formatCurrency(row.ledger)}</td>
        <td className={cell}>{row.page === null ? 'غير متاح' : formatCurrency(row.page)}</td>
        <td className={`${cell} ${row.difference ? 'text-amber-700 dark:text-amber-300 font-bold' : ''}`}>
          {row.difference === null ? (row.loading ? 'جارٍ التحميل...' : 'تعذر إكمال المطابقة') : formatCurrency(row.difference)}
        </td>
        <td className="p-3 min-w-64 max-w-md leading-relaxed">{row.note}{row.error && <span role="alert" className="block text-rose-600">تعذرت قراءة المصدر كاملًا؛ لا يمثل صفرًا.</span>}</td>
      </tr>)}</tbody>
    </table></ScrollableTable>
    <details className="mt-5 border-t pt-4 border-slate-200 dark:border-slate-700">
      <summary className="cursor-pointer font-bold">تفصيل مطابقة المصروفات حسب الشهر</summary>
      <ScrollableTable className="overflow-x-auto"><table className="w-full min-w-[44rem] text-sm mt-3">
        <thead><tr>{['الشهر', 'المرحل', 'قائمة الدخل', 'الفرق', 'تفسير الفرق'].map(label => <th key={label} className={cell}>{label}</th>)}</tr></thead>
        <tbody>{data.monthly.filter(row => row.error || row.costs?.posted || row.statement?.totalCosts).map(row => <tr key={row.month} className="border-t border-slate-200 dark:border-slate-700">
          <th className={cell}>{row.month}</th>
          {row.error ? <td colSpan={4} className="p-3 text-rose-600">تعذرت قراءة الشهر؛ لا يمثل صفرًا.</td> : <>
            <td className={cell}>{formatCurrency(row.costs.posted)}</td><td className={cell}>{formatCurrency(row.statement.totalCosts)}</td>
            <td className={cell}>{formatCurrency(row.costs.difference)}</td>
            <td className="p-3 min-w-72">{row.costs.rows.map(reason => <p key={reason.key}>{COST_REASONS[reason.key] || reason.key}: {formatCurrency(reason.amount)}</p>)}
              <p className={row.costs.unexplained ? 'text-rose-600' : ''}>فرق غير مفسّر: {formatCurrency(row.costs.unexplained)}</p></td>
          </>}
        </tr>)}</tbody>
      </table></ScrollableTable>
    </details>
  </Card>;
}

function usePeriodFilter(today) {
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`), [to, setTo] = useState(today);
  const [showAll, setShowAll] = useState(false);
  return { from, to, showAll, setFrom, setTo, setShowAll, invalidPeriod: Boolean(from && to && from > to) };
}

// ── Firebase: the journal is read and summed in the browser, as before ──
function JournalTrialBalance({ ledger, today, reconciliation }) {
  const filter = usePeriodFilter(today), { from, to, showAll } = filter;
  const { accounts, entries, lines } = ledger;
  const tb = useMemo(() => trialBalancePeriod(accounts, entries, lines, { from, to, showAll }), [accounts, entries, lines, from, to, showAll]);
  return <TrialBalanceContent filter={filter} tb={tb} today={today} loading={ledger.loading} error={ledger.error}
    needsSeeding={ledger.needsSeeding} refetch={ledger.refetch} reconciliation={reconciliation} />;
}

function StaffJournalTrialBalance({ ledger, today }) {
  const reconciliation = useTrialReconciliation(ledger, today);
  return <JournalTrialBalance ledger={ledger} today={today} reconciliation={reconciliation} />;
}

function FirebaseTrialBalance({ staff, today }) {
  const ledger = useLedger();
  return staff ? <StaffJournalTrialBalance ledger={ledger} today={today} /> : <JournalTrialBalance ledger={ledger} today={today} />;
}

// ── Supabase: the database sums the lines per account; only the chart is read ──
function OnDemandReconciliation({ today }) {
  const ledger = useLedger();
  const data = useTrialReconciliation(ledger, today);
  if (ledger.loading) return <Card className="p-4 sm:p-6" id="subledger-reconciliation"><LoadingState message="جارٍ تحميل القيود للمطابقة..." /></Card>;
  if (ledger.error) return <ErrorState title="تعذّر تحميل القيود للمطابقة" error={ledger.error} onRetry={ledger.refetch} />;
  return <Reconciliation data={data} today={today} />;
}

function ReconciliationOnRequest({ today }) {
  const [open, setOpen] = useState(false);
  if (open) return <OnDemandReconciliation today={today} />;
  return <Card className="p-4 sm:p-6" id="subledger-reconciliation">
    <SectionHeader title="مطابقة الدفاتر الفرعية" subtitle="تُحمَّل عند الطلب" />
    <p className="text-sm mb-3">الأرصدة أعلاه تجمعها قاعدة البيانات. المطابقة مع الصفحات تحتاج تفاصيل القيود كلها، فلا تُحمَّل إلا عند طلبها. لا تسجل أي قيد.</p>
    <SecondaryButton onClick={() => setOpen(true)}>تحميل المطابقة</SecondaryButton>
  </Card>;
}

function DatabaseTrialBalance({ staff, today }) {
  const chart = useLedger({ journal: false });
  const filter = usePeriodFilter(today), { from, to, showAll, invalidPeriod } = filter;
  const sums = useTrialBalanceSums({ from, to, enabled: isFirebaseConfigured && !invalidPeriod });
  const { accounts } = chart, data = sums.data;
  const tb = useMemo(() => trialBalancePeriodFromSums(accounts, data || {}, { from, showAll }), [accounts, data, from, showAll]);
  const { refetch: refetchChart } = chart, { refetch: refetchSums } = sums;
  return <TrialBalanceContent filter={filter} tb={tb} today={today} loading={chart.loading || sums.loading} error={chart.error || sums.error}
    needsSeeding={chart.needsSeeding} refetch={() => { refetchChart(); refetchSums(); }}
    reconciliationSlot={staff ? <ReconciliationOnRequest today={today} /> : null} />;
}

export default function TrialBalancePage() {
  const { role, isPartnerView } = usePartnerView();
  const today = todayISO();
  const staff = !isPartnerView && ['admin', 'accountant'].includes(role);
  return dataSource === 'supabase' ? <DatabaseTrialBalance staff={staff} today={today} /> : <FirebaseTrialBalance staff={staff} today={today} />;
}

function TrialBalanceContent({ filter, tb, today, loading, error, needsSeeding, refetch, reconciliation, reconciliationSlot }) {
  const { from, to, showAll, setFrom, setTo, setShowAll, invalidPeriod } = filter;
  function handleExport() {
    downloadCsv(`ميزان-المراجعة-${from}-${to}`, ['رقم الحساب', 'اسم الحساب', 'النوع', 'رصيد أول الفترة مدين ناقص دائن', 'حركة مدين', 'حركة دائن', 'رصيد آخر الفترة مدين ناقص دائن'],
      tb.rows.map(row => [row.code, row.nameArabic, row.accountType, row.openingSigned, row.debit, row.credit, row.closingSigned]));
  }
  return <>
    <TopBar title="ميزان المراجعة" subtitle="رصيد أول الفترة وحركتها ورصيد آخرها — من القيود المرحّلة" />
    <main className="p-4 sm:p-6 lg:p-8 space-y-6">
      {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
      {error && <ErrorState title="تعذّر تحميل ميزان المراجعة" error={error} onRetry={refetch} />}
      {needsSeeding && <p role="alert">لم تتم تهيئة دليل الحسابات بعد.</p>}
      <Card className="p-4"><div className="grid sm:grid-cols-2 gap-4">
        <div><label className="block mb-2">من تاريخ</label><DateField name="from" value={from} onChange={event => setFrom(event.target.value)} ariaLabel="من تاريخ" /></div>
        <div><label className="block mb-2">إلى تاريخ</label><DateField name="to" value={to} onChange={event => setTo(event.target.value)} ariaLabel="إلى تاريخ" /></div>
      </div><label className="flex gap-2 mt-4"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />عرض كل الحسابات</label>
        <p className="text-xs mt-2">يشمل الحسابات بلا حركة، مثل مجمع الإهلاك والذمم المدينة.</p>
      </Card>
      {invalidPeriod ? <p role="alert" className="text-rose-600">تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.</p> : loading ? <LoadingState message="جارٍ حساب الأرصدة..." /> : !error && <>
        <Card className={`p-4 ${tb.balanced ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
          <p role={tb.balanced ? 'status' : 'alert'} className="font-bold">{tb.balanced ? 'الميزان متوازن' : 'الميزان غير متوازن'} · فرق الحركة: {formatCurrency(tb.difference)}</p>
          {reconciliation && <p className="text-sm mt-2 text-slate-700 dark:text-slate-300"><a href="#subledger-reconciliation" className="underline">متوازن ما يعني مطابق: {reconciliation.differences} فروقات مع الصفحات</a>
            {reconciliation.unavailable > 0 && <span> · {reconciliation.unavailable} مطابقات لم تكتمل قراءتها</span>}</p>}
          {reconciliationSlot && <p className="text-sm mt-2 text-slate-700 dark:text-slate-300"><a href="#subledger-reconciliation" className="underline">متوازن ما يعني مطابق: مطابقة الدفاتر الفرعية أسفل الصفحة</a></p>}
        </Card>
        {tb.abnormalRows.length > 0 && <div role="alert" className="rounded-control p-4 bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"><strong>رصيد غير طبيعي</strong>
          {tb.abnormalRows.map(row => <p key={row.code}><a className="underline" href={ledgerPeriodHref(row.code, from, to)}>{accountDisplayName(row)}</a>: {formatCurrency(row.balance)}</p>)}</div>}
        <div className="grid sm:grid-cols-3 gap-4">
          <StatCard icon={Scale} label="حركة الفترة — مدين" value={formatCurrency(tb.totalDebit)} />
          <StatCard icon={Scale} label="حركة الفترة — دائن" value={formatCurrency(tb.totalCredit)} />
          <StatCard icon={tb.result < 0 ? AlertTriangle : CheckCircle2} tone={tb.result < 0 ? 'rose' : 'emerald'} label="نتيجة الفترة" value={formatCurrency(tb.result)} sub="من إيرادات ومصروفات الدفتر، وليست النتيجة التشغيلية" />
        </div>
        {tb.unknownAccounts.length > 0 && <p role="alert">حسابات مستخدمة خارج الدليل: {tb.unknownAccounts.join('، ')}</p>}
        <Card className="p-4 sm:p-6"><SectionHeader title="أرصدة الحسابات" subtitle={`${from || 'أول حركة'} — ${to || 'آخر حركة'}`} action={<SecondaryButton icon={Download} onClick={handleExport}>تصدير CSV</SecondaryButton>} />
          <ScrollableTable className="overflow-x-auto"><table className="w-full min-w-[52rem] text-sm">
            <thead><tr>{['الحساب', 'اسم الحساب', 'رصيد أول الفترة', 'حركة الفترة — مدين', 'حركة الفترة — دائن', 'رصيد آخر الفترة'].map(label => <th className={cell} key={label}>{label}</th>)}</tr></thead>
            {tb.groups.map(group => <tbody key={group.type}>
              <tr className="bg-slate-100 dark:bg-slate-800"><th className={cell} colSpan={2}>{group.label}</th>
                <td className={cell}><SignedBalance amount={group.openingSigned} /></td><td className={cell}>{formatCurrency(group.debit)}</td><td className={cell}>{formatCurrency(group.credit)}</td><td className={cell}><SignedBalance amount={group.closingSigned} /></td></tr>
              {group.rows.map(row => <tr key={row.code} className={`border-t border-slate-100 dark:border-slate-800 ${row.abnormal ? 'text-rose-700 dark:text-rose-300' : ''}`}>
                <td className={cell}>{!isPartnerCapital(row) && <a href={ledgerPeriodHref(row.code, from, to)}><AccountCode code={row.code} /></a>}</td>
                <th className="p-3 text-start min-w-44"><a href={ledgerPeriodHref(row.code, from, to)} className="underline">{accountDisplayName(row)}</a>{!row.hasMovement && <small className="block">بلا حركة</small>}{row.abnormal && <small className="block font-bold">رصيد غير طبيعي</small>}</th>
                <td className={cell}><SignedBalance amount={row.openingSigned} /></td><td className={cell}>{formatCurrency(row.debit)}</td><td className={cell}>{formatCurrency(row.credit)}</td><td className={cell}><SignedBalance amount={row.closingSigned} /></td>
              </tr>)}
            </tbody>)}
            <tfoot><tr className="font-bold border-t"><th className={cell} colSpan={2}>الإجمالي</th><td className={cell}>{formatCurrency(tb.openingDebit)} مدين<br />{formatCurrency(tb.openingCredit)} دائن</td><td className={cell}>{formatCurrency(tb.totalDebit)}</td><td className={cell}>{formatCurrency(tb.totalCredit)}</td><td className={cell}>{formatCurrency(tb.closingDebit)} مدين<br />{formatCurrency(tb.closingCredit)} دائن</td></tr>
              <tr><th className={cell} colSpan={5}>نتيجة الفترة</th><td className={`${cell} ${tb.result < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatCurrency(tb.result)}</td></tr></tfoot>
          </table></ScrollableTable>
        </Card>
      </>}
      {reconciliation && !error && !loading && <Reconciliation data={reconciliation} today={today} />}
      {reconciliationSlot && !error && !loading && !invalidPeriod && reconciliationSlot}
    </main>
  </>;
}
