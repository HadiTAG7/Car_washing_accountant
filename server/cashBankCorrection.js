import {z} from 'zod';
import {FieldValue} from 'firebase-admin/firestore';
import {callerRole} from '../functions/src/handlers.js';
import {financeHash,FinanceReviewError} from '../functions/src/financeReview.js';
import {normalizeEntry,normalizeLines,validateEntry,journalCounterUpdate,postingLockId} from '../functions/src/invariants.js';
import {postedLines} from '../src/lib/accounting/reports.js';
import {CASH_BANK_CORRECTION} from '../src/lib/cashBankCorrectionPolicy.js';

const fail=(message,code='failed-precondition')=>{throw new FinanceReviewError(message,code);};
const source=z.object({source:z.string().regex(/^expense:[A-Za-z0-9_-]{1,120}$/),netCashCreditHalala:z.number().int().positive().safe()}).strict();
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const specs=[['variable_expenses','expense_name'],['monthly_expenses','expense_name'],['annual_expense_entries','description'],['startup_cost_entries','description']];
const sort=rows=>rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
// Match the approved CFO manifest, including mixed-case legacy Firestore IDs.
const canonicalSources=sources=>[...sources].sort((a,b)=>a.source.localeCompare(b.source,'en-US'));
export const cashBankSourceListHash=sources=>financeHash(canonicalSources(sources));
const rows=snap=>sort(snap.docs.map(d=>({...d.data(),id:d.id})));
const core=entry=>Object.fromEntries(Object.entries(entry).filter(([k])=>!['createdAt','postedAt'].includes(k)));
const authDb=(db,tx)=>({collection:name=>({doc:id=>({get:()=>tx.get(db.collection(name).doc(id))})})});
async function admin(db,tx,auth){if(await callerRole(authDb(db,tx),auth)!=='admin')fail('التصحيح المعتمد للإدارة فقط.','permission-denied');}
function cents(value){const n=value??0;if(typeof n!=='number'||!Number.isFinite(n)||Math.abs(n*100-Math.round(n*100))>1e-5)fail('مبلغ دفتري غير صالح بالهللة.');return Math.round(n*100);}
function rootSource(entry,index,seen=new Set()){
  if(seen.has(entry.id))fail('حلقة في ربط القيود المعكوسة.');seen.add(entry.id);
  if(entry.sourceType==='expense'&&entry.sourceId)return `expense:${entry.sourceId}`;
  if(entry.reversalOf){
    // Legacy reversals may name an entry NUMBER, as the ledger detail view does.
    let original=index.get(String(entry.reversalOf));
    if(!original&&/^\d+$/.test(String(entry.reversalOf))){
      const matches=[...index.values()].filter(e=>String(e.entryNumber)===String(entry.reversalOf));
      if(matches.length===1)original=matches[0];
    }
    if(!original)fail('أصل قيد معكوس غير متاح.');return rootSource(original,index,seen);
  }
  return null;
}

/** Factory allows synthetic policy fixtures in isolated tests. HTTP always uses
 * the frozen default below; no policy/account/date/amount comes from a request. */
