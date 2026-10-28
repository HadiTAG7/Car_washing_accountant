import { usePartnerView } from '../contexts/PartnerViewContext';
import { useOperationsWorkspace } from '../hooks/useOperationsWorkspace';
import { operationsReadinessText } from '../lib/operationsWorkspace';
export default function OperationsReadinessBanner({periodKey}) {
  const view=usePartnerView();
  return view.role==='admin'&&!view.isPartnerView?<BannerContent periodKey={periodKey}/>:<a href={`?page=operations_close&period=${periodKey}`}>جاهزية شهر التشغيل · مراجعة فحص العمليات مطلوبة</a>;
}
function BannerContent({periodKey}) {
  const read=useOperationsWorkspace(periodKey);
  return <div className="rounded-control border border-slate-300 dark:border-slate-700 p-3 my-3 text-sm" aria-label="شرط جاهزية العمليات">
    <a className={read.value.ready&&!read.loading&&!read.error?'text-emerald-600 dark:text-emerald-400':'text-rose-600 dark:text-rose-400'} href={`?page=operations_close&period=${periodKey}`}>
      {read.loading?'جارٍ فحص شهر التشغيل...':read.error?'جاهزية العمليات غير متاحة':operationsReadinessText(read.value)} · إقفال شهر التشغيل
    </a><p className="text-xs mt-1">شرط تشغيلي ظاهر للقراءة فقط؛ لا يحل محل الاعتماد والمطابقة المالية.</p>
  </div>;
}
