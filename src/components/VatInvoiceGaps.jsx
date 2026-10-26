import { Card, SectionHeader } from './UI';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';
import { groupVatGaps } from '../lib/vatDashboard';

export default function VatInvoiceGaps({ rows, unassigned, scalingFactor = 1 }) {
  const groups = groupVatGaps(rows);
  return <Card className="p-4 sm:p-6">
    <SectionHeader title="نواقص الفواتير حسب السبب والمورّد" subtitle="الفترة المختارة فقط؛ ضريبة المستند ليست خصمًا معتمدًا." />
    <p className="text-xs text-slate-500 mb-3">قد تظهر الفاتورة تحت أكثر من سبب؛ لا تجمع أعداد الأسباب.</p>
    {!rows.length ? <p>لا فواتير غير مؤهلة مؤرخة ضمن هذه الفترة.</p> : <>
      <div className="space-y-2">{groups.reasons.map(group => <details key={group.key} className="rounded-control border border-slate-200 dark:border-slate-700 p-3"><summary className="cursor-pointer">
        {group.key} · {formatNumber(group.count)} فاتورة · {formatCurrencyPrecise(group.amount * scalingFactor)} · ضريبتها {formatCurrencyPrecise(group.tax * scalingFactor)}
      </summary><ul className="mt-2 space-y-1 text-xs">{group.rows.map(row => <li key={`${row.sourceKind}:${row.id}`}>{row.supplier || 'المورّد غير محدد'} · {row.description} · {row.invoiceNumber || 'بلا رقم فاتورة'}</li>)}</ul></details>)}</div>
      <div className="overflow-x-auto mt-4"><table className="w-full min-w-[480px] text-sm text-right"><thead><tr>
        {['المورّد', 'فواتير تحتاج استكمال المستند الضريبي', 'ضريبة المستندات غير المطالَب بها'].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}
      </tr></thead><tbody>{groups.suppliers.map(group => <tr key={group.key} className="border-t border-slate-200 dark:border-slate-700"><th scope="row" className="p-3">{group.key}</th><td className="p-3">{formatNumber(group.count)}</td><td className="p-3">{formatCurrencyPrecise(group.tax * scalingFactor)}</td></tr>)}</tbody></table></div>
    </>}
    {unassigned.length > 0 && <details className="mt-4"><summary className="cursor-pointer">مستندات بلا تاريخ فاتورة: {formatNumber(unassigned.length)} — خارج مجاميع الفترة</summary>
      <ul className="text-xs space-y-2 mt-2">{unassigned.map(row => <li key={`${row.sourceKind}:${row.id}`}>{row.description} · {row.supplier || 'المورّد غير محدد'} · {row.missing.join('، ')}</li>)}</ul></details>}
  </Card>;
}
