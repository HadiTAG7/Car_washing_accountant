import {describe,it,expect} from 'vitest';
import {createCashBankCorrection,cashBankCorrection,cashBankSourceListHash} from '../cashBankCorrection.js';
import {financeHash} from '../../functions/src/financeReview.js';
import {financeWorkbench} from '../financeWorkbench.js';
import {memoryFinanceDb} from './financeFixtures.js';
import {correctionSeed,correctionPolicy,correctionRequest,correctionSave,correctionAuth as auth} from './cashBankCorrectionFixture.js';
const now=new Date('2026-10-25T08:00:00Z'),run=createCashBankCorrection(correctionPolicy,()=>now);
const preview=db=>run(db,auth,{...correctionRequest,action:'preview'});
describe('one approved cash/bank correction',()=>{
  it('preserves the approved manifest ordering for mixed-case legacy source IDs',()=>{
    const lower={source:'expense:a',netCashCreditHalala:100},upper={source:'expense:B',netCashCreditHalala:200};
    expect(cashBankSourceListHash([upper,lower])).toBe(financeHash([lower,upper]));
    expect(cashBankSourceListHash([lower,upper])).toBe(financeHash([lower,upper]));
  });
  it('keeps status and preview read-only, derives balanced fixed lines, and leaves closed source periods alone',async()=>{
    const db=memoryFinanceDb(correctionSeed()),before=JSON.stringify([...db.rows]);
    expect((await run(db,auth,{action:'read',kind:'cash_bank_correction',sourceId:correctionPolicy.reference})).status).toBe('pending');
    const p=await preview(db);expect(p.amountHalala).toBe(37996844);expect(p.sources).toHaveLength(79);
    expect(p.before).toEqual({cashHalala:-42295712,bankHalala:66393712});expect(p.after).toEqual({cashHalala:-4298868,bankHalala:28396868});
    expect(p.lines.map(l=>[l.accountId,l.debit,l.credit])).toEqual([['1010',379968.44,0],['1020',0,379968.44]]);
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('creates exactly one entry and receipt on replay or two queued unit requests, changing no original rows',async()=>{
    const db=memoryFinanceDb(correctionSeed()),before=new Map(db.rows),p=await preview(db),request=correctionSave(p);
    const [a,b]=await Promise.all([run(db,auth,request),run(db,auth,request)]);
    expect(a.entryId).toBe(b.entryId);expect([a,b].filter(x=>x.replay)).toHaveLength(1);
    for(const [key,value]of before)if(key!=='counters/journal')expect(db.rows.get(key)).toEqual(value);
    const entry=db.rows.get(`journal_entries/${a.entryId}`);expect(entry.lines).toHaveLength(2);expect(entry.cashBankCorrection.sources).toHaveLength(79);
    expect([...db.rows.keys()].filter(k=>k.startsWith('journal_entries/'))).toHaveLength(82);
    const read=await run(db,auth,{kind:'cash_bank_correction',action:'read',sourceId:correctionPolicy.reference});
    expect(read.completed).toBe(true);expect(read.sourceHash).toBe(a.sourceHash);
    await expect(run(db,auth,{...request,reason:'سبب مختلف'})).rejects.toMatchObject({code:'already-exists'});
  });
  it.each(['users/correction-admin','accounting_periods/2026-10','startup_cost_entries/synthetic-000','journal_entries/original-0','counters/journal','chart_of_accounts/1010'])(
    'rejects changed authority, source, ledger, counter, account or period after preview: %s',async key=>{
      const db=memoryFinanceDb(correctionSeed()),p=await preview(db);
      const value={...db.rows.get(key),changedAfterPreview:true};if(key.startsWith('users/'))value.role='partner';
      db.rows.set(key,value);const before=JSON.stringify([...db.rows]);
      await expect(run(db,auth,correctionSave(p))).rejects.toBeTruthy();expect(JSON.stringify([...db.rows])).toBe(before);
    });
  it('rejects a closed or missing correction period, stale preview, different actor, invalid scope and prior source correction',async()=>{
    const db=memoryFinanceDb(correctionSeed()),p=await preview(db);
    await expect(run(db,{uid:'another-admin'},correctionSave(p))).rejects.toThrow(/المستخدم|المعاينة/);
    const late=createCashBankCorrection(correctionPolicy,()=>new Date(now.getTime()+300001));
    await expect(late(db,auth,correctionSave(p))).rejects.toThrow(/صلاحية/);
    for(const period of [{status:'closed'},null]){if(period)db.rows.set('accounting_periods/2026-10',period);else db.rows.delete('accounting_periods/2026-10');await expect(preview(db)).rejects.toThrow(/فترة/);}
    db.rows.set('accounting_periods/2026-10',{status:'open'});
    await expect(run(db,auth,{...correctionRequest,action:'preview',amount:1})).rejects.toMatchObject({code:'invalid-argument'});
    await expect(run(db,auth,{...correctionRequest,action:'preview',sources:correctionRequest.sources.slice(1)})).rejects.toBeTruthy();
    db.rows.set('journal_entries/prior-correction',{status:'posted',cashBankCorrection:{sources:[{source:correctionRequest.sources[0].source}]}});
    await expect(preview(db)).rejects.toThrow(/تصحيح سابق/);
  });
  it.each(['old','82'])('uses original/reversal/replacement net cash (reference %s) and rejects an already-banked invoice',async reference=>{
    const db=memoryFinanceDb(correctionSeed()),sourceId=correctionRequest.sources[0].source.slice(8);
    db.rows.set('journal_entries/old',{entryNumber:82,sourceId,sourceType:'expense',status:'reversed',lines:[{accountId:'1010',debit:0,credit:100},{accountId:'1500',debit:100,credit:0}]});
    db.rows.set('journal_entries/reversal',{entryNumber:83,sourceType:'adjustment',reversalOf:reference,status:'posted',lines:[{accountId:'1010',debit:100,credit:0},{accountId:'1500',debit:0,credit:100}]});
    db.rows.set('counters/journal',{nextNumber:84});expect((await preview(db)).sources[0].journalIds).toHaveLength(3);
    db.rows.get('journal_entries/reversal').lines[0].accountId='1020';await expect(preview(db)).rejects.toThrow(/الصندوق|البنك/);
  });
  it.each(['partner','operator','supervisor','accountant'])('refuses %s, including HTTP workbench interception',async role=>{
    const db=memoryFinanceDb(correctionSeed());db.rows.set(`users/${auth.uid}`,{role});
    await expect(run(db,auth,{...correctionRequest,action:'preview'})).rejects.toMatchObject({code:'permission-denied'});
    await expect(financeWorkbench(db,auth,{kind:'cash_bank_correction',sourceId:correctionPolicy.reference,action:'read'})).rejects.toMatchObject({code:'permission-denied'});
  });
  it('production policy rejects a synthetic 79-source list even with the correct amount',async()=>{
    await expect(cashBankCorrection(memoryFinanceDb(correctionSeed()),auth,{...correctionRequest,action:'preview'})).rejects.toMatchObject({code:'invalid-argument'});
  });
  it('reads legacy absent zero sides like the existing ledger, and blocks a corrupted saved receipt instead of posting again',async()=>{
    const db=memoryFinanceDb(correctionSeed());delete db.rows.get('journal_entries/original-0').lines[1].debit;
    const p=await preview(db);expect(p.before.cashHalala).toBe(-42295712);
    const request=correctionSave(p),saved=await run(db,auth,request);
    db.rows.get(`journal_entries/${saved.entryId}`).description='تغيير غير متوقع';
    const before=JSON.stringify([...db.rows]);await expect(run(db,auth,request)).rejects.toThrow(/سجل التصحيح/);
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
});
