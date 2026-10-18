import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthError, callerRole } from '../functions/src/handlers.js';
import { executiveDay, parseExecutiveReport } from '../src/lib/executiveReportContract.js';

// Administrative snapshots only. No operational/financial collection or
// business schema is read or mutated. Existing direct-client default-deny stays.
export const EXECUTIVE_REPORTS='executive_reports';
const id=z.string().regex(/^ceo-digest-\d{4}-\d{2}-\d{2}$/);
const bad=(message,code='invalid-argument')=>{throw new AuthError(message,{code});};
async function adminOnly(db,auth){if(await callerRole(db,auth)!=='admin')bad('التقارير التنفيذية للأدمن فقط.','permission-denied');}
const hash=report=>createHash('sha256').update(JSON.stringify(report)).digest('hex');
const revisionId=n=>String(n).padStart(6,'0');

export async function executiveReports(db,auth,input,now=new Date()){
  await adminOnly(db,auth); // Includes existence/list checks; never trust UI filters.
  const action=input?.action;
  if(action==='list'){
    const parsed=z.object({action:z.literal('list'),before:executiveDay.optional()}).strict().safeParse(input);
    if(!parsed.success)bad('طلب الأرشيف غير صالح.');
    let query=db.collection(EXECUTIVE_REPORTS).orderBy('dateRiyadh','desc');
    if(parsed.data.before)query=query.where('dateRiyadh','<',parsed.data.before);
    const snap=await query.limit(31).get();
    const all=snap.docs.map(doc=>doc.data());
    return {items:all.slice(0,30).map(r=>({reportId:r.reportId,dateRiyadh:r.dateRiyadh,title:r.title,revision:r.revision,cutAtRiyadh:r.cutAtRiyadh})),
      nextBefore:all.length>30?all[29].dateRiyadh:null};
  }
  if(action==='read'){
    const parsed=z.object({action:z.literal('read'),reportId:id,revision:z.number().int().min(1).max(999999).optional()}).strict().safeParse(input);
    if(!parsed.success)bad('طلب التقرير غير صالح.');
    const headRef=db.collection(EXECUTIVE_REPORTS).doc(parsed.data.reportId),head=await headRef.get();
    if(!head.exists)return {report:null,history:[]};
    const data=head.data(),revision=parsed.data.revision||data.revision;
    if(revision>data.revision)bad('النسخة غير موجودة.','not-found');
    const version=await headRef.collection('revisions').doc(revisionId(revision)).get();
    if(!version.exists)bad('نسخة التقرير غير متاحة.','failed-precondition');
    // History metadata is paginated/bounded, never a full department data pull.
    const history=await headRef.collection('revisions').orderBy('revision','desc').limit(30).get();
    return {report:parseExecutiveReport(version.data().report),currentRevision:data.revision,
      history:history.docs.map(doc=>({revision:doc.data().revision,reason:doc.data().report.correctionReason||'الإصدار الأول',savedAt:doc.data().savedAt})),
      historyLimited:history.size===30};
  }
  if(action!=='save')bad('عملية تقارير غير مدعومة.');
  const parsed=z.object({action:z.literal('save'),report:z.unknown(),expectedRevision:z.number().int().min(0).max(999998)}).strict().safeParse(input);
  if(!parsed.success)bad('طلب الحفظ غير صالح.');
  let report;try{report=parseExecutiveReport(parsed.data.report);}catch(error){bad(error.message);}
  if(Date.parse(report.cutAtRiyadh)>now.getTime())bad('لا يُحفظ تقرير بوقت قطع مستقبلي.');
  if(parsed.data.expectedRevision!==report.revision-1)bad('النسخة المتوقعة لا تطابق نسخة التصحيح.');
  const contentHash=hash(report),ref=db.collection(EXECUTIVE_REPORTS).doc(report.reportId);
  return db.runTransaction(async tx=>{
    const authDb={collection:name=>({doc:key=>({get:()=>tx.get(db.collection(name).doc(key))})})};
    await adminOnly(authDb,auth); // Recheck same membership within atomic write.
    const head=await tx.get(ref),versionRef=ref.collection('revisions').doc(revisionId(report.revision));
    const version=await tx.get(versionRef);
    if(version.exists){
      if(version.data().contentHash===contentHash)return {reportId:report.reportId,revision:report.revision,duplicate:true};
      bad('هذه النسخة محفوظة بمحتوى مختلف؛ لا تستبدل التاريخ.','already-exists');
    }
    const current=head.exists?head.data().revision:0;
    if(current!==parsed.data.expectedRevision)bad('وصلت نسخة أحدث؛ أعد قراءة التقرير قبل التصحيح.','failed-precondition');
    const savedAt=now.toISOString();
    tx.create(versionRef,{revision:report.revision,report,contentHash,savedAt,publishedByUid:auth.uid});
    tx.set(ref,{reportId:report.reportId,dateRiyadh:report.dateRiyadh,title:report.title,cutAtRiyadh:report.cutAtRiyadh,
      revision:report.revision,contentHash,savedAt});
    return {reportId:report.reportId,revision:report.revision,duplicate:false};
  });
}
