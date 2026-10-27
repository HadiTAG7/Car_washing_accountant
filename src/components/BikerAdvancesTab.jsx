import { Card, SectionHeader } from './UI';
import { temporaryProposals } from '../lib/administrationClassification';
import TemporaryProposalTable from './TemporaryProposalTable';
import { formatCurrencyPrecise } from '../data/initialData';

export default function BikerAdvancesTab({ expenses = [], bikers = [], loading, error, onPayroll }) {
  const rows=temporaryProposals(expenses).filter(row=>row.group==='advances');
  return <Card className="p-4 sm:p-5 space-y-4">
    <SectionHeader title="السلف" subtitle="معاينة التصنيف المقترح — لم تُنقل السجلات أو تتغير حالات استردادها" />
    <p className="text-sm">السلف المرتبطة ببايكر تظهر للمسير من نفس السجل. الخصم يدوي وبحده الحالي؛ لم تتغير قاعدة الخصم.</p>
    {!loading&&!error&&<p className="font-semibold">السلف المعلقة: {rows.filter(row=>row.outstanding>0).length} · {formatCurrencyPrecise(rows.reduce((sum,row)=>sum+row.outstanding,0))}</p>}
    <button type="button" className="sw-button sw-button--secondary" onClick={onPayroll}>فتح مسير الرواتب</button>
    {loading?<p role="status">جارٍ قراءة السلف...</p>:error?<p role="alert">تعذرت قراءة السلف؛ الأرقام غير متاحة.</p>:<TemporaryProposalTable rows={rows} bikers={bikers} />}
  </Card>;
}
