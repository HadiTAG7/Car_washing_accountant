import {useState} from 'react';
import {useFinanceRead} from '../hooks/useFinanceRead';
import {callFinanceApi} from '../lib/financeApi';
import {PAYROLL_CASH_FUNDING as policy} from '../lib/payrollCashFundingPolicy';
import {Card,PrimaryButton,SecondaryButton} from './UI';
const money=value=>new Intl.NumberFormat('ar-SA',{numberingSystem:'latn',minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
const identity={kind:'payroll_cash_funding',sourceId:policy.reference};
export default function PayrollCashFundingCard({onSaved}){
  const status=useFinanceRead('finance-workbench',{...identity,action:'read'});
  const sources=status.data?.sources;
  const [preview,setPreview]=useState(null),[reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(null);
  const completed=receipt||status.data?.completed;
  async function inspect(){
    setBusy(true);setError('');setPreview(null);setConfirmed(false);
    try{const data=await callFinanceApi('finance-workbench',{...identity,action:'preview',sources});
      if(data.completed){setReceipt(data);status.refresh();}else setPreview(data);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function execute(){
    if(!preview||!confirmed||!reason.trim())return;
    setBusy(true);setError('');
    try{const saved=await callFinanceApi('finance-workbench',{...identity,action:'save',sources,sourceHash:preview.sourceHash,
      previewHash:preview.previewHash,previewedAt:preview.previewedAt,reason:reason.trim(),confirm:true});
      // A lost response never leads to an automatic second write.
      const after=await callFinanceApi('finance-workbench',{...identity,action:'read'});
      if(!after.completed||after.entryId!==saved.entryId||after.sourceHash!==saved.sourceHash)throw new Error('لم تتطابق قراءة إيصال التصحيح؛ اقرأ الحالة قبل أي إعادة.');
      setReceipt(after);setPreview(null);status.refresh();onSaved?.(after.entryId);
    }catch(e){setPreview(null);setConfirmed(false);setError(e.message);status.refresh();}finally{setBusy(false);}
  }
  if(!status.allowed)return null;
  return <Card className="p-4 sm:p-5 space-y-4">
    <h2 className="font-bold text-lg">تمويل الرواتب النقدية المعتمد</h2>
    <p className="text-sm">قيد واحد: مدين الصندوق، ودائن البنك، بمبلغ {money(policy.amountHalala)} ريال. إثبات تمويل سابق، بلا سحب جديد أو صرف رواتب.</p>
    <p className="text-xs">الرواتب والعهد تبقى كما هي. تاريخ التصحيح: {policy.date}.</p>
    <p className="text-xs">السحب كان بداية كل شهر وفق إفادة هادي؛ اليوم الدقيق غير متاح. تاريخ القيد لا يحدد تاريخ السحب.</p>
    <details><summary>قرار هادي ومرجع الطلب</summary><p dir="ltr" className="break-all">{policy.reference}</p><p dir="ltr" className="break-all">{policy.ownerMessage}</p></details>
    {(error||status.error)&&<p role="alert">{error||status.error}</p>}
    {status.loading?<p role="status">جارٍ قراءة حالة التمويل...</p>:completed?<div role="status"><p>التمويل محفوظ؛ لن يُسجّل مرة ثانية.</p><p>رقم القيد: {(receipt||status.data).entryNumber}</p></div>:<>
      <SecondaryButton disabled={busy||!sources||Boolean(status.error)} onClick={inspect}>معاينة التمويل دون حفظ</SecondaryButton>
      {preview&&<>
        <p>المعاينة صالحة لخمس دقائق. أي تغير في المصادر أو الدفتر يرفض الحفظ.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>الحساب</th><th>قبل التصحيح</th><th>بعد التصحيح</th></tr></thead><tbody>
          <tr><th>الصندوق</th><td><bdi>{money(preview.before.cashHalala)}</bdi></td><td><bdi>{money(preview.after.cashHalala)}</bdi></td></tr>
          <tr><th>البنك</th><td><bdi>{money(preview.before.bankHalala)}</bdi></td><td><bdi>{money(preview.after.bankHalala)}</bdi></td></tr>
        </tbody></table></div>
        <p>{preview.sourceCount} مصدرًا · {preview.baseline.entries} قيدًا قبل التصحيح.</p>
        <details><summary>المصادر والقيود المرتبطة</summary><ul>{preview.sources.map(s=><li key={s.journalId} className="py-2 break-all">{s.title} · {money(s.netCashCreditHalala)} ريال <small dir="ltr">{s.journalId} · {s.journalIds.join(', ')}</small></li>)}</ul></details>
        <details><summary>حماية سجلات الرواتب والعهد</summary><p>مسيرات: {preview.protectedDomains.payrollRuns.count} · بنود: {preview.protectedDomains.payrollItems.count} · دفعات: {preview.protectedDomains.payrollPayments.count} · سجلات مؤقتة: {preview.protectedDomains.temporaryExpenses.count}</p></details>
        <label className="block">سبب التصحيح <input className="block w-full rounded-control border p-2 bg-transparent" value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} /></label>
        <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>أؤكد تنفيذ القيد المعتمد مرة واحدة دون دفع أو تعديل القيود السابقة</label>
        <PrimaryButton disabled={busy||!confirmed||reason.trim().length<3} onClick={execute}>تسجيل التمويل المعتمد مرة واحدة</PrimaryButton>
      </>}
    </>}
    <SecondaryButton onClick={()=>{setPreview(null);setConfirmed(false);status.refresh();}} disabled={busy}>قراءة حالة التمويل</SecondaryButton>
  </Card>;
}
