import { useBikers } from '../hooks/useBikers';
import { useWashes } from '../hooks/useWashes';
import { useIncomePayrollPreviews } from '../hooks/useIncomePayrollPreviews';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { overviewOperations } from '../lib/overviewDashboard';
import { riyadhTodayISO } from '../lib/washesYesterday';

function CapacityData() {
  const today = riyadhTodayISO(), month = today.slice(0, 7);
  const bikers = useBikers(), washes = useWashes({ months: [month] });
  const payroll = useIncomePayrollPreviews(month, { enabled: true, months: [month] });
  const preview = payroll.data?.find(row => row.periodKey === month && !row.unavailable);
  const ops = overviewOperations({ washes: washes.items, bikers: bikers.bikers, periodKey: month, today });
  const inPayroll = payroll.loading ? '…' : payroll.error || !preview ? 'غير متاح' : new Set(preview.lines.map(row => row.bikerId)).size;
  const working = bikers.loading || washes.loading ? '…' : bikers.error || washes.error || ops?.conflicts.length ? 'غير متاح' : ops?.working ?? 'غير متاح';
  return <section aria-label="طاقة تجهيز التأسيس" className="rounded-card border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-2">
    <h2 className="font-bold text-lg">مجهّز لـ50 بايكر · في المسير {inPayroll} · يشتغلون {working}</h2>
    <p className="text-xs text-slate-500 dark:text-slate-400">{month} · المسير من معاينة الرواتب، ويشتغلون من بايكرز مرتبطين بغسلات مكتملة فعلية في الشهر؛ ليس إثبات حضور.</p>
    {(bikers.error || washes.error || payroll.error) && <p role="alert">تعذرت قراءة بعض بيانات الطاقة؛ لم تُعرض بصفر.</p>}
  </section>;
}
export default function StartupCapacityCard() {
  const { role } = usePartnerView();
  return ['admin', 'accountant'].includes(role) ? <CapacityData /> : <section className="rounded-card border p-5">مجهّز لـ50 بايكر · تفاصيل المسير للإدارة المختصة.</section>;
}
