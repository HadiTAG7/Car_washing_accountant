import { useEffect, useState } from 'react';
import { z } from 'zod';
import { auth } from '../lib/firebaseClient';
import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { executiveDay, parseExecutiveReport } from '../lib/executiveReportContract';

const reportId=z.string().regex(/^ceo-digest-\d{4}-\d{2}-\d{2}$/);
const revision=z.number().int().min(1).max(999999);
const historyItem=z.object({revision,reason:z.string().min(1).max(1500),savedAt:z.string().datetime()});
const archiveItem=z.object({reportId,dateRiyadh:executiveDay,title:z.string().min(1).max(160),revision,cutAtRiyadh:z.string().datetime({offset:true})})
  .refine(r=>r.reportId===`ceo-digest-${r.dateRiyadh}`);

export async function requestExecutiveReport(input,signal,expectedUid){
  const user=auth.currentUser;
  if(!user)throw new Error('تسجيل الدخول مطلوب.');
  if(expectedUid&&user.uid!==expectedUid)throw new Error('تغيرت الجلسة؛ لم يُرسل الطلب.');
  const token=await user.getIdToken();
  if(auth.currentUser?.uid!==user.uid)throw new Error('تغيرت الجلسة؛ لم يُرسل الطلب.');
  const response=await fetch('/api/executive-reports',{method:'POST',cache:'no-store',signal,
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input)});
  const body=await response.json();
  if(auth.currentUser?.uid!==user.uid)throw new Error('تغيرت الجلسة؛ أُهملت نتيجة الطلب.');
  if(!response.ok||body.error||!body.result)throw new Error(body.error?.message||'تعذّر تحميل التقرير.');
  if(input.action==='read'){
    if(!z.array(historyItem).max(30).safeParse(body.result.history).success)throw new Error('سجل النسخ غير صالح.');
    if(body.result.report){
      body.result.report=parseExecutiveReport(body.result.report);
      if(body.result.report.reportId!==input.reportId||(input.revision&&body.result.report.revision!==input.revision)
        ||!Number.isInteger(body.result.currentRevision)||body.result.currentRevision<body.result.report.revision)
        throw new Error('النسخة المقروءة لا تطابق التقرير المطلوب.');
    }else if(body.result.report!==null)throw new Error('محتوى التقرير غير صالح.');
  }
  if(input.action==='list'&&(!z.array(archiveItem).max(30).safeParse(body.result.items).success
    ||!executiveDay.nullable().safeParse(body.result.nextBefore).success))throw new Error('أرشيف غير صالح.');
  if(input.action==='save'&&(!z.object({reportId,revision,duplicate:z.boolean()}).safeParse(body.result).success
    ||body.result.reportId!==input.report.reportId||body.result.revision!==input.report.revision))throw new Error('نتيجة الحفظ غير مؤكدة؛ اقرأ النسخة قبل إعادة المحاولة.');
  return body.result;
}

export function useExecutiveReportQuery(input,refresh=0){
  const {session}=useAuth(),{role,isPartnerView}=usePartnerView();
  const allowed=role==='admin'&&!isPartnerView&&Boolean(session?.user?.id);
  const query=JSON.stringify(input),key=`${session?.user?.id}|${role}|${isPartnerView}|${query}|${refresh}`;
  const [state,setState]=useState({key:'',data:null,error:null});
  useEffect(()=>{
    if(!allowed||query==='null')return undefined;
    const controller=new AbortController();let active=true;
    const timer=setTimeout(()=>controller.abort(),30000);
    requestExecutiveReport(JSON.parse(query),controller.signal,session?.user?.id).then(data=>{if(active)setState({key,data,error:null});})
      .catch(error=>{if(active)setState({key,data:null,error:error.name==='AbortError'?'انتهت مهلة قراءة التقرير.':error.message});})
      .finally(()=>clearTimeout(timer));
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  // Serialized identity prevents new object references from refetching.
  },[allowed,key,query,session?.user?.id]);
  const current=allowed&&state.key===key;
  return {allowed,loading:allowed&&Boolean(input)&&!current,data:current?state.data:null,error:current?state.error:null};
}
