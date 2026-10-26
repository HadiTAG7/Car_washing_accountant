import { financeSnapshotRows } from '../lib/financeReportPresentation';
import './ReportFinancialNumbers.css';

export default function ReportFinancialNumbers({ report }) {
  const snapshot = report.financialSnapshot;
  if (!snapshot) return <section className="report-financial-numbers" aria-label="أرقام التقرير المحفوظة"><h2>أرقام التقرير</h2><p>ما انحفظت أرقام مع هذا التقرير</p></section>;
  return <section className="report-financial-numbers" aria-label="أرقام التقرير المحفوظة"><h2>أرقام التقرير</h2>
    <p>شهر الأرقام: {snapshot.month} · وقت قراءة الأرقام: <time dateTime={snapshot.capturedAt}>{snapshot.capturedAt.replace('T', ' ').replace('+03:00', '')}</time> — الرياض.</p>
    <p>لقطة محفوظة من الموقع؛ قد يختلف وقتها عن قطع النص. الأرقام الحالية تبقى في الخلاصة.</p>
    <table><caption>الأرقام الست المحفوظة — ريال</caption><thead><tr><th>البند</th><th>المبلغ</th><th>المصدر</th></tr></thead><tbody>
      {financeSnapshotRows(report).map(row => <tr key={row.id}><th scope="row">{row.label}</th><td><bdi>{row.value === null ? 'تعذرت القراءة وقت الحفظ' : row.value.toLocaleString('ar-SA', { numberingSystem: 'latn', minimumFractionDigits: 2, maximumFractionDigits: 2 })}</bdi></td><td>{row.metric?.coverage}</td></tr>)}
    </tbody></table>
  </section>;
}
