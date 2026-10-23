import { useSweaterMetrics } from '../../hooks/useSweater';

/** Separate read boundary: partners never mount or read company-wide counts. */
export default function IncomeSweaterComparison({ periodKey, washCount }) {
  const { snapshot, loading, error, refetch } = useSweaterMetrics(periodKey);
  if (loading) return <span className="block mt-1">جارٍ قراءة عدد غسلات سويتر…</span>;
  if (error) return <span className="block mt-1" role="status">تعذرت قراءة لقطة سويتر. <button type="button" onClick={refetch} className="underline">إعادة المحاولة</button></span>;
  const count = snapshot?.periodKey === periodKey ? snapshot.metrics?.completedWashes : null;
  if (count == null) return null;
  const at = snapshot.metricSources?.completedWashes?.extractedAtIso;
  return <>
    <span className="block mt-1">سويتر: {count} غسلة مقابل {washCount} مسجلة</span>
    {at && <span className="block mt-1">وقت قراءة سويتر: {new Date(at).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })}</span>}
  </>;
}
