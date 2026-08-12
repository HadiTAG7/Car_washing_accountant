import { useMemo, useState } from 'react';
import { BookOpen, Download, Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatCurrency, formatDate } from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, SecondaryButton } from './UI';
import DateField from './DateField';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { useLedger } from '../hooks/useLedger';
import { generalLedger } from '../lib/accounting/reports';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';

const SOURCE_LABELS = {
  wash: 'غسلة', expense: 'مصروف', partner_payment: 'دفعة شريك',
  temporary_expense: 'عهدة', recovery: 'استرداد', manual: 'يدوي',
  adjustment: 'تسوية', opening: 'رصيد افتتاحي',
};

/**
 * دفتر الأستاذ — every posted movement on one account, in order, with a
 * running balance. The opening balance carries in everything before the
 * window, so narrowing the dates never loses history.
 */
export default function GeneralLedgerPage() {
  const { accounts, entries, lines, accountIndex, needsSeeding, loading, error, refetch } = useLedger();
  const [accountCode, setAccountCode] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Default to the first account that actually has movement, so the page is
  // useful on arrival instead of showing an empty picker.
  const usedCodes = useMemo(() => new Set(lines.map((l) => String(l.accountId))), [lines]);
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
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} — {a.nameArabic}{usedCodes.has(String(a.code)) ? '' : ' (بلا حركة)'}
                  </option>
                ))}
              </select>
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
              <StatCard icon={BookOpen} tone="primary" label="الرصيد الختامي"
                value={formatCurrency(ledger.closing)}
                sub={ledger.account?.normalBalance === 'credit' ? 'رصيد دائن طبيعي' : 'رصيد مدين طبيعي'} />
            </div>

            <Card className="p-6">
              <SectionHeader
                title={`${selected} — ${ledger.account?.nameArabic || ''}`}
                subtitle={from || to ? `من ${from || 'البداية'} إلى ${to || 'اليوم'}` : 'كل الحركات'}
                action={ledger.rows.length > 0 ? (
                  <SecondaryButton icon={Download} onClick={handleExport}>تصدير CSV</SecondaryButton>
                ) : null}
              />
              {ledger.rows.length === 0 ? (
                <EmptyState icon={BookOpen} title="لا توجد حركات على هذا الحساب"
                  hint="جرّب توسيع نطاق التاريخ أو اختيار حساب آخر." compact />
              ) : (
                <div className="overflow-x-auto">
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
                      {ledger.rows.map((r) => (
                        <tr key={`${r.entryId}-${r.entryNumber}-${r.description}`}
                          className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400">{formatDate(r.entryDate)}</td>
                          <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-500 dark:text-slate-400">#{r.entryNumber}</td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700">
                              {SOURCE_LABELS[r.sourceType] || r.sourceType}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{r.description}</td>
                          <td className="py-3 px-4 text-left tabular-nums text-emerald-700 dark:text-emerald-300">
                            {r.debit ? formatCurrency(r.debit) : '—'}
                          </td>
                          <td className="py-3 px-4 text-left tabular-nums text-rose-700 dark:text-rose-300">
                            {r.credit ? formatCurrency(r.credit) : '—'}
                          </td>
                          <td className="py-3 px-4 text-left tabular-nums font-bold text-slate-900 dark:text-slate-100">
                            {formatCurrency(r.balance)}
                          </td>
                        </tr>
                      ))}
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
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </>
  );
}
