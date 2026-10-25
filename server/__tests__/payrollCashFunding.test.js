import {describe,it,expect} from 'vitest';
import {createPayrollCashFunding,payrollCashFunding} from '../payrollCashFunding.js';
import {financeWorkbench} from '../financeWorkbench.js';
import {memoryFinanceDb} from './financeFixtures.js';
import {fundingSeed,fundingPolicy,fundingRequest,fundingSave,fundingAuth as auth} from './payrollCashFundingFixture.js';
const now=new Date('2026-10-25T10:00:00Z'),run=createPayrollCashFunding(fundingPolicy,()=>now);
const preview=db=>run(db,auth,{...fundingRequest,action:'preview'});
describe('exact four-original-journal payroll cash funding',()=>{
  it('read/preview never write and keep three September sources distinct from the previous correction',async()=>{
    const db=memoryFinanceDb(fundingSeed()),before=JSON.stringify([...db.rows]);
    expect((await run(db,auth,{kind:'payroll_cash_funding',sourceId:fundingPolicy.reference,action:'read'})).completed).toBe(false);
    const p=await preview(db);expect(p.sources).toHaveLength(4);expect(p.sources.filter(s=>s.payrollSource==='payroll:2026-09__r1')).toHaveLength(3);
    expect(p.before).toEqual({cashHalala:-4298868,bankHalala:28396868});expect(p.after).toEqual({cashHalala:-1732000,bankHalala:25830000});
    expect(p.lines.map(l=>[l.accountId,l.debit,l.credit])).toEqual([['1010',25668.68,0],['1020',0,25668.68]]);
    expect(Object.fromEntries(Object.entries(p.protectedDomains).slice(0,4).map(([k,v])=>[k,v.count]))).toEqual({payrollRuns:2,payrollItems:50,payrollPayments:3,temporaryExpenses:83});
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('saves/replays once and preserves every original, prior receipt and prior locks',async()=>{
    const db=memoryFinanceDb(fundingSeed()),original=new Map(db.rows),p=await preview(db),request=fundingSave(p);
    const [a,b]=await Promise.all([run(db,auth,request),run(db,auth,request)]);expect(a.entryId).toBe(b.entryId);expect([a,b].filter(v=>v.replay)).toHaveLength(1);
    const read=await run(db,auth,{kind:'payroll_cash_funding',sourceId:fundingPolicy.reference,action:'read'});
    expect(read.currentProtection).toEqual(p.protectedDomains);expect(read.sourceHash).toBe(a.sourceHash);
    expect(read.entry.payrollCashFunding.sources.map(s=>s.journalNumber)).toEqual([161,163,164,165]);
    expect(read.entry.entryDate).toBe('2026-10-25');expect(read.entry.lines).toHaveLength(2);
    for(const [key,value]of original)if(key!=='counters/journal')expect(db.rows.get(key)).toEqual(value);
    expect([...db.rows.keys()].filter(k=>k.startsWith('posting_locks/payroll_'))).toHaveLength(5);
    await expect(run(db,auth,{...request,reason:'سبب مختلف'})).rejects.toMatchObject({code:'already-exists'});
  });
  it.each(['journal_entries/synthetic-payroll-0','payroll_runs/2026-09__r1','payroll_runs/2026-09__r1/items/synthetic-25',
    'payroll_runs/2026-09__r1/payments/synthetic-1','temporary_expenses/synthetic-0','journal_entries/prior168','finance_workbench_receipts/old-receipt',
    'posting_locks/cash_bank_correction__old-reference','counters/journal','chart_of_accounts/1010'])(
    'CAS rejects changed protected data without writes: %s',async key=>{
      const db=memoryFinanceDb(fundingSeed()),p=await preview(db);db.rows.set(key,{...db.rows.get(key),changed:true});const before=JSON.stringify([...db.rows]);
      await expect(run(db,auth,fundingSave(p))).rejects.toBeTruthy();expect(JSON.stringify([...db.rows])).toBe(before);
    });
  it('rejects added/deleted/duplicate/wrong amounts and all extra financial input fields',async()=>{
    const db=memoryFinanceDb(fundingSeed());
    for(const sources of [fundingRequest.sources.slice(1),[...fundingRequest.sources,fundingRequest.sources[0]],
      fundingRequest.sources.map((s,i)=>i===1?fundingRequest.sources[0]:s),fundingRequest.sources.map((s,i)=>({...s,netCashCreditHalala:s.netCashCreditHalala+(i===0?1:0)}))])
      await expect(run(db,auth,{...fundingRequest,action:'preview',sources})).rejects.toMatchObject({code:'invalid-argument'});
    for(const extra of [{amount:1},{date:'2026-09-01'},{accountId:'1300'},{policy:fundingPolicy}])
      await expect(run(db,auth,{...fundingRequest,action:'preview',...extra})).rejects.toMatchObject({code:'invalid-argument'});
    db.rows.delete('journal_entries/synthetic-payroll-1');await expect(preview(db)).rejects.toThrow(/فُقد/);
  });
  it.each(['partner','operator','accountant','supervisor'])('rejects %s through handler and HTTP dispatcher',async role=>{
    const db=memoryFinanceDb(fundingSeed());db.rows.set('users/funding-admin',{role});
    await expect(preview(db)).rejects.toMatchObject({code:'permission-denied'});
    await expect(financeWorkbench(db,auth,{...fundingRequest,action:'read'})).rejects.toMatchObject({code:'permission-denied'});
  });
  it('rejects a revoked actor, locked/missing period, expiry, actor change and existing source lock',async()=>{
    const db=memoryFinanceDb(fundingSeed()),p=await preview(db);
    await expect(run(db,{uid:'other-admin'},fundingSave(p))).rejects.toThrow(/المستخدم|المعاينة/);
    await expect(createPayrollCashFunding(fundingPolicy,()=>new Date(now.getTime()+300001))(db,auth,fundingSave(p))).rejects.toThrow(/صلاحية/);
    db.rows.set('users/funding-admin',{role:'partner'});await expect(run(db,auth,fundingSave(p))).rejects.toMatchObject({code:'permission-denied'});db.rows.set('users/funding-admin',{role:'admin'});
    for(const value of [{status:'closed'},null]){if(value)db.rows.set('accounting_periods/2026-10',value);else db.rows.delete('accounting_periods/2026-10');await expect(preview(db)).rejects.toThrow(/فترة/);}
  });
  it('production policy refuses the synthetic set even with the approved total',async()=>{
    await expect(payrollCashFunding(memoryFinanceDb(fundingSeed()),auth,{...fundingRequest,action:'preview'})).rejects.toMatchObject({code:'invalid-argument'});
  });
});
