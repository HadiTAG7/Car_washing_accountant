import { formatCurrency } from '../../data/initialData';
import { Card, SectionHeader } from '../UI';

const labelOf = row => ({
  'transferred-out': 'يُخصم: رواتب رُحّلت هذا الشهر وتخص أشهرًا أخرى',
  'transferred-in': 'يُضاف: رواتب تخص هذا الشهر ورُحّلت في أشهر أخرى',
  payroll: row.estimated ? 'رواتب تقديرية غير مُرحّلة' : 'رواتب مستحقة غير مُرحّلة',
  variable: 'مستندات المصاريف المتغيرة غير المُرحّلة',
  monthly: 'مستندات المصاريف الشهرية غير المُرحّلة',
  voucher: 'سندات المصاريف الدورية غير المُرحّلة',
  annual: 'مستندات المصاريف السنوية غير المُرحّلة',
  other: 'مصروفات مسجلة أخرى غير مُرحّلة',
  rounding: 'فروق التقريب في تفاصيل القائمة',
})[row.key];

export default function IncomeCostReconciliation({ reconciliation }) {
  if (!reconciliation) return <p role="status">تعذرت مطابقة التكاليف؛ تفاصيل القائمة غير متاحة.</p>;
  const rows = [
    { key: 'statement', label: 'تكاليف قائمة الدخل', amount: reconciliation.statementTotal },
    { key: 'posted', label: 'التكاليف المُرحّلة في الدفتر بتاريخ القيد', amount: reconciliation.posted },
    ...reconciliation.rows.map(row => ({ ...row, label: labelOf(row) })),
    { key: 'unexplained', label: 'فرق غير مفسّر', amount: reconciliation.unexplained },
  ];
  return <Card className="p-6">
    <section aria-label="مطابقة التكاليف بالدفاتر">
      <SectionHeader title="مطابقة التكاليف بالدفاتر" subtitle={reconciliation.matched
        ? 'الفرق مفسَّر بالكامل — لا يوجد اختلاف غير معروف السبب'
        : 'يوجد فرق غير مفسَّر — راجعه قبل اعتماد الشهر'} />
      <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="sr-only"><tr><th scope="col">البند</th><th scope="col">المبلغ</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.key} className={row.key === 'unexplained'
            ? `border-t-2 font-bold ${reconciliation.matched ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400'}`
            : 'border-b border-slate-50 dark:border-slate-800/60 text-slate-800 dark:text-slate-200'}>
            <th scope="row" className="py-3 px-4 text-start font-medium">{row.label}</th>
            <td className="py-3 px-4 text-left whitespace-nowrap tabular-nums font-bold">{formatCurrency(row.amount)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">تكاليف القائمة = المرحّل بتاريخ القيد + بنود المطابقة. مبالغ صافية، دون تغيير الدفتر.</p>
    </section>
  </Card>;
}
