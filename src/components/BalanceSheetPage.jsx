import { useMemo, useState } from 'react';
import { Landmark, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, SecondaryButton } from './UI';
import DateField from './DateField';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { useLedger } from '../hooks/useLedger';
import { balanceSheet } from '../lib/accounting/reports';
import { useFeeRules } from '../hooks/useFeeRules';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';

/** One side of the sheet — a titled list of accounts with a total. */
function Section({ title, rows, total, tone }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 py-2">لا توجد أرصدة.</p>
      ) : (
        <ul className="divide-y divide-slate-50 dark:divide-slate-800/60">
          {rows.map((r) => (
            <li key={r.code} className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-sm text-slate-700 dark:text-slate-300 min-w-0">
                <span className="tabular-nums text-slate-500 dark:text-slate-400 ml-1">{r.code}</span>
                {r.nameArabic}
              </span>
              <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                {formatCurrency(r.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className={`flex items-baseline justify-between gap-3 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 font-bold ${tone}`}>
        <span className="text-sm">الإجمالي</span>
        <span className="text-sm tabular-nums">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}

/**
 * المركز المالي — assets against liabilities + equity, as of a date.
 *
 * The current period's result is shown as its own equity line: retained
 * earnings only carry PRIOR periods until a year-end close moves the result
 * across, so without it the sheet would be out by exactly the net profit.
 */
export default function BalanceSheetPage() {
  const { accounts, entries, lines, needsSeeding, loading, error, refetch } = useLedger();
  const { rules: feeRules } = useFeeRules();
  const [asOf, setAsOf] = useState('');

  const bs = useMemo(
    () => balanceSheet(accounts, entries, lines, { asOf: asOf || null, feeRules }),
    [accounts, entries, lines, asOf, feeRules],
  );

  function handleExport() {
    const rows = [];
    rows.push(['الأصول', '', '']);
    bs.assets.forEach((r) => rows.push([r.code, r.nameArabic, Number(r.amount.toFixed(2))]));
    rows.push(['', 'إجمالي الأصول', Number(bs.totalAssets.toFixed(2))]);
    rows.push(['الالتزامات', '', '']);
    bs.liabilities.forEach((r) => rows.push([r.code, r.nameArabic, Number(r.amount.toFixed(2))]));
    rows.push(['', 'إجمالي الالتزامات', Number(bs.totalLiabilities.toFixed(2))]);
    rows.push(['حقوق الملكية', '', '']);
    bs.equity.forEach((r) => rows.push([r.code, r.nameArabic, Number(r.amount.toFixed(2))]));
    rows.push(['', 'نتيجة الفترة', Number(bs.periodResult.toFixed(2))]);
    rows.push(['', 'إجمالي حقوق الملكية', Number(bs.totalEquity.toFixed(2))]);
    rows.push(['', 'الالتزامات + حقوق الملكية', Number((bs.totalLiabilities + bs.totalEquity).toFixed(2))]);
    downloadCsv(`المركز-المالي${asOf ? `-حتى-${asOf}` : ''}`, ['رقم الحساب', 'البند', 'المبلغ'], rows);
  }

  return (
    <>
      <TopBar title="المركز المالي" subtitle="الأصول والالتزامات وحقوق الملكية من القيود المرحّلة" />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
        {error && <ErrorState title="تعذّر تحميل المركز المالي" error={error} onRetry={refetch} />}
        {needsSeeding && (
          <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-4 py-2.5 rounded-control leading-relaxed">
            لم تتم تهيئة دليل الحسابات بعد — افتح صفحة «إقفال الفترة» واضغط «تهيئة دليل الحسابات».
          </div>
        )}

        {!loading && (
          bs.balanced ? (
            <div role="status" className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-sm px-4 py-3 rounded-control">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <span><strong>المعادلة المحاسبية متحققة</strong> — الأصول = الالتزامات + حقوق الملكية.</span>
            </div>
          ) : (
            <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-sm px-4 py-3 rounded-control leading-relaxed">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <span>
                <strong>المعادلة غير متحققة</strong> — الفرق{' '}
                <span className="tabular-nums font-bold">{formatCurrency(bs.difference)}</span>.
                راجع ميزان المراجعة أولاً؛ الغالب أن هناك قيداً غير متوازن.
              </span>
            </div>
          )
        )}

        <Card className="p-4 sm:p-5">
          <div className="max-w-xs">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">كما في تاريخ</label>
            <DateField name="asOf" value={asOf} onChange={(e) => setAsOf(e.target.value)} ariaLabel="كما في تاريخ" />
          </div>
        </Card>

        {loading ? (
          <LoadingState message="جارٍ إعداد المركز المالي..." />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
              <StatCard icon={Landmark} tone="primary" label="إجمالي الأصول" value={formatCurrency(bs.totalAssets)} />
              <StatCard icon={Landmark} tone="rose" label="إجمالي الالتزامات" value={formatCurrency(bs.totalLiabilities)} />
              <StatCard className="col-span-2 md:col-span-1" icon={Landmark} tone="emerald"
                label="حقوق الملكية" value={formatCurrency(bs.totalEquity)}
                sub={`منها نتيجة الفترة ${formatCurrency(bs.periodResult)}`} />
            </div>

            <Card className="p-6">
              <SectionHeader
                title="المركز المالي"
                subtitle={asOf ? `كما في ${asOf}` : 'حتى اليوم'}
                action={<SecondaryButton icon={Download} onClick={handleExport}>تصدير CSV</SecondaryButton>}
              />
              {bs.assets.length + bs.liabilities.length + bs.equity.length === 0 ? (
                <EmptyState icon={Landmark} title="لا توجد أرصدة بعد"
                  hint="سيظهر المركز المالي تلقائياً بمجرد ترحيل أول عملية." compact />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <Section title="الأصول" rows={bs.assets} total={bs.totalAssets}
                    tone="text-slate-900 dark:text-slate-100" />
                  <div className="space-y-8">
                    <Section title="الالتزامات" rows={bs.liabilities} total={bs.totalLiabilities}
                      tone="text-slate-900 dark:text-slate-100" />
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">حقوق الملكية</h3>
                      <ul className="divide-y divide-slate-50 dark:divide-slate-800/60">
                        {bs.equity.map((r) => (
                          <li key={r.code} className="flex items-baseline justify-between gap-3 py-2">
                            <span className="text-sm text-slate-700 dark:text-slate-300">
                              <span className="tabular-nums text-slate-500 dark:text-slate-400 ml-1">{r.code}</span>
                              {r.nameArabic}
                            </span>
                            <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(r.amount)}</span>
                          </li>
                        ))}
                        {/* Retained earnings hold prior periods only; this
                            period's result is shown separately until closed. */}
                        <li className="flex items-baseline justify-between gap-3 py-2">
                          <span className="text-sm text-slate-700 dark:text-slate-300">نتيجة الفترة الحالية</span>
                          <span className={`text-sm font-semibold tabular-nums ${bs.periodResult >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                            {formatCurrency(bs.periodResult)}
                          </span>
                        </li>
                      </ul>
                      <div className="flex items-baseline justify-between gap-3 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 font-bold text-slate-900 dark:text-slate-100">
                        <span className="text-sm">الإجمالي</span>
                        <span className="text-sm tabular-nums">{formatCurrency(bs.totalEquity)}</span>
                      </div>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 pt-3 border-t-2 border-slate-200 dark:border-slate-700 font-extrabold text-slate-900 dark:text-slate-100">
                      <span className="text-sm">الالتزامات + حقوق الملكية</span>
                      <span className="text-sm tabular-nums">{formatCurrency(bs.totalLiabilities + bs.totalEquity)}</span>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </>
  );
}
