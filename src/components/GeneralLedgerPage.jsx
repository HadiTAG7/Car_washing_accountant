import AccountCode from './AccountCode';
import { accountDisplayLabel, isPartnerCapital } from '../lib/accountDisplay';
import ScrollableTable from './ScrollableTable';
import { useMemo, useState } from 'react';
import { BookOpen, Download, Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatCurrency, formatDate, formatNumber } from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, SecondaryButton, PrimaryButton } from './UI';
import DateField from './DateField';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { useLedger } from '../hooks/useLedger';
import { useLedgerSourceDocuments } from '../hooks/useLedgerSourceDocuments';
import JournalEntryDetails from './JournalEntryDetails';
import CashBankCorrectionCard from './CashBankCorrectionCard';
import PayrollCashFundingCard from './PayrollCashFundingCard';
import CashResidualCorrections from './CashResidualCorrections';
import ManualJournalEntryCard from './ManualJournalEntryCard';
import { balanceNature, ledgerAccountGroups, ledgerLocationFilters, ledgerMovementContext, matchesLedgerMovement, referencedLedgerEntry, LEDGER_SOURCE_LABELS as SOURCE_LABELS } from '../lib/ledgerPresentation';
import { generalLedger } from '../lib/accounting/reports';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';

const PAGE_SIZE = 100;

/**
 * دفتر الأستاذ — every posted movement on one account, in order, with a
 * running balance. The opening balance carries in everything before the
 * window, so narrowing the dates never loses history.
 */
