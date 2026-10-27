import { Card, SectionHeader } from './UI';
import { useTemporaryExpenses } from '../hooks/useTemporaryExpenses';
import { useBikers } from '../hooks/useBikers';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { temporaryProposals } from '../lib/administrationClassification';
import TemporaryProposalTable from './TemporaryProposalTable';
import AdministrationShareTable from './AdministrationShareTable';

function AdministrationContent() {
  const data=useTemporaryExpenses(), workers=useBikers();
  const rows=temporaryProposals(data.expenses||[]);
  return <main className="p-4 sm:p-6 space-y-5" dir="rtl">
    <div role="status" className="sw-alert sw-alert--warning p-4 rounded-xl border border-amber-500/40">
      <h2 className="font-bold">معاينة التصنيف المقترح</h2>
      <p>لم يُنقل أي سجل أو قيد. اعتماد جدول هادي مطلوب قبل تغيير التصنيف أو الاسترداد.</p>
      <a className="underline" href="?page=bikers&bikerTab=advances">عرض سلف البايكرية في صفحة البايكر</a>
    </div>
    <Card className="p-4 sm:p-5 space-y-3"><SectionHeader title="حصة الإدارة" /><AdministrationShareTable /></Card>
    {data.loading||workers.loading?<p role="status">جارٍ قراءة السجلات...</p>:data.error||workers.error?<p role="alert">تعذرت قراءة السجلات؛ المبالغ غير متاحة.</p>:<>
      {[['salary','رواتب الإدارة'],['official','الرسوم الحكومية والرسمية']].map(([group,title])=><Card className="p-4 sm:p-5 space-y-3" key={group}>
        <SectionHeader title={title}/><TemporaryProposalTable rows={rows.filter(row=>row.group===group)} bikers={workers.bikers}/>
      </Card>)}
      <Card className="p-4 sm:p-5 space-y-3"><SectionHeader title="عهد الإدارة المعلقة" />
        <p>لا توجد عهد إدارة محددة من الوصف. المصاريف المقترحة أعلاه ما زالت بحالتها الأصلية حتى الموافقة.</p>
        <TemporaryProposalTable rows={rows.filter(row=>row.group==='review'&&row.outstanding>0)} bikers={workers.bikers} showDestination/>
      </Card>
      <Card className="p-4 sm:p-5 space-y-3"><SectionHeader title="بنود مقترحة للسكن" />
        <TemporaryProposalTable rows={rows.filter(row=>row.group==='housing')} bikers={workers.bikers} showDestination/>
      </Card>
      <details className="sw-card p-4"><summary className="cursor-pointer font-bold">جدول التصنيف الكامل — كل السجلات الأصلية</summary>
        <TemporaryProposalTable rows={rows} bikers={workers.bikers} showDestination/>
      </details>
    </>}
  </main>;
}
export default function AdministrationExpensesPage() {
  const view=usePartnerView();
  return !view.isPartnerView&&['admin','accountant'].includes(view.role)?<AdministrationContent/>:<p className="p-6">عرض مصاريف الإدارة متاح للإدارة والمحاسبة.</p>;
}
