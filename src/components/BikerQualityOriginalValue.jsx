import { formatNumber } from '../data/initialData';

const positiveCount = n => Number.isInteger(n) && n > 0;
const count = n => Number.isInteger(n) && n >= 0;
const fixed = n => new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;

// Display the saved source evidence, never reverse a score to invent source stars.
function ratingMean(report, component) {
  if (!report.sourceIdentity?.externalId || !report.sourceIdentity?.sspId || !positiveCount(component.n)) return null;
  const field = component.key === 'washQuality' ? 'wash' : 'behavior';
  const rows = (report.evidence?.ratings || []).filter(r => r[field]?.n > 0).sort((a, b) => a.from.localeCompare(b.from));
  if (!rows.length || rows.some((r, i) => !validDay(r.from) || !validDay(r.to) || r.from > r.to
    || r.from < report.from || r.to > report.to || (i > 0 && r.from <= rows[i - 1].to)
    || !r.source?.reference || !/^[a-f0-9]{64}$/.test(r.source?.hash || '')
    || !validDay(r.source?.readDate) || r.source.readDate < r.to || r.source.readDate > report.sourceReadDate
    || !positiveCount(r[field].n) || !Number.isFinite(r[field].mean) || r[field].mean < 0 || r[field].mean > 5)) return null;
  const n = rows.reduce((sum, r) => sum + r[field].n, 0);
  if (n !== component.n) return null;
  return { mean: rows.reduce((sum, r) => sum + r[field].mean * r[field].n, 0) / n, combined: rows.length > 1 };
}

export default function BikerQualityOriginalValue({ report, component: c, language, manualConfirmed = false, current = true }) {
  const text = (ar, en) => language === 'en' ? en : ar;
  let label = text('القيمة الأصلية', 'Original value');
  let value = null;
  let note;
  if (['washQuality', 'behavior'].includes(c.key)) {
    const rating = ratingMean(report, c);
    label = text('سويتر · نجوم العينة', 'Sweater · sample stars');
    if (rating) value = `${fixed(rating.mean)} / 5`;
  } else if (c.key === 'productivity') {
    label = text('محسوب من السجلات', 'Calculated from records');
    if (count(c.completed) && positiveCount(c.n) && ['wash-days', 'work-days'].includes(c.unit)) {
      value = `${formatNumber(c.completed)} ÷ ${formatNumber(c.n)} = ${fixed(c.completed / c.n)}`;
    }
    note = c.unit === 'work-days' ? text('غسلة / يوم عمل مثبت', 'washes / verified work day')
      : text('غسلة / يوم فيه غسلات', 'washes / day with washes');
  } else if (c.key === 'duration') {
    label = text('المدة الأصلية · دقيقة', 'Original duration · minutes');
    if (positiveCount(report.duration?.n) && report.duration.n === c.n && Number.isFinite(report.duration.averageMinutes)
      && report.duration.averageMinutes >= 0) value = fixed(report.duration.averageMinutes);
    note = text('متوسط نقاط كل غسلة، وليس نقاط متوسط المدة', 'Average of per-wash points, not points for the average duration');
  } else if (['complaints', 'cancellations', 'lateness', 'statusUpdates'].includes(c.key)) {
    const manual = c.key === 'statusUpdates';
    label = manual ? (current ? text('مدخلات يدوية', 'Manual input') : text('دليل المراجعة التاريخي', 'Historical review evidence'))
      : text('محسوب من السجلات', 'Calculated from records');
    const reviewed = !manual || !current || (manualConfirmed && c.reason === 'manual-status-reviewed');
    if (reviewed && positiveCount(c.n) && count(c.affected) && c.affected <= c.n) {
      value = `${formatNumber(c.affected)} / ${formatNumber(c.n)} ${c.affected === 0 ? '=' : '≈'} ${fixed(c.affected / c.n * 100)}%`;
    }
    note = manual ? (current ? text('مواعيد بملاحظة يدوية / النطاق المؤكد؛ ليست قراءة من سويتر', 'Appointments with manual notes / confirmed scope; not a Sweater reading')
      : text('دليل تاريخي فقط؛ ليس عدد مخالفات عدم التحديث اليدوية الحالية', 'Historical evidence only; not the current manual missing-update count'))
      : text('الحالات المؤهلة والمنسوبة داخل العينة؛ ليست كل التذاكر الخام أو نسبة مباشرة من لوحة سويتر', 'Eligible attributed cases within the sample; not all raw tickets or a direct Sweater dashboard rate');
    if (c.key === 'complaints') note = undefined;
  }
  return <div className="sw-biker-quality__original">
    <small>{label}</small>
    <strong>{value === null ? text('غير متاح', 'Unavailable') : <bdi dir="ltr">{value}</bdi>}</strong>
    {note && <small>{note}</small>}
  </div>;
}
