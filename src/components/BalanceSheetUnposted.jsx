import { useMemo } from 'react';
import { Card } from './UI';
import { useIncomeStatementSources } from '../hooks/useIncomeStatementSources';
import { useIncomePayrollPreviews } from '../hooks/useIncomePayrollPreviews';
import { useAccountingSettings } from '../hooks/useAccountingSettings';
import { useFinanceRead } from '../hooks/useFinanceRead';
import { liveIncomeStatement } from '../lib/accounting/liveIncomeStatement';
import { taxPolicyAt } from '../lib/accounting/taxPolicy';
import { balanceUnposted } from '../lib/balanceUnposted';
import { formatCurrency } from '../data/initialData';

export default function BalanceSheetUnposted({ ledger, asOf, feeRules }) {
  const month = asOf.slice(0, 7);
  const months = useMemo(() => [month], [month]);
  const live = useIncomeStatementSources({ statementMonths: months });
  const settings = useAccountingSettings();
  const payroll = useIncomePayrollPreviews(month, { enabled: !live.loading && !live.error, months });
  const workbench = useFinanceRead('finance-workbench', { action: 'browse' });
  const result = useMemo(() => {
    if (live.loading || payroll.loading || settings.loading) return { loading: true };
    if (live.error || payroll.error || settings.error) return { error: true };
    try {
      if (!payroll.data?.find(row => row.periodKey === month && Array.isArray(row.lines))) return { error: true };
      const sources = { ...live.sources, payrollPreviews: payroll.data,
        washes: live.sources.washes.filter(row => row.wash_date <= asOf) };
      const statement = liveIncomeStatement({ ...ledger, periodKey: month, sources, feeRules,
        policyAt: date => taxPolicyAt(date, settings.settings) });
      return balanceUnposted({ statement, entries: ledger.entries, asOf, workbench: workbench.data });
    } catch { return { error: true }; }
  }, [live, payroll, settings, month, asOf, ledger, feeRules, workbench.data]);
  const amount = value => value == null ? 'غير متاح' : formatCurrency(value);
  return <Card className="p-4 sm:p-5">
    <h2 className="font-bold mb-2">اللي ما ترحّل</h2>
    <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">شهر {month}؛ قراءة السجلات الحالية وليست لقطة تاريخية. هذه البنود لا تدخل أرقام الدفتر أعلاه.</p>
    {result.loading ? <p role="status">جارٍ قراءة البنود غير المرحلة...</p> : result.error ? <p role="alert">تعذرت قراءة البنود كاملة؛ لا تمثل صفرًا.</p> : <ul className="space-y-3 text-sm">
      <li><a className="underline" href="?page=finance_payroll">الرواتب غير المرحلة من قائمة الدخل</a>: {amount(result.payroll)} {result.estimated ? '· تقديرية للشهر كاملًا' : ''}</li>
      <li><a className="underline" href="?page=summary">إيراد الشهر غير المرحل</a>: {amount(result.revenue)} · ضريبته: {amount(result.vat)}</li>
      <li>المستندات غير المرحلة: {workbench.loading ? 'جارٍ التحميل...' : !result.documents ? 'غير متاح' : <>
        {result.documents.count} مستند · {amount(result.documents.amount)} شامل الضريبة
        <small className="block">منها المعتمد غير المرحل: {result.documents.approvedCount} · {amount(result.documents.approvedAmount)}. البقية ليست التزامًا معتمدًا.</small>
      </>}</li>
      {result.issues.length > 0 && <li role="alert" className="text-rose-600">توجد بنود تحتاج مراجعة؛ إجمالي الإيراد ليس تسوية سويتر معتمدة.</li>}
    </ul>}
    {workbench.error && <p role="alert" className="text-rose-600 text-xs mt-2">تعذرت قراءة المستندات؛ لا يمثل ذلك عدم وجود مستندات غير مرحلة.</p>}
  </Card>;
}
