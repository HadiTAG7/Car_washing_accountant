import { useMemo } from 'react';
import { useStatementMonths } from '../hooks/useStatementMonths';
import { useIncomeStatementSources } from '../hooks/useIncomeStatementSources';
import { useIncomePayrollPreviews } from '../hooks/useIncomePayrollPreviews';
import { useLedger } from '../hooks/useLedger';
import { useAccountingSettings } from '../hooks/useAccountingSettings';
import { liveIncomeStatement } from '../lib/accounting/liveIncomeStatement';
import { taxPolicyAt } from '../lib/accounting/taxPolicy';
import { todayMonth, formatMonthLabel } from '../lib/variableExpenseTotals';
import { formatCurrencyPrecise } from '../data/initialData';
import ScrollableTable from './ScrollableTable';
import { FINANCIAL_SETTINGS } from '../config/financialSettings';

export default function AdministrationShareTable() {
  const months=useStatementMonths();
  const live=useIncomeStatementSources({statementMonths:months});
  const ledger=useLedger({liveSources:live});
  const settings=useAccountingSettings();
  const payroll=useIncomePayrollPreviews(todayMonth(),{enabled:!live.loading,months});
  const loading=live.loading||ledger.loading||settings.loading||payroll.loading;
  const error=live.error||ledger.error||settings.error||payroll.error;
  const rows=useMemo(()=>loading||error?[]:months.map(month=>{
    try {
      const statement=liveIncomeStatement({...ledger,periodKey:month,
        sources:{...live.sources,payrollPreviews:payroll.data},policyAt:date=>taxPolicyAt(date,settings.settings)});
      if (statement.issues.length) return {month,profit:null,share:null};
      const share=statement.fees.find(f=>f.key==='management')?.amount;
      return {month,profit:statement.netProfitBeforeFees,share};
    } catch { return {month,profit:null,share:null}; }
  }),[loading,error,months,ledger,live.sources,payroll.data,settings.settings]);
  return <div className="space-y-3">
    <p className="font-semibold">النسبة المعتمدة: {FINANCIAL_SETTINGS.managementShareRate*100}%</p>
    <p className="text-sm">نفس نتيجة قائمة الدخل قبل الحصة. كل شهر مستقل؛ الخسارة لا تنتقل لحساب حصة الأشهر اللاحقة.</p>
    <p className="text-sm">التصنيف المقترح للسجلات لم يدخل المصروفات بعد. لا تسجّل هذه المعاينة استحقاقًا أو إثبات سداد.</p>
    {loading?<p role="status">جارٍ قراءة نتائج الأشهر...</p>:error?<p role="alert">تعذرت قراءة نتيجة الشهر؛ لا تُفترض حصة صفر.</p>:<ScrollableTable><table className="w-full text-sm text-right"><thead><tr>
      {['الشهر','صافي الربح قبل الحصة','حصة الإدارة','الحالة'].map(label=><th key={label} className="p-3">{label}</th>)}
    </tr></thead><tbody>{rows.map(row=><tr key={row.month} className="border-t border-slate-200 dark:border-slate-700">
      <th className="p-3">{formatMonthLabel(row.month)}</th><td className="p-3">{row.profit==null?'غير متاح':formatCurrencyPrecise(row.profit)}</td>
      <td className="p-3">{row.share==null?'غير متاح':formatCurrencyPrecise(row.share)}</td><td className="p-3">{row.share==null?'تعذر الحساب':row.share===0?'لا حصة لهذا الشهر':'مستحقة حسابيًا · لا يوجد إثبات سداد مربوط'}</td>
    </tr>)}</tbody></table></ScrollableTable>}
  </div>;
}
