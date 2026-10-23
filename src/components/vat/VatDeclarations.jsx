import { formatCurrencyPrecise, formatNumber } from '../../data/initialData';
import { formatDateOnly } from '../../lib/dateOnly';
import { periodLabel } from '../../lib/accounting/vatReturn';
import { declarationDeadline, daysToDeadline } from '../../lib/accounting/vatDashboard';
import { Card, SectionHeader } from '../UI';

const STATUS = { not_submitted: 'لم يُقدَّم', submitted: 'مقدّم', refund_received: 'الاسترداد وصل' };
const money = (value, scale) => formatCurrencyPrecise(value * scale);

export default function VatDeclarations({ rows, records, loading, error, today, scale = 1 }) {
  if (loading) return <Card className="p-5"><p role="status">جارٍ تحميل سجل الإقرارات…</p></Card>;
  if (error) return <Card className="p-5"><p role="alert">تعذّر قراءة سجل الإقرارات؛ حالة التقديم غير متحققة.</p></Card>;
  const indexed = new Map(records.map(r => [r.periodKey || r.id, r]));
  const pending = rows.filter(row => !['submitted', 'refund_received'].includes(indexed.get(row.period)?.status));
  const upcoming = pending.filter(r => declarationDeadline(r.period) >= today).sort((a,b) => a.period.localeCompare(b.period))[0];
  const overdue = pending.filter(r => declarationDeadline(r.period) < today).sort((a,b) => a.period.localeCompare(b.period))[0];
  return <section aria-label="الإقرارات" className="space-y-3">
    {[upcoming, overdue].filter(Boolean).map(row => {
      const deadline = declarationDeadline(row.period); const days = daysToDeadline(deadline, today);
      return <div key={row.period} role="alert" className={`border rounded-control p-3 text-sm ${days < 10 ? 'border-red-400 text-red-600 dark:text-red-300 bg-red-500/10' : 'border-amber-400 text-amber-700 dark:text-amber-300 bg-amber-500/10'}`}>
        إقرار {periodLabel(row.period).split(' · ')[0]}: آخر موعد {formatDateOnly(deadline)}،{' '}
        {days >= 0 ? `باقي ${formatNumber(days)} يوم` : indexed.get(row.period)?.status === 'not_submitted'
          ? `متأخر ${formatNumber(Math.abs(days))} يوم` : `انقضى الموعد منذ ${formatNumber(Math.abs(days))} يوم`}
        {!indexed.has(row.period) && <span className="block mt-1 text-xs">لا يوجد إثبات تقديم مسجّل؛ هذا لا يثبت عدم التقديم لدى الهيئة.</span>}
      </div>;
    })}
    <Card className="p-5">
      <SectionHeader title="الإقرارات" subtitle="متابعة فقط؛ التقديم والاسترداد لا ينفّذهما الموقع. الأرقام مسودة من بيانات الفترة الحالية، وليست نسخة الإقرار المقدّم." />
      {!rows.length ? <p>تاريخ التسجيل غير موثق في سياسة مؤرخة؛ لا يمكن تحديد أول إقرار.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm text-right">
        <thead><tr>{['الفترة', 'آخر موعد', 'المخرجات التشغيلية', 'المدخلات المؤهلة', 'الصافي', 'الحالة', 'تاريخ التقديم', 'الإثبات'].map(text => <th className="p-3" key={text}>{text}</th>)}</tr></thead>
        <tbody>{rows.map(row => {
          const record = indexed.get(row.period); const known = STATUS[record?.status];
          return <tr key={row.period} className="border-t border-slate-200 dark:border-slate-700">
            <td className="p-3">{periodLabel(row.period)}</td><td className="p-3 whitespace-nowrap">{formatDateOnly(declarationDeadline(row.period))}</td>
            <td className="p-3 tabular-nums">{row.report.policyUnconfigured ? 'غير محسوم' : money(row.report.output.tax, scale)}</td>
            <td className="p-3 tabular-nums">{money(row.report.input.tax, scale)}</td>
            <td className="p-3 tabular-nums">{row.report.policyUnconfigured ? 'غير محسوم' : <>{money(Math.abs(row.report.netTax), scale)} · {row.report.netTax < 0 ? 'مسترد' : row.report.netTax > 0 ? 'مستحق' : 'متوازن'}</>}</td>
            <td className="p-3">{record ? known || 'حالة غير معروفة' : 'حالة التقديم غير متحققة — لا إثبات مسجّل'}</td>
            <td className="p-3">{record?.submittedDate ? formatDateOnly(record.submittedDate) : '—'}</td>
            <td className="p-3">{/^https?:\/\//i.test(record?.evidenceUrl || '') ? <a className="text-primary-600 underline" href={record.evidenceUrl} target="_blank" rel="noopener noreferrer">عرض الإثبات</a> : 'غير مسجّل'}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </Card>
  </section>;
}
