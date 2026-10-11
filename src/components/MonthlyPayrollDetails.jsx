import { useBikers } from '../hooks/useBikers';
import { useLanguage } from '../i18n/useLanguage';
import { displayRecordedBikerName, recordedBikerSweaterId } from '../lib/bikerNames';
import { formatCurrency, formatNumber } from '../data/initialData';

export default function MonthlyPayrollDetails({ report }) {
  const { bikers } = useBikers();
  const { language } = useLanguage();
  return <details className="mt-4 text-sm">
    <summary className="cursor-pointer font-semibold">تفاصيل مصروف الرواتب</summary>
    <div className="overflow-x-auto mt-3"><table className="w-full min-w-[640px] text-sm [&_th]:text-start [&_td]:text-start [&_th]:px-3 [&_td]:px-3 [&_td]:py-2" aria-label="تفاصيل مصروف الرواتب">
      <thead><tr><th>Sweater ID</th><th>العامل</th><th>الأساسي المستحق</th><th>البونص</th><th>الخصومات</th><th>مصروف الراتب</th><th>حالة السداد</th><th>تاريخ الدفع</th></tr></thead>
      <tbody>{report.rows.map(row => <tr key={row.bikerId}>
        <td><span dir="ltr" translate="no" className="inline-block">{recordedBikerSweaterId(row, bikers) || '—'}</span></td>
        <td translate="no">{displayRecordedBikerName(row, bikers, language)}</td>
        <td>{formatCurrency(row.basic)}</td><td>{formatCurrency(row.bonus)}</td><td>{formatCurrency(row.deduction)}</td>
        <td className="font-bold">{formatCurrency(row.amount)}</td><td>{row.paid ? 'مدفوع' : 'غير مدفوع'}</td>
        <td><span dir="ltr" className="inline-block">{row.payDate || '—'}</span></td>
      </tr>)}</tbody>
    </table></div>
    <p className="mt-2 text-xs text-slate-500">عدد العاملين في المصروف: {formatNumber(report.rows.length)}</p>
  </details>;
}
