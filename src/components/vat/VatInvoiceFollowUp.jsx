import { formatCurrencyPrecise, formatNumber } from '../../data/initialData';
import { invoiceFollowUp } from '../../lib/accounting/vatDashboard';
import { Card, SectionHeader } from '../UI';

export default function VatInvoiceFollowUp({ report, scale = 1 }) {
  const groups = invoiceFollowUp(report);
  return <Card className="p-5 space-y-4">
    <SectionHeader title="متابعة الفواتير غير المؤهلة" subtitle="حسب الفترة المختارة. قد تحمل الفاتورة أكثر من نقص؛ لا تجمع أعداد الأسباب كمستندات مستقلة." />
    {groups.reasons.length ? groups.reasons.map(group => <details key={group.reason} className="border rounded-control p-3 border-slate-200 dark:border-slate-700">
      <summary className="cursor-pointer">{group.reason} · {formatNumber(group.count)} مستند · {formatCurrencyPrecise(group.amount * scale)}</summary>
      <ul className="mt-3 space-y-2">{group.rows.map(row => <li key={row.sourceKey}>{row.description || row.invoiceNumber || 'مستند بدون وصف'} · {row.supplier || 'المورّد غير مسجّل'}</li>)}</ul>
    </details>) : <p>لا توجد فواتير غير مؤهلة في هذه الفترة.</p>}
    <p className="text-xs text-slate-500">الرقم الضريبي للمورّد غير محفوظ كحقل مستقل في المصادر الحالية؛ يحتاج مراجعة أصل الفاتورة. لم نغيّر قواعد الأهلية.</p>
    {groups.suppliers.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-right text-sm">
      <thead><tr><th className="p-2">المورّد</th><th className="p-2">فواتير تحتاج استكمالًا</th><th className="p-2">الضريبة المثبتة</th></tr></thead>
      <tbody>{groups.suppliers.map(row => <tr key={row.supplier} className="border-t border-slate-200 dark:border-slate-700"><td className="p-2">{row.supplier}</td><td className="p-2">{formatNumber(row.count)}</td><td className="p-2">{formatCurrencyPrecise(row.tax * scale)}{row.unknownTax > 0 && <span className="block text-xs">وضريبة {formatNumber(row.unknownTax)} مستند غير معلومة</span>}</td></tr>)}</tbody>
    </table></div>}
    {report.undated.length > 0 && <details><summary className="cursor-pointer">مستندات بلا تاريخ صالح: {formatNumber(report.undated.length)} — خارج إجماليات الفترة</summary><ul className="mt-2 space-y-2">{report.undated.map(row => <li key={row.sourceKey}>{row.description || 'مستند بدون وصف'}</li>)}</ul></details>}
  </Card>;
}
