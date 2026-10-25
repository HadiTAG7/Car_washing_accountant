import {z} from 'zod';
import {FieldValue} from 'firebase-admin/firestore';
import {callerRole} from '../functions/src/handlers.js';
import {financeHash,FinanceReviewError} from '../functions/src/financeReview.js';
import {normalizeEntry,normalizeLines,validateEntry,journalCounterUpdate,postingLockId} from '../functions/src/invariants.js';
import {postedLines} from '../src/lib/accounting/reports.js';
import {PAYROLL_CASH_FUNDING} from './payrollCashFundingPolicy.js';

const fail=(message,code='failed-precondition')=>{throw new FinanceReviewError(message,code);};
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const source=z.object({journalId:z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),netCashCreditHalala:z.number().int().positive().safe()}).strict();
const sorted=list=>[...list].sort((a,b)=>a.journalId<b.journalId?-1:a.journalId>b.journalId?1:0);
const pairs=list=>sorted(list.map(({journalId,netCashCreditHalala})=>({journalId,netCashCreditHalala})));
const rows=snap=>snap.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
const core=entry=>Object.fromEntries(Object.entries(entry).filter(([k])=>!['createdAt','postedAt'].includes(k)));
const authDb=(db,tx)=>({collection:name=>({doc:id=>({get:()=>tx.get(db.collection(name).doc(id))})})});
const cents=value=>{const n=value??0;if(typeof n!=='number'||!Number.isFinite(n)||Math.abs(n*100-Math.round(n*100))>1e-5)fail('مبلغ دفتري غير صالح بالهللة.');return Math.round(n*100);};
const summary=list=>({count:list.length,hash:financeHash(list)});

