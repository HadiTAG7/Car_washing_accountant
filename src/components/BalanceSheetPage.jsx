import { Fragment, useMemo, useState } from 'react';
import { Landmark, Download, ChevronDown } from 'lucide-react';
import { formatCurrency, todayISO } from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, SecondaryButton } from './UI';
import ScrollableTable from './ScrollableTable';
import DateField from './DateField';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { useLedger } from '../hooks/useLedger';
import { useFeeRules } from '../hooks/useFeeRules';
import { useBalanceAssetSources } from '../hooks/useBalanceAssetSources';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { balanceSheetPresentation, comparisonRows, previousMonthEnd } from '../lib/balanceSheetView';
import { ledgerPeriodHref } from '../lib/trialBalanceView';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import BalanceSheetUnposted from './BalanceSheetUnposted';

const SECTIONS = [
  ['currentAssets', 'الأصول المتداولة'], ['noncurrentAssets', 'الأصول غير المتداولة'],
  ['unclassifiedAssets', 'أصول لم يُحدد تصنيف أجلها'],
  ['currentLiabilities', 'الالتزامات المتداولة'], ['noncurrentLiabilities', 'الالتزامات غير المتداولة'],
  ['unclassifiedLiabilities', 'التزامات لم يُحدد أجل استحقاقها'], ['equity', 'حقوق الملكية'],
];
const numeric = 'p-3 text-start whitespace-nowrap tabular-nums';
function StaffBalanceSheet(props) {
  const assetSources = useBalanceAssetSources();
  return <BalanceSheetContent {...props} assetSources={assetSources} staff />;
}
export default function BalanceSheetPage() {
  const ledger = useLedger(), fees = useFeeRules();
  const { role, isPartnerView } = usePartnerView();
  const props = { ledger, fees };
  return !isPartnerView && ['admin', 'accountant'].includes(role)
    ? <StaffBalanceSheet {...props} /> : <BalanceSheetContent {...props} />;
}

