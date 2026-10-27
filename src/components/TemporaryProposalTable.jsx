import { useState } from 'react';
import ScrollableTable from './ScrollableTable';
import { formatCurrencyPrecise, formatDate } from '../data/initialData';
import { displayBikerName } from '../lib/bikerNames';
import { useLanguage } from '../i18n/useLanguage';

export default function TemporaryProposalTable({ rows, bikers = [], showDestination = false }) {
  const [search, setSearch] = useState('');
  const { language } = useLanguage();
  const name = row => { const biker=bikers.find(b=>b.id===row.bikerId); return biker ? displayBikerName(biker,language) : row.bikerId ? 'بايكر غير موجود في السجل' : 'سجل عام أو جماعي'; };
  const visible = rows.filter(row=>`${row.title} ${name(row)} ${row.date||''}`.toLocaleLowerCase('ar').includes(search.trim().toLocaleLowerCase('ar')));
  return <div className="space-y-3">
    <label className="block text-sm">بحث في السجلات <input type="search" className="sw-input block w-full mt-1" value={search} onChange={e=>setSearch(e.target.value)} /></label>
    <p className="text-sm">عدد السجلات: {visible.length} · مجموع المبالغ: {formatCurrencyPrecise(visible.reduce((sum,row)=>sum+row.amount,0))}</p>
    <ScrollableTable><table className="w-full text-sm text-right"><thead><tr>
      {['الوصف','المبلغ','التاريخ','البايكر','حالة الاسترداد','المعلق',...(showDestination?['المكان المقترح']:[]),'ملاحظة'].map(label=><th key={label} className="p-3">{label}</th>)}
    </tr></thead><tbody>{visible.map(row=><tr key={row.id} className="border-t border-slate-200 dark:border-slate-700">
      <td className="p-3 min-w-56">{row.title}</td><td className="p-3 whitespace-nowrap">{formatCurrencyPrecise(row.amount)}</td>
      <td className="p-3 whitespace-nowrap">{row.date?formatDate(row.date):'تاريخ غير مسجل'}</td><td className="p-3">{name(row)}{row.assignmentMonth&&<small className="block">شهر الإسناد: <bdi>{row.assignmentMonth}</bdi></small>}</td>
      <td className="p-3">{row.status==='recovered'?'مسترد حسب الحالة المحفوظة':row.outstanding<row.amount?'مسترد جزئيًا':'بانتظار الاسترداد'}</td>
      <td className="p-3 whitespace-nowrap">{formatCurrencyPrecise(row.outstanding)}</td>{showDestination&&<td className="p-3">{row.destination}</td>}
      <td className="p-3 min-w-56">{row.note}</td>
    </tr>)}</tbody></table></ScrollableTable>
    {!visible.length&&<p>ما فيه سجلات في هذه النتيجة.</p>}
  </div>;
}