/** Tests may inject a synthetic frozen policy. The HTTP route never accepts one. */
export function createPayrollCashFunding(policy=PAYROLL_CASH_FUNDING,clock=()=>new Date()){
  const entryId=`payroll_funding_${financeHash(policy.reference).slice(0,40)}`;
  const receiptId=`payroll_funding_${financeHash(policy.reference)}`;
  const common={kind:z.literal('payroll_cash_funding'),sourceId:z.literal(policy.reference)};
  const schema=z.discriminatedUnion('action',[
    z.object({action:z.literal('read'),...common}).strict(),
    z.object({action:z.literal('preview'),...common,sources:z.array(source).length(4)}).strict(),
    z.object({action:z.literal('save'),...common,sources:z.array(source).length(4),sourceHash:digest,previewHash:digest,
      previewedAt:z.string().datetime(),reason:z.string().trim().min(3).max(1000),confirm:z.literal(true)}).strict(),
  ]);
  const receiptRef=db=>db.collection('finance_workbench_receipts').doc(receiptId);
  const journalRef=db=>db.collection('journal_entries').doc(entryId);
  async function snapshot(db,tx){
    const names=['journal_entries','journal_lines','payroll_runs','temporary_expenses','finance_workbench_receipts','posting_locks'];
    const snaps=await Promise.all(names.map(n=>tx.get(db.collection(n))));
    const tables=Object.fromEntries(names.map((n,i)=>[n,rows(snaps[i])]));
    const children=await Promise.all(tables.payroll_runs.flatMap(run=>['items','payments'].map(async kind=>({kind,runId:run.id,
      values:rows(await tx.get(db.collection('payroll_runs').doc(run.id).collection(kind)))}))));
    const childRows=kind=>children.filter(c=>c.kind===kind).flatMap(c=>c.values.map(row=>({...row,parentRunId:c.runId})));
    const protectedDomains={payrollRuns:summary(tables.payroll_runs),payrollItems:summary(childRows('items')),
      payrollPayments:summary(childRows('payments')),temporaryExpenses:summary(tables.temporary_expenses),
      priorReceipts:summary(tables.finance_workbench_receipts.filter(r=>r.id!==receiptId)),
      priorLocks:summary(tables.posting_locks.filter(r=>r.sourceId!==policy.reference)),
      originalEntries:summary(tables.journal_entries.filter(e=>e.id!==entryId)),legacyLines:summary(tables.journal_lines)};
    return {tables,children,protectedDomains};
  }
  async function status(db,tx){
    const [receipt,journal]=await Promise.all([tx.get(receiptRef(db)),tx.get(journalRef(db))]);
    if(!receipt.exists&&!journal.exists)return {sourceId:policy.reference,status:'pending',completed:false,
      sourceHash:financeHash({reference:policy.reference,status:'pending'}),sources:pairs(policy.sources),financialPosting:false};
    if(!receipt.exists||!journal.exists||receipt.data().entryHash!==financeHash(core(journal.data())))
      fail('سجل التمويل يحتاج مراجعة؛ اقرأ الحالة ولا تُنشئ بديلًا.');
    return {...receipt.data().result,completed:true,status:'completed',entry:journal.data(),currentProtection:(await snapshot(db,tx)).protectedDomains};
  }
  async function plan(db,tx,auth,r,previewedAt){
    if(new Set(r.sources.map(s=>s.journalId)).size!==4||financeHash(pairs(r.sources))!==financeHash(pairs(policy.sources)))
      fail('الأصول الأربعة أو صافي مبالغها لا تطابق اعتماد هادي.','invalid-argument');
    const snap=await snapshot(db,tx),{tables}=snap,entries=tables.journal_entries;
    const allLines=entries.flatMap(e=>(e.lines||[]).map((l,i)=>({...l,entryId:e.id,id:`${e.id}:${i}`}))).concat(tables.journal_lines);
    const lines=postedLines(entries,allLines),ids=new Set(policy.sources.map(s=>s.journalId));
    if(entries.some(e=>e.sourceId===policy.reference||e.description?.includes(policy.reference)
      ||e.payrollCashFunding?.sources?.some(s=>ids.has(s.journalId))))fail('يوجد تمويل سابق مرتبط بالمرجع أو قيود الرواتب.');
    const sources=policy.sources.map(s=>{
      const e=entries.find(e=>e.id===s.journalId),runId=s.payrollSource.slice('payroll:'.length);
      if(!e||financeHash(e)!==policy.originalEntryHashes[s.journalId])fail('أصل راتب تغير أو فُقد؛ راجع القائمة المجمدة.');
      if(e.entryNumber!==s.journalNumber||e.entryDate!==s.existingEntryDate||e.status!=='posted'||e.sourceType!=='payroll'
        ||e.sourceId!==runId||e.payrollSnapshot?.runId!==runId||e.payrollSnapshot?.accounts?.payment!=='1010'
        ||!tables.payroll_runs.some(run=>run.id===runId))fail('أصل راتب لا يطابق المسير النقدي المعتمد.');
      if(entries.some(x=>String(x.reversalOf??'')===e.id||String(x.reversalOf??'')===String(e.entryNumber)))fail('أصل راتب له عكس؛ لا تمويل افتراضي.');
      const movement=lines.filter(l=>l.entryId===e.id);
      const net=code=>movement.filter(l=>String(l.accountId)===code).reduce((n,l)=>n+cents(l.credit)-cents(l.debit),0);
      if(net('1010')!==s.netCashCreditHalala||net('1020')!==0||cents(e.payrollSnapshot?.totals?.net)!==s.netCashCreditHalala)
        fail('أثر راتب على الصندوق أو البنك لا يطابق الصافي المعتمد.');
      return {...s,title:`رواتب ${runId.slice(0,7)} — القيد ${s.journalNumber}`,journalIds:[e.id]};
    });
    if(sources.reduce((n,s)=>n+s.netCashCreditHalala,0)!==policy.amountHalala||financeHash(policy.sources)!==policy.sourceListHash)
      fail('سياسة التمويل المجمدة غير متطابقة.');
    const periodRef=db.collection('accounting_periods').doc(policy.date.slice(0,7)),counterRef=db.collection('counters').doc('journal');
    const globalLock=db.collection('posting_locks').doc(postingLockId('payroll_cash_funding',policy.reference));
    // Three September payments share a run. Locks belong to original journal IDs, never run IDs.
    const sourceLocks=sources.map(s=>db.collection('posting_locks').doc(`payroll_funding_source__${financeHash(s.journalId)}`));
    const [period,counter,cash,bank,lock,...locks]=await Promise.all([tx.get(periodRef),tx.get(counterRef),
      tx.get(db.collection('chart_of_accounts').doc('1010')),tx.get(db.collection('chart_of_accounts').doc('1020')),
      tx.get(globalLock),...sourceLocks.map(ref=>tx.get(ref))]);
    if(!period.exists||period.data().status!=='open')fail('فترة التصحيح غير مثبتة كفترة مفتوحة؛ لن تُفتح تلقائيًا.');
    if(lock.exists||locks.some(l=>l.exists))fail('مرجع أو أصل راتب مقفل بتمويل سابق.');
    if(!counter.exists||!Number.isSafeInteger(counter.data().nextNumber)||counter.data().nextNumber<=Math.max(0,...entries.map(e=>Number(e.entryNumber)||0)))fail('عداد القيود يحتاج مراجعة.');
    for(const account of [cash,bank])if(!account.exists||account.data().active===false||account.data().accountType!=='asset')fail('حسابا البنك والصندوق غير متاحين.');
    const entry={...normalizeEntry({entryDate:policy.date,sourceType:'adjustment',sourceId:policy.reference,
      description:`إثبات تمويل الرواتب النقدية السابق — ${policy.reference}`}),sourceKind:'owner_payroll_cash_funding'};
    const entryLines=normalizeLines([{accountId:'1010',debit:policy.amountHalala/100,credit:0,description:'إثبات تمويل سابق لصافي رواتب أغسطس وسبتمبر النقدية'},
      {accountId:'1020',debit:0,credit:policy.amountHalala/100,description:'من بنك الشركة؛ لا سحب جديد ولا تكرار صرف الرواتب'}]);
    const problems=validateEntry(entry,entryLines,{knownAccountCodes:new Set(['1010','1020'])});if(problems.length)fail(problems[0]);
    const balance=code=>lines.filter(l=>String(l.accountId)===code).reduce((n,l)=>n+cents(l.debit)-cents(l.credit),0);
    const before={cashHalala:balance('1010'),bankHalala:balance('1020')},after={cashHalala:before.cashHalala+policy.amountHalala,bankHalala:before.bankHalala-policy.amountHalala};
    const sourceHash=financeHash({actor:auth.uid,role:'admin',policy,...snap,period:period.data(),counter:counter.data(),accounts:[cash.data(),bank.data()]});
    const result={sourceId:policy.reference,preview:true,sourceHash,previewedAt,expiresAt:new Date(Date.parse(previewedAt)+300000).toISOString(),
      sourceListHash:policy.sourceListHash,sourceCount:4,amountHalala:policy.amountHalala,entry,lines:entryLines,before,after,sources,
      protectedDomains:snap.protectedDomains,baseline:{entries:entries.length,lines:allLines.length,journalHash:financeHash(entries)},
      withdrawalTiming:'بداية كل شهر وفق إفادة هادي؛ يوم السحب الدقيق غير متاح',dateMeaning:'تاريخ تصحيح، وليس تاريخ السحب أو صرف الراتب',
      createsPayment:false,createsWithdrawal:false,changesExistingEntries:false};
    result.previewHash=financeHash({sourceHash,entry,lines:entryLines,previewedAt,actor:auth.uid});
    return {...result,internal:{counter,counterRef,globalLock,sourceLocks}};
  }
  return async function run(db,auth,input){
    const parsed=schema.safeParse(input);if(!parsed.success)fail('طلب تمويل الرواتب المعتمد غير صالح.','invalid-argument');
    const r=parsed.data;
    return db.runTransaction(async tx=>{
      if(await callerRole(authDb(db,tx),auth)!=='admin')fail('تمويل الرواتب المعتمد للإدارة فقط.','permission-denied');
      const prior=await status(db,tx);if(r.action==='read')return prior;
      if(new Set(r.sources.map(s=>s.journalId)).size!==4||financeHash(pairs(r.sources))!==financeHash(pairs(policy.sources)))fail('القائمة لا تطابق اعتماد هادي.','invalid-argument');
      if(prior.completed){if(r.action==='save'&&r.reason!==prior.entry.payrollCashFunding.reason)fail('المرجع محفوظ بسبب مختلف؛ اقرأ القيد الموجود.','already-exists');return {...prior,replay:true};}
      const now=clock(),at=r.action==='preview'?now.toISOString():r.previewedAt;
      if(r.action==='save'&&(Date.parse(at)>now.getTime()+30000||now.getTime()-Date.parse(at)>300000))fail('انتهت صلاحية المعاينة؛ اقرأ معاينة جديدة.');
      if(policy.date>now.toISOString().slice(0,10))fail('تاريخ التصحيح مستقبلي.');
      const p=await plan(db,tx,auth,r,at),{internal,...preview}=p;if(r.action==='preview')return preview;
      if(r.sourceHash!==p.sourceHash||r.previewHash!==p.previewHash)fail('تغيرت البيانات أو المستخدم أو المعاينة؛ لم يُحفظ القيد.');
      const funding={reference:policy.reference,sourceListHash:policy.sourceListHash,sourceSnapshotHash:p.sourceHash,
        ownerThread:policy.ownerThread,ownerTurn:policy.ownerTurn,ownerMessage:policy.ownerMessage,
        withdrawalTiming:p.withdrawalTiming,dateMeaning:p.dateMeaning,
        sources:p.sources.map(({journalId,journalNumber,payrollSource,netCashCreditHalala})=>({journalId,journalNumber,payrollSource,netCashCreditHalala})),reason:r.reason};
      const journal={...p.entry,lines:p.lines,lineCount:2,totalDebit:policy.amountHalala/100,totalCredit:policy.amountHalala/100,
        entryNumber:internal.counter.data().nextNumber,createdBy:auth.uid,payrollCashFunding:funding};
      const entryHash=financeHash(journal),receiptHash=financeHash({reference:policy.reference,entryId,entryHash});
      const result={saved:true,sourceId:policy.reference,sourceHash:receiptHash,financialPosting:true,entryId,entryNumber:journal.entryNumber,
        amountHalala:policy.amountHalala,sourceListHash:policy.sourceListHash,sourceSnapshotHash:p.sourceHash,previewHash:p.previewHash,
        before:p.before,after:p.after,protectedDomains:p.protectedDomains,baseline:p.baseline,
        createsPayment:false,createsWithdrawal:false,changesExistingEntries:false};
      tx.create(journalRef(db),{...journal,createdAt:FieldValue.serverTimestamp(),postedAt:FieldValue.serverTimestamp()});
      tx.create(receiptRef(db),{result,entryHash,userId:auth.uid,requestHash:policy.sourceListHash,at:FieldValue.serverTimestamp()});
      const lockData={kind:'payroll_cash_funding',sourceType:'adjustment',sourceId:policy.reference,entryId,entryNumber:journal.entryNumber,lockedBy:auth.uid,lockedAt:FieldValue.serverTimestamp()};
      tx.create(internal.globalLock,lockData);for(const ref of internal.sourceLocks)tx.create(ref,lockData);
      tx.set(internal.counterRef,journalCounterUpdate(internal.counter,journal.entryNumber,policy.date,FieldValue),{merge:true});
      tx.create(db.collection('audit_logs').doc(),{action:'owner-payroll-cash-funding',collectionName:'journal_entries',documentId:entryId,
        userId:auth.uid,sourceId:policy.reference,before:p.before,after:p.after,previewHash:p.previewHash,sourceHash:p.sourceHash,
        sourceListHash:policy.sourceListHash,reason:r.reason,ownerMessage:policy.ownerMessage,at:FieldValue.serverTimestamp()});
      return result;
    });
  };
}
export const payrollCashFunding=createPayrollCashFunding();