export default function GeneralLedgerPage() {
  const { accounts, entries, lines, accountIndex, needsSeeding, loading, error, refetch } = useLedger();
  const [initialFilters] = useState(() => ledgerLocationFilters(typeof window !== 'undefined' ? window.location.search : ''));
  const [accountCode, setAccountCode] = useState(initialFilters.account);
  const [from, setFrom] = useState(initialFilters.from);
  const [to, setTo] = useState(initialFilters.to);
  const [search, setSearch] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [openedEntryId, setOpenedEntryId] = useState(null);
  const entryIndex = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  // Default to the first account that actually has movement, so the page is
  // useful on arrival instead of showing an empty picker.
  const usedCodes = useMemo(() => {
    const postedIds = new Set(entries.filter((entry) => ['posted', 'reversed'].includes(entry.status)).map((entry) => entry.id));
    return new Set(lines.filter((line) => postedIds.has(line.entryId)).map((line) => String(line.accountId)));
  }, [entries, lines]);
  const accountGroups = useMemo(() => ledgerAccountGroups(accounts, usedCodes), [accounts, usedCodes]);
  const selected = accountCode
    || accounts.find((a) => usedCodes.has(String(a.code)))?.code
    || accounts[0]?.code
    || '';

  const ledger = useMemo(
    () => (selected
      ? generalLedger(selected, entries, lines, {
        from: from || null, to: to || null, account: accountIndex.get(String(selected)),
      })
      : null),
    [selected, entries, lines, from, to, accountIndex],
  );
  // Rows on screen, 100 at a time; the balances and totals still cover every
  // row, and the CSV export carries them all.
  const sourceEntries = useMemo(() => {
    const ids = new Set((ledger?.rows || []).map((row) => row.entryId));
    if (openedEntryId) ids.add(openedEntryId);
    return [...ids].map((id) => entryIndex.get(id)).filter(Boolean);
  }, [ledger, openedEntryId, entryIndex]);
  const sourceDocuments = useLedgerSourceDocuments(sourceEntries, entryIndex);
  const contexts = useMemo(() => new Map((ledger?.rows || []).map((row) => [row, ledgerMovementContext(row, entryIndex, sourceDocuments.documents)])), [ledger, entryIndex, sourceDocuments.documents]);
  const filteredRows = useMemo(() => (ledger?.rows || []).filter((row) => matchesLedgerMovement(row, contexts.get(row), search, sourceType)), [ledger, contexts, search, sourceType]);
  const nature = balanceNature(ledger?.closing || 0, ledger?.account);
  const openedEntry = entryIndex.get(openedEntryId);
  const openedLines = useMemo(() => lines.filter((line) => line.entryId === openedEntryId), [lines, openedEntryId]);
  const viewKey = `${selected}|${from}|${to}|${search}|${sourceType}`;
  const [paging, setPaging] = useState({ key: viewKey, count: PAGE_SIZE });
  const visible = paging.key === viewKey ? paging.count : PAGE_SIZE;
  const shownRows = filteredRows.slice(0, visible);

  function handleExport() {
    if (!ledger) return;
    const rows = ledger.rows.map((r) => [
      r.entryDate, r.entryNumber, SOURCE_LABELS[r.sourceType] || r.sourceType,
      r.description, Number(r.debit.toFixed(2)), Number(r.credit.toFixed(2)),
      Number(r.balance.toFixed(2)),
    ]);
    rows.unshift(['', '', '', 'الرصيد الافتتاحي', '', '', Number(ledger.opening.toFixed(2))]);
    rows.push(['', '', '', 'الرصيد الختامي',
      Number(ledger.totalDebit.toFixed(2)), Number(ledger.totalCredit.toFixed(2)),
      Number(ledger.closing.toFixed(2))]);
    const acc = accountIndex.get(String(selected));
    const name = String(acc?.nameArabic || '').replace(/[^\p{L}\p{N} _-]/gu, '');
    downloadCsv(
      `دفتر-الأستاذ-${selected}-${name}`,
      ['التاريخ', 'رقم القيد', 'المصدر', 'البيان', 'مدين', 'دائن', 'الرصيد'],
      rows,
    );
  }

  return (
    <>
      <TopBar title="دفتر الأستاذ" subtitle="حركات كل حساب بالتفصيل مع الرصيد التراكمي" />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        <ManualJournalEntryCard accounts={accounts} />
        <CashResidualCorrections onSaved={id=>{refetch();setOpenedEntryId(id);}} />
        <PayrollCashFundingCard onSaved={id=>{refetch();setOpenedEntryId(id);}} />
        <CashBankCorrectionCard onSaved={id=>{refetch();setOpenedEntryId(id);}} />
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
        {error && <ErrorState title="تعذّر تحميل دفتر الأستاذ" error={error} onRetry={refetch} />}

        {needsSeeding && (
          <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-4 py-2.5 rounded-control leading-relaxed">
            لم تتم تهيئة دليل الحسابات بعد — افتح صفحة «إقفال الفترة» واضغط «تهيئة دليل الحسابات».
          </div>
        )}

        {/* ── Filters ─────────────────────────────────────────── */}
        <Card className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="glAccount">
                الحساب
              </label>
              <select
                id="glAccount"
                value={selected}
                onChange={(e) => setAccountCode(e.target.value)}
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
              >
                {accounts.length === 0 && <option value="">— لا توجد حسابات —</option>}
                {accountGroups.map((group) => <optgroup key={group.key} label={group.label}>{group.accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {accountDisplayLabel(a)}{isPartnerCapital(a) || usedCodes.has(String(a.code)) ? '' : ' (بلا حركة)'}
                  </option>
                ))}</optgroup>)}
              </select>
              {selected && !isPartnerCapital(accountIndex.get(String(selected))) && <p className="text-xs mt-2">رمز الحساب: <AccountCode code={selected} /></p>}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">من تاريخ</label>
              <DateField name="from" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel="من تاريخ" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">إلى تاريخ</label>
              <DateField name="to" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel="إلى تاريخ" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div className="sm:col-span-2">
              <label htmlFor="glSearch" className="block text-sm font-semibold mb-1.5">بحث بالمبلغ أو المورد أو الوصف أو رقم المستند</label>
              <input id="glSearch" type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" />
            </div>
            <div>
              <label htmlFor="glSource" className="block text-sm font-semibold mb-1.5">نوع المصدر</label>
              <select id="glSource" value={sourceType} onChange={(event) => setSourceType(event.target.value)} className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <option value="">كل المصادر</option>
                {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
          {sourceDocuments.loading && <p role="status" className="text-xs mt-3">جارٍ قراءة أوصاف المستندات ومورديها...</p>}
          {sourceDocuments.error && <p role="alert" className="text-xs mt-3 text-amber-700 dark:text-amber-300">تعذّرت قراءة تفاصيل المستندات؛ البحث يعرض بيانات القيود المتاحة فقط. <button type="button" className="underline" onClick={sourceDocuments.refetch}>إعادة المحاولة</button></p>}
        </Card>

        {loading ? (
          <LoadingState message="جارٍ تحميل القيود..." />
        ) : !ledger ? (
          <Card className="p-6">
            <EmptyState icon={BookOpen} title="اختر حساباً لعرض حركاته" />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-5">
              <StatCard icon={Wallet} tone="slate" label="الرصيد الافتتاحي"
                value={formatCurrency(ledger.opening)} sub="ما قبل بداية الفترة" />
              <StatCard icon={ArrowDownLeft} tone="emerald" label="إجمالي المدين"
                value={formatCurrency(ledger.totalDebit)} sub={`${ledger.rows.length} حركة`} />
              <StatCard icon={ArrowUpRight} tone="rose" label="إجمالي الدائن"
                value={formatCurrency(ledger.totalCredit)} />
              <StatCard icon={BookOpen} tone={nature.abnormal ? 'rose' : 'primary'} label="الرصيد الختامي"
                value={formatCurrency(ledger.closing)}
                sub={<span className={nature.abnormal ? 'text-rose-700 dark:text-rose-300 font-bold' : ''}>{nature.label}</span>} />
            </div>

            <Card className="p-6">
              <SectionHeader
                title={accountDisplayLabel(ledger.account || { code: selected })}
                subtitle={from || to ? `من ${from || 'البداية'} إلى ${to || 'اليوم'}` : 'كل الحركات'}
                action={ledger.rows.length > 0 ? (
                  <SecondaryButton icon={Download} onClick={handleExport}>تصدير CSV</SecondaryButton>
                ) : null}
              />
              {(search || sourceType) && <p role="status" className="text-xs mb-4 text-slate-500">نتائج البحث: {formatNumber(filteredRows.length)} حركة. الأرصدة والإجماليات والتصدير تشمل كامل الفترة؛ البحث لا يغيّرها.</p>}
              {ledger.rows.length === 0 ? (
                <EmptyState icon={BookOpen} title="لا توجد حركات على هذا الحساب"
                  hint="جرّب توسيع نطاق التاريخ أو اختيار حساب آخر." compact />
              ) : (
                <ScrollableTable className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[46rem]">
                    <thead>
                      <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                        <th className="py-3 px-4">التاريخ</th>
                        <th className="py-3 px-4">رقم القيد</th>
                        <th className="py-3 px-4">المصدر</th>
                        <th className="py-3 px-4">البيان</th>
                        <th className="py-3 px-4 text-left">مدين</th>
                        <th className="py-3 px-4 text-left">دائن</th>
                        <th className="py-3 px-4 text-left">الرصيد</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-50 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-800/40">
                        <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400" colSpan={4}>الرصيد الافتتاحي</td>
                        <td className="py-2.5 px-4" />
                        <td className="py-2.5 px-4" />
                        <td className="py-2.5 px-4 text-left tabular-nums font-bold text-slate-700 dark:text-slate-200">
                          {formatCurrency(ledger.opening)}
                        </td>
                      </tr>
                      {shownRows.map((r, index) => {
                        const context = contexts.get(r);
                        const original = referencedLedgerEntry(context.originalId, entryIndex);
                        return <tr key={`${r.entryId}-${index}`}
                          className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400">{formatDate(r.entryDate)}</td>
                          <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-500 dark:text-slate-400"><button type="button" className="text-primary-600 dark:text-primary-400 underline" aria-label={`فتح القيد ${r.entryNumber}`} onClick={() => setOpenedEntryId(r.entryId)}>#{r.entryNumber}</button></td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700">
                              {SOURCE_LABELS[r.sourceType] || r.sourceType}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300 min-w-64 max-w-md break-words">
                            <p>{context.description}</p>
                            {context.supplier && <p className="text-xs mt-1">المورد: {context.supplier}</p>}
                            {context.documentNumber && <p className="text-xs mt-1">المستند: {context.documentNumber}</p>}
                            {context.url && <a href={context.url} target="_blank" rel="noreferrer" className="text-xs text-primary-600 underline">فتح المستند</a>}
                            {context.reason && <p className="text-xs mt-1">سبب التسوية: {context.reason}</p>}
                            {original && <button type="button" className="block text-xs mt-1 text-primary-600 underline" onClick={() => setOpenedEntryId(original.id)}>القيد الأصلي #{original.entryNumber}</button>}
                          </td>
                          <td className="py-3 px-4 text-left tabular-nums text-emerald-700 dark:text-emerald-300">
                            {r.debit ? formatCurrency(r.debit) : '—'}
                          </td>
                          <td className="py-3 px-4 text-left tabular-nums text-rose-700 dark:text-rose-300">
                            {r.credit ? formatCurrency(r.credit) : '—'}
                          </td>
                          <td className="py-3 px-4 text-left tabular-nums font-bold text-slate-900 dark:text-slate-100">
                            {formatCurrency(r.balance)}
                          </td>
                        </tr>;
                      })}
                      {!shownRows.length && <tr><td colSpan={7} className="p-4 text-center">لا توجد حركات تطابق البحث</td></tr>}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 dark:bg-slate-800 font-bold">
                        <td className="py-3 px-4 text-slate-900 dark:text-slate-100" colSpan={4}>الرصيد الختامي</td>
                        <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(ledger.totalDebit)}</td>
                        <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(ledger.totalCredit)}</td>
                        <td className="py-3 px-4 text-left tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(ledger.closing)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </ScrollableTable>
              )}
              {filteredRows.length > shownRows.length && (
                <div className="flex items-center justify-between gap-3 p-4">
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{formatNumber(shownRows.length)} / {formatNumber(filteredRows.length)}</span>
                  <PrimaryButton onClick={() => setPaging({ key: viewKey, count: visible + PAGE_SIZE })}>عرض المزيد</PrimaryButton>
                </div>
              )}
            </Card>
          </>
        )}
      </main>
      {openedEntry && <JournalEntryDetails entry={openedEntry} entryIndex={entryIndex} lines={openedLines} accountIndex={accountIndex} documents={sourceDocuments.documents} onOpen={setOpenedEntryId} onClose={() => setOpenedEntryId(null)} />}
    </>
  );
}
