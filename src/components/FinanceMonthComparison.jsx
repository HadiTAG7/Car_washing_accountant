import { useOverviewDashboard } from '../hooks/useOverviewDashboard';
import { formatCurrency } from '../data/initialData';

export default function FinanceMonthComparison({ month, income }) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Riyadh' });
  // The exact overview hook, not a second operational calculation.
  const { finance } = useOverviewDashboard(month, today);
  const statement = !finance.loading && !finance.error ? finance.statement : null;
  const rows = [
    ['الإيراد', income.totalRevenue, statement?.netRevenue],
    ['المصروفات', income.totalCost + income.totalExpenses, statement?.totalCosts],
  ];
  return <section className="fw-panel fw-comparison" aria-label="مقارنة الدفتر والنظرة العامة">
    <h2>مقارنة الشهر — <bdi>{month}</bdi></h2>
    <p>المرحل بتاريخ القيد، والتشغيلي من النظرة العامة؛ ليست مبالغ تُجمع معًا.</p>
    <div className="overflow-x-auto"><table className="w-full text-right">
      <thead><tr><th scope="col">البند</th><th scope="col">المرحل في الدفتر</th><th scope="col">التشغيلي في النظرة العامة</th></tr></thead>
      <tbody>{rows.map(([label, posted, operational]) => <tr key={label}><th scope="row">{label}</th>
        <td>{formatCurrency(posted)}</td><td>{Number.isFinite(operational) ? formatCurrency(operational) : 'غير متاح'}</td></tr>)}</tbody>
    </table></div>
    <small>حتى تاريخ القراءة: <bdi>{today}</bdi> — الرياض. نفس الشهر المختار في المقارنة.</small>
    {finance.error && <p role="alert">تعذرت قراءة النظرة العامة؛ أرقام الدفتر مستقلة عنها.</p>}
  </section>;
}
