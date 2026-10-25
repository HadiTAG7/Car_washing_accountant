import {useState} from 'react';
import {useFinanceRead} from '../hooks/useFinanceRead';
import {callFinanceApi} from '../lib/financeApi';
import {CASH_BANK_CORRECTION as policy} from '../lib/cashBankCorrectionPolicy';
import {Card,PrimaryButton,SecondaryButton} from './UI';
const money=value=>new Intl.NumberFormat('ar-SA',{numberingSystem:'latn',minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
const identity={kind:'cash_bank_correction',sourceId:policy.reference};
export default function CashBankCorrectionCard({onSaved}){
  const status=useFinanceRead('finance-workbench',{...identity,action:'read'});
  const [sources,setSources]=useState(null),[preview,setPreview]=useState(null),[reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(null);
  const completed=receipt||status.data?.completed;
  async function loadFile(e){
    setPreview(null);setSources(null);setConfirmed(false);setError('');
    try{const file=e.target.files?.[0];if(!file)return;if(file.size>1000000)throw new Error('حجم ملف القائمة أكبر من المسموح.');
      const parsed=JSON.parse(await file.text());
      const values=Array.isArray(parsed)?parsed:parsed.sources;
      if(!Array.isArray(values)||values.length!==policy.sourceCount)throw new Error('يلزم ملف المصادر المعتمدة الـ79.');
      setSources(values.map(s=>({source:s.source,netCashCreditHalala:s.netCashCreditHalala})));
    }catch(e){setError(e.message);}
  }
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
    <h2 className="font-bold text-lg">تصحيح الصندوق المعتمد</h2>
    <p className="text-sm">قيد واحد: مدين الصندوق، ودائن البنك، بمبلغ {money(policy.amountHalala)} ريال. لا تحويل أموال ولا تعديل قيود سابقة.</p>
    <p className="text-xs">الرواتب والعهد خارج النطاق. التاريخ المعتمد: {policy.date}.</p>
    <details><summary>قرار هادي ومرجع الطلب</summary><p dir="ltr" className="break-all">{policy.reference}</p><p dir="ltr" className="break-all">{policy.ownerMessage}</p></details>
    {(error||status.error)&&<p role="alert">{error||status.error}</p>}
    {status.loading?<p role="status">جارٍ قراءة حالة التصحيح...</p>:completed?<div role="status"><p>التصحيح محفوظ؛ لن يُنفذ مرة ثانية.</p><p>رقم القيد: {(receipt||status.data).entryNumber}</p></div>:<>
      <label className="block">قائمة المصادر المعتمدة <input type="file" accept="application/json,.json" onChange={loadFile} disabled={busy} /></label>
      <SecondaryButton disabled={busy||!sources||Boolean(status.error)} onClick={inspect}>معاينة التصحيح دون حفظ</SecondaryButton>
      {preview&&<>
        <p>المعاينة صالحة لخمس دقائق. أي تغير في المصادر أو الدفتر يرفض الحفظ.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>الحساب</th><th>قبل التصحيح</th><th>بعد التصحيح</th></tr></thead><tbody>
          <tr><th>الصندوق</th><td><bdi>{money(preview.before.cashHalala)}</bdi></td><td><bdi>{money(preview.after.cashHalala)}</bdi></td></tr>
          <tr><th>البنك</th><td><bdi>{money(preview.before.bankHalala)}</bdi></td><td><bdi>{money(preview.after.bankHalala)}</bdi></td></tr>
        </tbody></table></div>
        <p>{preview.sourceCount} مصدرًا · {preview.baseline.entries} قيدًا قبل التصحيح.</p>
        <details><summary>المصادر والقيود المرتبطة</summary><ul>{preview.sources.map(s=><li key={s.source} className="py-2 break-all">{s.title} · {money(s.netCashCreditHalala)} ريال <small dir="ltr">{s.source} · {s.journalIds.join(', ')}</small></li>)}</ul></details>
        <label className="block">سبب التصحيح <input className="block w-full rounded-control border p-2 bg-transparent" value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} /></label>
        <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>أؤكد تنفيذ القيد المعتمد مرة واحدة دون دفع أو تعديل القيود السابقة</label>
        <PrimaryButton disabled={busy||!confirmed||reason.trim().length<3} onClick={execute}>تنفيذ التصحيح المعتمد مرة واحدة</PrimaryButton>
      </>}
    </>}
    <SecondaryButton onClick={()=>{setPreview(null);setConfirmed(false);status.refresh();}} disabled={busy}>قراءة حالة التصحيح</SecondaryButton>
  </Card>;
}
