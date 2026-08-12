import { useMemo, useState } from 'react';
import { Scale, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, SecondaryButton } from './UI';
import DateField from './DateField';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { useLedger } from '../hooks/useLedger';
import { trialBalance } from '../lib/accounting/reports';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';

const TYPE_LABELS = {
  asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية',
  revenue: 'إيرادات', expense: 'مصروفات', unknown: 'غير معرّف',
};

/**
 * ميزان المراجعة — every account's debits, credits and net balance, with an
 * explicit verdict on whether the two grand totals agree. An out-of-balance
 * ledger is stated loudly rather than quietly rendered: it means an entry
 * reached the database without passing validation, which needs fixing before
 * any statement built on top can be trusted.
 */
export default function TrialBalancePage() {
  const { accounts, entries, lines, needsSeeding, loading, error, refetch } = useLedger();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const tb = useMemo(
    () => trialBalance(accounts, entries, lines, { from: from || null, to: to || null }),
    [accounts, entries, lines, from, to],
  );

  function handleExport() {
    const rows = tb.rows.map((r) => [
      r.code, r.nameArabic, TYPE_LABELS[r.accountType] || r.accountType,
      Number(r.debit.toFixed(2)), Number(r.credit.toFixed(2)),
      Number(r.balanceDebit.toFixed(2)), Number(r.balanceCredit.toFixed(2)),
    ]);
    rows.push(['الإجمالي', '', '',
      Number(tb.totalDebit.toFixed(2)), Number(tb.totalCredit.toFixed(2)), '', '']);
    downloadCsv(
      `ميزان-المراجعة${to ? `-حتى-${to}` : ''}`,
      ['رقم الحساب', 'اسم الحساب', 'النوع', 'إجمالي المدين', 'إجمالي الدائن', 'رصيد مدين', 'رصيد دائن'],
      rows,
    );
  }

  return (
    <>
      <TopBar title="ميزان المراجعة" subtitle="أرصدة كل الحسابات من القيود المرحّلة" />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
        {error && <ErrorState title="تعذّر تحميل ميزان المراجعة" error={error} onRetry={refetch} />}

        {needsSeeding && (
          <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-4 py-2.5 rounded-control leading-relaxed">
            لم تتم تهيئة دليل الحسابات بعد — افتح صفحة «إقفال الفترة» واضغط «تهيئة دليل الحسابات».
          </div>
        )}

        {/* ── The verdict, stated before anything else ─────────── */}
        {!loading && tb.rows.length > 0 && (
          tb.balanced ? (
            <div role="status" className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-sm px-4 py-3 rounded-control">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <span>
                <strong>الميزان متوازن</strong> — إجمالي المدين يساوي إجمالي الدائن
                (<span className="tabular-nums">{formatCurrency(tb.totalDebit)}</span>).
              </span>
            </div>
          ) : (
            <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-sm px-4 py-3 rounded-control leading-relaxed">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <span>
                <strong>الميزان غير متوازن</strong> — الفرق{' '}
                <span className="tabular-nums font-bold">{formatCurrency(tb.difference)}</span>.
                يوجد قيد وصل إلى قاعدة البيانات دون المرور بالتحقق. راجع دفتر الأستاذ
                للحسابات المتأثرة قبل الاعتماد على أي تقرير مبني على هذه الأرقام.
              </span>
            </div>
          )
        )}

        {tb.unknownAccounts.length > 0 && (
          <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-4 py-2.5 rounded-control leading-relaxed">
            حسابات مستخدمة في القيود لكنها غير موجودة في دليل الحسابات:{' '}
            <span className="tabular-nums font-bold">{tb.unknownAccounts.join('، ')}</span>
          </div>
        )}

        <Card className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <LoadingState message="جارٍ حساب الأرصدة..." />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
              <StatCard icon={Scale} tone="primary" label="إجمالي المدين"
                value={formatCurrency(tb.totalDebit)} sub={`${tb.rows.length} حساب متحرك`} />
              <StatCard icon={Scale} tone="indigo" label="إجمالي الدائن"
                value={formatCurrency(tb.totalCredit)} />
              <StatCard className="col-span-2 md:col-span-1"
                icon={tb.balanced ? CheckCircle2 : AlertTriangle}
                tone={tb.balanced ? 'emerald' : 'rose'} label="الفرق"
                value={formatCurrency(tb.difference)}
                sub={tb.balanced ? 'متوازن ✓' : 'يجب أن يكون صفراً'} />
            </div>

            <Card className="p-6">
              <SectionHeader
                title="أرصدة الحسابات"
                subtitle={to ? `حتى ${to}` : 'كل الفترات'}
                action={tb.rows.length > 0 ? (
                  <SecondaryButton icon={Download} onClick={handleExport}>تصدير CSV</SecondaryButton>
                ) : null}
              />
              {tb.rows.length === 0 ? (
                <EmptyState icon={Scale} title="لا توجد قيود مرحّلة بعد"
                  hint="سيظهر الميزان تلقائياً بمجرد ترحيل أول عملية." compact />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[44rem]">
                    <thead>
                      <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                        <th className="py-3 px-4">رقم الحساب</th>
                        <th className="py-3 px-4">اسم الحساب</th>
                        <th className="py-3 px-4">النوع</th>
                        <th className="py-3 px-4 text-left">إجمالي المدين</th>
                        <th className="py-3 px-4 text-left">إجمالي الدائن</th>
                        <th className="py-3 px-4 text-left">الرصيد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tb.rows.map((r) => (
                        <tr key={r.code} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 whitespace-nowrap tabular-nums font-semibold text-slate-700 dark:text-slate-300">{r.code}</td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                            {r.nameArabic}
                            {!r.known && (
                              <span className="mr-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-500/30">
                                خارج الدليل
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-slate-500 dark:text-slate-400">{TYPE_LABELS[r.accountType] || r.accountType}</td>
                          <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-300">{r.debit ? formatCurrency(r.debit) : '—'}</td>
                          <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-300">{r.credit ? formatCurrency(r.credit) : '—'}</td>
                          <td className="py-3 px-4 text-left tabular-nums font-bold text-slate-900 dark:text-slate-100">
                            {r.balanceDebit ? formatCurrency(r.balanceDebit) : formatCurrency(r.balanceCredit)}
                            <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400 mr-1">
                              {r.balanceDebit ? 'مدين' : r.balanceCredit ? 'دائن' : ''}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 dark:bg-slate-800 font-bold">
                        <td className="py-3 px-4 text-slate-900 dark:text-slate-100" colSpan={3}>الإجمالي</td>
                        <td className="py-3 px-4 text-left tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(tb.totalDebit)}</td>
                        <td className="py-3 px-4 text-left tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(tb.totalCredit)}</td>
                        <td className={`py-3 px-4 text-left tabular-nums ${tb.balanced ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                          {tb.balanced ? 'متوازن ✓' : formatCurrency(tb.difference)}
                        </td>
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
