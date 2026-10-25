import {useState} from 'react';
import {useFinanceRead} from '../hooks/useFinanceRead';
import {callFinanceApi} from '../lib/financeApi';
const policies=[{reference:'CEO-TEMPORARY-BANK-RECLASS-20261025-v1',title:'تصحيح جهة سداد المؤقتات المعتمد',amountHalala:1735000,debit:'الصندوق',credit:'البنك'},
  {reference:'CEO-EXCESS-REVERSAL-30-20261025-v1',title:'تصحيح العكس الزائد المعتمد',amountHalala:3000,debit:'الأصول الثابتة',credit:'الصندوق'}];
import {Card,PrimaryButton,SecondaryButton} from './UI';
const money=value=>new Intl.NumberFormat('ar-SA',{numberingSystem:'latn',minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
function ResidualCorrectionCard({policy,onSaved}){
  const identity={kind:'cash_residual_correction',sourceId:policy.reference};
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
    <h2 className="font-bold text-lg">{policy.title}</h2>
    <p className="text-sm">قيد واحد: مدين {policy.debit}، ودائن {policy.credit}، بمبلغ {money(policy.amountHalala)} ريال. تصحيح معتمد دون دفع جديد أو تعديل المصدر.</p>
    <p className="text-xs">الرواتب والعهد تبقى كما هي. تاريخ التصحيح: 2026-10-25.</p>
    <p className="text-xs">تاريخ القيد للتصحيح فقط. أكمل تصحيح المؤقتات قبل تصحيح العكس الزائد؛ حقائق الدفع الأصلية تبقى كما هي.</p>
    <details><summary>قرار هادي ومرجع الطلب</summary><p dir="ltr" className="break-all">{policy.reference}</p><p dir="ltr" className="break-all">01a172c7-01db-77e1-8fc1-a69b3e817f5e</p></details>
    {(error||status.error)&&<p role="alert">{error||status.error}</p>}
    {status.loading?<p role="status">جارٍ قراءة حالة التصحيح المحدد...</p>:completed?<div role="status"><p>التصحيح محفوظ؛ لن يُسجّل مرة ثانية.</p><p>رقم القيد: {(receipt||status.data).entryNumber}</p></div>:<>
      <SecondaryButton disabled={busy||!sources||Boolean(status.error)} onClick={inspect}>معاينة التصحيح دون حفظ</SecondaryButton>
      {preview&&<>
        <p>المعاينة صالحة لخمس دقائق. أي تغير في المصادر أو الدفتر يرفض الحفظ.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>الحساب</th><th>قبل التصحيح</th><th>بعد التصحيح</th></tr></thead><tbody>
          <tr><th>الصندوق</th><td><bdi>{money(preview.before.cashHalala)}</bdi></td><td><bdi>{money(preview.after.cashHalala)}</bdi></td></tr>
          <tr><th>الأصول الثابتة</th><td><bdi>{money(preview.before.assetHalala)}</bdi></td><td><bdi>{money(preview.after.assetHalala)}</bdi></td></tr>
          <tr><th>البنك</th><td><bdi>{money(preview.before.bankHalala)}</bdi></td><td><bdi>{money(preview.after.bankHalala)}</bdi></td></tr>
        </tbody></table></div>
        <p>{preview.sourceCount} مصدرًا · {preview.baseline.entries} قيدًا قبل التصحيح.</p>
        <details><summary>المصادر والقيود المرتبطة</summary><ul>{preview.sources.map(s=><li key={s.journalId} className="py-2 break-all">{s.title} · {money(s.netCashCreditHalala)} ريال <small dir="ltr">{s.journalId} · {s.journalIds.join(', ')}</small></li>)}</ul></details>
        <details><summary>حماية سجلات الرواتب والعهد</summary><p>مسيرات: {preview.protectedDomains.payrollRuns.count} · بنود: {preview.protectedDomains.payrollItems.count} · دفعات: {preview.protectedDomains.payrollPayments.count} · سجلات مؤقتة: {preview.protectedDomains.temporaryExpenses.count}</p></details>
        <label className="block">سبب التصحيح <input className="block w-full rounded-control border p-2 bg-transparent" value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} /></label>
        <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>أؤكد تنفيذ القيد المعتمد مرة واحدة دون دفع أو تعديل القيود السابقة</label>
        <PrimaryButton disabled={busy||!confirmed||reason.trim().length<3} onClick={execute}>تسجيل التصحيح المعتمد مرة واحدة</PrimaryButton>
      </>}
    </>}
    <SecondaryButton onClick={()=>{setPreview(null);setConfirmed(false);status.refresh();}} disabled={busy}>قراءة حالة التصحيح المحدد</SecondaryButton>
  </Card>;
}

export default function CashResidualCorrections({onSaved}){return <>{policies.map(policy=><ResidualCorrectionCard key={policy.reference} policy={policy} onSaved={onSaved}/>)}</>;}