function BalanceSheetContent({ ledger, fees, assetSources, staff = false }) {
  const today = todayISO();
  const [asOf, setAsOf] = useState(today), [compareDate, setCompareDate] = useState(previousMonthEnd(today));
  const [expanded, setExpanded] = useState({});
  const date = asOf || today, comparisonDate = compareDate || previousMonthEnd(date);
  const current = useMemo(() => balanceSheetPresentation({ ...ledger, ...assetSources, asOf: date, feeRules: fees.rules }), [ledger, assetSources, date, fees.rules]);
  const previous = useMemo(() => balanceSheetPresentation({ ...ledger, ...assetSources, asOf: comparisonDate, feeRules: fees.rules }), [ledger, assetSources, comparisonDate, fees.rules]);
  const loading = ledger.loading || fees.loading, error = ledger.error || fees.error;
  function exportCsv() {
    // Keep original ledger account identities and amounts in CSV. Display
    // grouping and intangible classification never rewrite the raw export.
    const rows = [];
    for (const [label, accounts, total] of [['الأصول', current.assets, current.totalAssets], ['الالتزامات', current.liabilities, current.totalLiabilities], ['حقوق الملكية', current.equity, current.equityBeforeResult]]) {
      rows.push([label, '', '']); accounts.forEach(row => rows.push([row.code, row.nameArabic, Number(row.amount.toFixed(2))]));
      if (label !== 'حقوق الملكية') rows.push(['', `إجمالي ${label}`, total]);
    }
    rows.push(['', 'نتيجة الفترة', current.periodResult], ['', 'إجمالي حقوق الملكية', current.totalEquity], ['', 'الالتزامات + حقوق الملكية', current.totalLiabilities + current.totalEquity]);
    downloadCsv(`المركز-المالي-حتى-${date}`, ['رقم الحساب', 'البند', 'المبلغ'], rows);
  }
  const totals = (key, label, amount, before) => <tr key={key} className="border-t-2 border-slate-300 dark:border-slate-600 font-bold">
    <th className="p-3 text-start">{label}</th><td className={numeric}>{formatCurrency(amount)}</td><td className={numeric}>{formatCurrency(before)}</td>
  </tr>;
  return <>
    <TopBar title="المركز المالي" subtitle="الأصول والالتزامات وحقوق الملكية من القيود المرحّلة" />
    <main className="p-4 sm:p-6 lg:p-8 space-y-6">
      {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
      {error && <ErrorState title="تعذّر تحميل المركز المالي" error={error} onRetry={ledger.refetch} />}
      {ledger.needsSeeding && <p role="alert">لم تتم تهيئة دليل الحسابات بعد.</p>}
      <Card className="p-4 grid sm:grid-cols-2 gap-4">
        <div><label className="block mb-2">كما في تاريخ</label><DateField name="asOf" value={date} onChange={event => setAsOf(event.target.value)} ariaLabel="كما في تاريخ" /></div>
        <div><label className="block mb-2">تاريخ المقارنة</label><DateField name="compareDate" value={comparisonDate} onChange={event => setCompareDate(event.target.value)} ariaLabel="تاريخ المقارنة" /></div>
      </Card>
      {loading ? <LoadingState message="جارٍ إعداد المركز المالي..." /> : !error && <>
        <Card className={`p-4 ${current.balanced ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
          <p role={current.balanced ? 'status' : 'alert'} className="font-bold">{current.balanced ? 'المعادلة المحاسبية متحققة' : 'المعادلة غير متحققة'} · الأصول = الالتزامات + حقوق الملكية</p>
          {!current.balanced && <p>الفرق: {formatCurrency(current.difference)}</p>}
          <p className="text-sm mt-2 text-slate-700 dark:text-slate-300">المعادلة من القيود المرحّلة بس</p>
          {!previous.balanced && <p role="alert" className="text-rose-600">معادلة تاريخ المقارنة غير متحققة؛ الفرق: {formatCurrency(previous.difference)}</p>}
        </Card>
        {current.abnormalRows.length > 0 && <div role="alert" className="p-4 rounded-control bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">
          <strong>رصيد عكس طبيعة الحساب</strong>{current.abnormalRows.map(row => <p key={row.key}>{row.label}: {formatCurrency(row.amount)} · رصيد غير طبيعي</p>)}
        </div>}
        {staff && <BalanceSheetUnposted ledger={ledger} asOf={date} feeRules={fees.rules} />}
        <div className="grid sm:grid-cols-3 gap-4">
          <StatCard icon={Landmark} tone="primary" label="إجمالي الأصول" value={formatCurrency(current.totalAssets)} />
          <StatCard icon={Landmark} tone="rose" label="إجمالي الالتزامات" value={formatCurrency(current.totalLiabilities)} />
          <StatCard icon={Landmark} tone="emerald" label="حقوق الملكية" value={formatCurrency(current.totalEquity)} />
        </div>
        <Card className="p-4 sm:p-6"><SectionHeader title="المركز المالي" subtitle="عرض دفتري؛ التصنيف التفصيلي لا يغير القيود" action={<SecondaryButton icon={Download} onClick={exportCsv}>تصدير CSV</SecondaryButton>} />
          {staff && !assetSources.assetSourcesReady && <p role="status" className="text-sm mb-3">{assetSources.loading ? 'جارٍ تفصيل الأصول...' : 'تعذر تفصيل الأصول؛ الرصيد الكامل باقٍ دون توزيع افتراضي.'}</p>}
          <ScrollableTable className="overflow-x-auto"><table className="w-full min-w-[38rem] text-sm">
            <thead><tr><th className="p-3 text-start">البند</th><th className={numeric}>{date}</th><th className={numeric}>{comparisonDate}</th></tr></thead>
            {SECTIONS.filter(([key]) => !key.startsWith('unclassified') || current.sections[key].rows.length || previous.sections[key].rows.length).map(([key, label]) => <tbody key={key}>
              <tr className="bg-slate-100 dark:bg-slate-800"><th colSpan={3} className="p-3 text-start">{label}</th></tr>
              {comparisonRows(current, previous, key).map(row => <Fragment key={row.key}>
                <tr className="border-t border-slate-100 dark:border-slate-800">
                  <th className={`p-3 text-start min-w-52 ${row.abnormal ? 'text-rose-600 dark:text-rose-300' : ''}`}>
                    {row.children?.length ? <button type="button" aria-expanded={Boolean(expanded[row.key])} aria-controls={`balance-detail-${row.key}`} className="inline-flex items-center gap-2 text-start" onClick={() => setExpanded(value => ({ ...value, [row.key]: !value[row.key] }))}><ChevronDown size={16} />{row.label}</button>
                      : row.code ? <a href={ledgerPeriodHref(row.code, null, date)} className="underline">{row.label}</a> : row.label}
                    {row.note && <small className="block font-normal mt-1">{row.note}</small>}
                    {row.abnormal && <small className="block">رصيد غير طبيعي</small>}
                  </th>
                  <td className={`${numeric} ${row.abnormal || (['currentResult', 'retained'].includes(row.key) && row.amount < 0) ? 'text-rose-600 dark:text-rose-300 font-bold' : ''}`}>{formatCurrency(row.amount)}</td>
                  <td className={`${numeric} ${row.comparisonAbnormal ? 'text-rose-600 dark:text-rose-300' : ''}`}>{formatCurrency(row.comparison)}{row.comparisonAbnormal && <small className="block">رصيد غير طبيعي</small>}</td>
                </tr>
                {expanded[row.key] && row.children?.map((child, i) => <tr id={i === 0 ? `balance-detail-${row.key}` : undefined} key={child.key} className="bg-slate-50 dark:bg-slate-800/30">
                  <th className="p-3 ps-8 text-start font-normal">{child.label}</th><td className={numeric}>{formatCurrency(child.amount)}</td><td className={numeric}>{formatCurrency(child.comparison)}</td>
                </tr>)}
              </Fragment>)}
              {totals(key, `إجمالي ${label}`, current.sections[key].total, previous.sections[key].total)}
              {key === 'unclassifiedAssets' || (key === 'noncurrentAssets' && !current.sections.unclassifiedAssets.rows.length && !previous.sections.unclassifiedAssets.rows.length) ? totals('totalAssets', 'إجمالي الأصول', current.totalAssets, previous.totalAssets) : null}
              {key === 'unclassifiedLiabilities' || (key === 'noncurrentLiabilities' && !current.sections.unclassifiedLiabilities.rows.length && !previous.sections.unclassifiedLiabilities.rows.length) ? totals('totalLiabilities', 'إجمالي الالتزامات', current.totalLiabilities, previous.totalLiabilities) : null}
            </tbody>)}
            <tfoot>{totals('equation', 'الالتزامات + حقوق الملكية', roundMoney(current.totalLiabilities + current.totalEquity), roundMoney(previous.totalLiabilities + previous.totalEquity))}</tfoot>
          </table></ScrollableTable>
          <p className="text-xs mt-4 text-slate-500 dark:text-slate-400">تفصيل 1500 حسب بنود المصادر المرحلة؛ «أخرى» لا تعني اعتماد أهليتها للرسملة. لا إهلاك أو توزيع مصاريف سنوية مفترض.</p>
        </Card>
      </>}
    </main>
  </>;
}
const roundMoney = value => Math.round(value * 100) / 100;
