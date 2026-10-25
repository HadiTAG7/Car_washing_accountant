import {describe,it,expect} from 'vitest';
import {createCashResidualCorrection,cashResidualCorrection} from '../cashResidualCorrection.js';
import {financeWorkbench} from '../financeWorkbench.js';
import {memoryFinanceDb} from './financeFixtures.js';
import {residualSeed,residualPolicies,residualRequest,residualSave,residualAuth as auth} from './cashResidualFixture.js';
const now=new Date('2026-10-25T12:00:00Z'),runs=residualPolicies.map(p=>createCashResidualCorrection(p,()=>now));
const preview=(db,k)=>runs[k](db,auth,residualRequest(k));
describe('two bounded cash zero corrections',()=>{
  it('requires the first receipt before the second and reaches zero with no original record edits',async()=>{
    const db=memoryFinanceDb(residualSeed()),before=new Map(db.rows);
    await expect(preview(db,1)).rejects.toThrow(/أكمل/);
    const p=await preview(db,0);expect(p.before.cashHalala).toBe(-1732000);expect(p.after.cashHalala).toBe(3000);expect(p.after.bankHalala).toBe(24095000);
    expect([...db.rows]).toEqual([...before]);
    const [a,b]=await Promise.all([runs[0](db,auth,residualSave(0,p)),runs[0](db,auth,residualSave(0,p))]);expect(a.entryId).toBe(b.entryId);expect([a,b].filter(x=>x.replay)).toHaveLength(1);
    const q=await preview(db,1);expect(q.after.cashHalala).toBe(0);expect(q.after.bankHalala).toBe(24095000);expect(q.after.assetHalala-q.before.assetHalala).toBe(3000);
    await runs[1](db,auth,residualSave(1,q));
    for(const k of [0,1]){const read=await runs[k](db,auth,residualRequest(k,'read'));expect(read.completed).toBe(true);expect(read.currentProtection).toEqual(p.protectedDomains);}
    for(const [key,val]of before)if(key!=='counters/journal')expect(db.rows.get(key)).toEqual(val);
    expect([...db.rows.keys()].filter(k=>k.startsWith('posting_locks/cash_residual'))).toHaveLength(27);
  });
  it.each(['journal_entries/temp-0','temporary_expenses/synthetic-0','journal_entries/prior169','journal_entries/prior168',
    'payroll_runs/2026-09__r1/payments/synthetic-0','counters/journal','chart_of_accounts/1500','finance_workbench_receipts/old-receipt','posting_locks/cash_bank_correction__old-reference'])(
    'rejects changed protected scope after preview: %s',async key=>{
      const db=memoryFinanceDb(residualSeed()),p=await preview(db,0);db.rows.set(key,{...db.rows.get(key),changed:true});const before=JSON.stringify([...db.rows]);
      await expect(runs[0](db,auth,residualSave(0,p))).rejects.toBeTruthy();expect(JSON.stringify([...db.rows])).toBe(before);
    });
  it.each(['partner','operator','accountant','supervisor'])('refuses %s inside transaction and HTTP dispatcher',async role=>{
    const db=memoryFinanceDb(residualSeed());db.rows.set(`users/${auth.uid}`,{role});
    await expect(preview(db,0)).rejects.toMatchObject({code:'permission-denied'});
    await expect(financeWorkbench(db,auth,residualRequest(0,'read'))).rejects.toMatchObject({code:'permission-denied'});
  });
  it('rejects expiry, actor changes, locks, closed/missing period, changed list and arbitrary financial fields',async()=>{
    const db=memoryFinanceDb(residualSeed()),p=await preview(db,0);
    await expect(runs[0](db,{uid:'other-admin'},residualSave(0,p))).rejects.toThrow(/المستخدم|المعاينة/);
    await expect(createCashResidualCorrection(residualPolicies[0],()=>new Date(now.getTime()+300001))(db,auth,residualSave(0,p))).rejects.toThrow(/صلاحية/);
    for(const input of [{...residualRequest(0),sources:residualRequest(0).sources.slice(1)},{...residualRequest(0),amount:1},
      {...residualRequest(0),sources:residualRequest(0).sources.map((s,i)=>({...s,netCashCreditHalala:s.netCashCreditHalala+(i===0?1:0)}))}])await expect(runs[0](db,auth,input)).rejects.toMatchObject({code:'invalid-argument'});
    for(const period of [{status:'closed'},null]){if(period)db.rows.set('accounting_periods/2026-10',period);else db.rows.delete('accounting_periods/2026-10');await expect(preview(db,0)).rejects.toThrow(/فترة/);}
  });
  it('production route refuses synthetic or unknown scopes',async()=>{
    const db=memoryFinanceDb(residualSeed());await expect(cashResidualCorrection(db,auth,residualRequest(0))).rejects.toMatchObject({code:'invalid-argument'});
    await expect(cashResidualCorrection(db,auth,{...residualRequest(0),sourceId:'arbitrary'})).rejects.toMatchObject({code:'invalid-argument'});
  });
});
