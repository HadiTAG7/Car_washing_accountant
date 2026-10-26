import { useIdleBikersData } from '../hooks/useIdleBikersData';
export default function IdleBikersAttention({ data, periodKey, today, onNavigate }) {
  const state = useIdleBikersData(data, { periodKey, today });
  if (state.loading) return <p className="text-sm text-slate-500">جارٍ فحص تنبيهات الخمول…</p>;
  if (state.error || !state.value) return <p className="text-sm text-amber-600">تنبيهات الخمول غير متاحة لحين تأكيد الغسلات والمسير.</p>;
  const { alerts } = state.value;
  if (!Object.values(alerts).some(Boolean)) return null;
  return <section className="sw-overview__attention"><div><h3>متابعة الخاملين</h3>
    {alerts.missingReason > 0 && <p>خامل بدون سبب مسجل: <strong>{alerts.missingReason}</strong></p>}
    {alerts.overdue > 0 && <p className="text-rose-500">تاريخ البدء المتوقع فات: <strong>{alerts.overdue}</strong></p>}
    {alerts.over14Days > 0 && <p className="text-rose-500">خامل أكثر من 14 يوم: <strong>{alerts.over14Days}</strong></p>}
    <button className="sw-overview__link" type="button" onClick={() => {
      const url = new URL(window.location.href); url.searchParams.set('bikerTab', 'idle'); window.history.replaceState(null, '', url);
      onNavigate?.('bikers');
    }}>فتح الخاملين</button>
  </div></section>;
}