export function createCashBankCorrection(policy=CASH_BANK_CORRECTION,clock=()=>new Date()){
  const entryId=`cash_bank_${financeHash(policy.reference).slice(0,40)}`;
  const receiptId=`cash_bank_${financeHash(policy.reference)}`;
  const common={kind:z.literal('cash_bank_correction'),sourceId:z.literal(policy.reference)};
  const planFields={sources:z.array(source).length(policy.sourceCount)};
  const schema=z.discriminatedUnion('action',[
    z.object({action:z.literal('read'),...common}).strict(),
    z.object({action:z.literal('preview'),...common,...planFields}).strict(),
    z.object({action:z.literal('save'),...common,...planFields,sourceHash:digest,previewHash:digest,
      previewedAt:z.string().datetime(),reason:z.string().trim().min(3).max(1000),confirm:z.literal(true)}).strict(),
  ]);
  const receiptRef=db=>db.collection('finance_workbench_receipts').doc(receiptId);
  const journalRef=db=>db.collection('journal_entries').doc(entryId);
  async function status(db,tx){
    const [receipt,journal]=await Promise.all([tx.get(receiptRef(db)),tx.get(journalRef(db))]);
    if(!receipt.exists&&!journal.exists)return {sourceId:policy.reference,status:'pending',completed:false,sourceHash:financeHash({reference:policy.reference,status:'pending'}),financialPosting:false};
    if(!receipt.exists||!journal.exists||receipt.data().entryHash!==financeHash(core(journal.data())))
      fail('سجل التصحيح يحتاج مراجعة؛ لا تعِد الحفظ أو تُنشئ بديلًا.');
    const r=receipt.data();
    return {...r.result,completed:true,status:'completed',entry:journal.data()};
  }
  async function plan(db,tx,auth,r,previewedAt){
    const list=canonicalSources(r.sources);
    if(new Set(list.map(s=>s.source)).size!==policy.sourceCount||financeHash(list)!==policy.sourceListHash
      ||list.reduce((sum,s)=>sum+s.netCashCreditHalala,0)!==policy.amountHalala)
      fail('القائمة أو مبالغها لا تطابق اعتماد هادي المحدد.','invalid-argument');
    const names=['journal_entries','journal_lines',...specs.map(s=>s[0])];
    const snapshots=await Promise.all(names.map(name=>tx.get(db.collection(name))));
    const tables=Object.fromEntries(names.map((name,i)=>[name,rows(snapshots[i])]));
    const entries=tables.journal_entries,index=new Map(entries.map(e=>[e.id,e]));
    const allLines=entries.flatMap(e=>(e.lines||[]).map((l,i)=>({...l,entryId:e.id,id:`${e.id}:${i}`}))).concat(tables.journal_lines);
    const lines=postedLines(entries,allLines),byEntry=new Map();
    for(const l of lines){if(!byEntry.has(l.entryId))byEntry.set(l.entryId,[]);byEntry.get(l.entryId).push(l);}
    const keys=new Set(list.map(s=>s.source));
    if(entries.some(e=>e.sourceId===policy.reference||e.description?.includes(policy.reference)
      ||e.cashBankCorrection?.sources?.some(s=>keys.has(s.source))))fail('يوجد تصحيح سابق مرتبط بالمرجع أو المصادر؛ راجع القيد الموجود.');
    const associations=entries.map(e=>({entry:e,source:rootSource(e,index)}));
    const actualSources=list.map(s=>{
      const id=s.source.slice('expense:'.length);
      const found=specs.flatMap(([collection,title])=>tables[collection].filter(row=>row.id===id).map(row=>({collection,row,title:row[title]||row.description||id})));
      if(found.length!==1)fail('أحد مصادر القائمة مفقود أو ملتبس؛ لا تصحيح افتراضي.');
      if(found[0].collection==='monthly_expenses'&&(found[0].row.biker_id||found[0].row.payrollSnapshot||found[0].row.recurrence==='monthly'))fail('الرواتب خارج اعتماد التصحيح.');
      const related=associations.filter(x=>x.source===s.source&&['posted','reversed'].includes(x.entry.status)).map(x=>x.entry);
      if(!related.length)fail('مصدر بلا قيد مرحل مرتبط.');
      const movement=related.flatMap(e=>byEntry.get(e.id)||[]);
      const net=code=>movement.filter(l=>String(l.accountId)===code).reduce((sum,l)=>sum+cents(l.credit)-cents(l.debit),0);
      if(net('1010')!==s.netCashCreditHalala||net('1020')!==0)fail('تغير أثر مصدر على الصندوق أو سبق تسجيله على البنك.');
      return {...s,...found[0],journalIds:related.map(e=>e.id).sort()};
    });
    const periodRef=db.collection('accounting_periods').doc(policy.date.slice(0,7));
    const counterRef=db.collection('counters').doc('journal');
    const globalLock=db.collection('posting_locks').doc(postingLockId('cash_bank_correction',policy.reference));
    const sourceLocks=list.map(s=>db.collection('posting_locks').doc(`cash_bank_source__${financeHash(s.source)}`));
    const [period,counter,accountCash,accountBank,lock,...locks]=await Promise.all([
      tx.get(periodRef),tx.get(counterRef),tx.get(db.collection('chart_of_accounts').doc('1010')),
      tx.get(db.collection('chart_of_accounts').doc('1020')),tx.get(globalLock),...sourceLocks.map(ref=>tx.get(ref)),
    ]);
    if(!period.exists||period.data().status!=='open')fail('فترة التصحيح غير مثبتة كفترة مفتوحة؛ لن تُفتح تلقائيًا.');
    if(lock.exists||locks.some(l=>l.exists))fail('مرجع أو مصدر مقفل بتصحيح سابق.');
    if(!counter.exists||!Number.isSafeInteger(counter.data().nextNumber)||counter.data().nextNumber<=Math.max(0,...entries.map(e=>Number(e.entryNumber)||0)))fail('عداد القيود يحتاج مراجعة.');
    for(const account of [accountCash,accountBank])if(!account.exists||account.data().active===false||account.data().accountType!=='asset')fail('حسابا البنك والصندوق غير متاحين للترحيل.');
    const entry={...normalizeEntry({entryDate:policy.date,sourceType:'adjustment',sourceId:policy.reference,
      description:`تصحيح جهة تمويل الفواتير بقرار هادي — ${policy.reference}`}),sourceKind:'owner_cash_bank_correction'};
    const entryLines=normalizeLines([{accountId:'1010',debit:policy.amountHalala/100,credit:0,description:'رد أثر الفواتير المصروفة من البنك إلى الصندوق الدفتري'},
      {accountId:'1020',debit:0,credit:policy.amountHalala/100,description:'إعادة تصنيف جهة سداد الفواتير — دون تحويل أموال'}]);
    const problems=validateEntry(entry,entryLines,{knownAccountCodes:new Set(['1010','1020'])});if(problems.length)fail(problems[0]);
    const balance=code=>lines.filter(l=>String(l.accountId)===code).reduce((sum,l)=>sum+cents(l.debit)-cents(l.credit),0);
    const before={cashHalala:balance('1010'),bankHalala:balance('1020')};
    const after={cashHalala:before.cashHalala+policy.amountHalala,bankHalala:before.bankHalala-policy.amountHalala};
    const sourceHash=financeHash({actor:auth.uid,role:'admin',policy,entries,legacy:tables.journal_lines,
      sources:actualSources,period:period.data(),counter:counter.data(),accounts:[accountCash.data(),accountBank.data()]});
    const publicPlan={sourceId:policy.reference,preview:true,sourceHash,previewedAt,expiresAt:new Date(Date.parse(previewedAt)+300000).toISOString(),
      sourceListHash:policy.sourceListHash,sourceCount:list.length,amountHalala:policy.amountHalala,entry,lines:entryLines,before,after,
      baseline:{entries:entries.length,lines:allLines.length,journalHash:financeHash(entries)},
      sources:actualSources.map(s=>({source:s.source,collection:s.collection,title:s.title,netCashCreditHalala:s.netCashCreditHalala,journalIds:s.journalIds})),
      createsPayment:false,changesExistingEntries:false};
    publicPlan.previewHash=financeHash({sourceHash,entry,lines:entryLines,previewedAt,actor:auth.uid});
    return {...publicPlan,internal:{counter,counterRef,globalLock,sourceLocks}};
  }
  return async function run(db,auth,input){
    const parsed=schema.safeParse(input);if(!parsed.success)fail('طلب التصحيح المعتمد غير صالح.','invalid-argument');
    const r=parsed.data;
    return db.runTransaction(async tx=>{
      await admin(db,tx,auth);
      const prior=await status(db,tx);
      if(r.action==='read')return prior;
      // Even a replay cannot change the approved list or request scope.
      const list=canonicalSources(r.sources);
      if(financeHash(list)!==policy.sourceListHash)fail('القائمة لا تطابق اعتماد هادي.','invalid-argument');
      if(prior.completed){
        if(r.action==='save'&&r.reason!==prior.entry.cashBankCorrection.reason)fail('المرجع محفوظ بسبب مختلف؛ اقرأ القيد الموجود.','already-exists');
        return {...prior,replay:true};
      }
      const now=clock(),at=r.action==='preview'?now.toISOString():r.previewedAt;
      if(r.action==='save'&&(Date.parse(at)>now.getTime()+30000||now.getTime()-Date.parse(at)>300000))fail('انتهت صلاحية المعاينة؛ اقرأ معاينة جديدة.');
      if(policy.date>now.toISOString().slice(0,10))fail('تاريخ التصحيح مستقبلي.');
      const p=await plan(db,tx,auth,r,at),{internal,...preview}=p;
      if(r.action==='preview')return preview;
      if(r.sourceHash!==p.sourceHash||r.previewHash!==p.previewHash)fail('تغيرت البيانات أو المستخدم أو المعاينة؛ لم يُحفظ القيد.');
      const correction={reference:policy.reference,sourceListHash:policy.sourceListHash,sourceSnapshotHash:p.sourceHash,
        ownerThread:policy.ownerThread,ownerTurn:policy.ownerTurn,ownerMessage:policy.ownerMessage,
        sources:p.sources.map(s=>({source:s.source,netCashCreditHalala:s.netCashCreditHalala,journalIds:s.journalIds})),reason:r.reason};
      const journal={...p.entry,lines:p.lines,lineCount:2,totalDebit:policy.amountHalala/100,totalCredit:policy.amountHalala/100,
        entryNumber:internal.counter.data().nextNumber,createdBy:auth.uid,cashBankCorrection:correction};
      const entryHash=financeHash(journal),receiptHash=financeHash({reference:policy.reference,entryId,entryHash});
      const result={saved:true,sourceId:policy.reference,sourceHash:receiptHash,financialPosting:true,entryId,entryNumber:journal.entryNumber,
        amountHalala:policy.amountHalala,sourceListHash:policy.sourceListHash,sourceSnapshotHash:p.sourceHash,previewHash:p.previewHash,
        before:p.before,after:p.after,createsPayment:false,changesExistingEntries:false};
      tx.create(journalRef(db),{...journal,createdAt:FieldValue.serverTimestamp(),postedAt:FieldValue.serverTimestamp()});
      tx.create(receiptRef(db),{result,entryHash,userId:auth.uid,requestHash:policy.sourceListHash,at:FieldValue.serverTimestamp()});
      const lockData={kind:'cash_bank_correction',sourceType:'adjustment',sourceId:policy.reference,entryId,entryNumber:journal.entryNumber,lockedBy:auth.uid,lockedAt:FieldValue.serverTimestamp()};
      tx.create(internal.globalLock,lockData);for(const ref of internal.sourceLocks)tx.create(ref,lockData);
      tx.set(internal.counterRef,journalCounterUpdate(internal.counter,journal.entryNumber,policy.date,FieldValue),{merge:true});
      tx.create(db.collection('audit_logs').doc(),{action:'owner-cash-bank-correction',collectionName:'journal_entries',documentId:entryId,
        userId:auth.uid,sourceId:policy.reference,before:p.before,after:p.after,previewHash:p.previewHash,sourceHash:p.sourceHash,
        sourceListHash:policy.sourceListHash,reason:r.reason,ownerMessage:policy.ownerMessage,at:FieldValue.serverTimestamp()});
      return result;
    });
  };
}
export const cashBankCorrection=createCashBankCorrection();
