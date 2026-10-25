import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import pg from 'pg';
import {createStore} from '../db/pgstore/index.js';
import {SCHEMA} from '../../src/lib/data/schema/registry.js';
import {createCashResidualCorrection} from '../cashResidualCorrection.js';
import {residualSeed,residualPolicies,residualRequest,residualSave} from './cashResidualFixture.js';
const url='postgresql://postgres:local-cash-zero-test-only@127.0.0.1:55438/postgres';
const enabled=process.env.CASH_ZERO_PG_TESTS==='1',auth={uid:'11111111-1111-4111-8111-111111111111'};
describe.skipIf(!enabled)('two fixed corrections on isolated Postgres with existing schema/RLS/triggers',()=>{
  let db,pool;const runs=residualPolicies.map(p=>createCashResidualCorrection(p,()=>new Date('2026-10-25T12:00:00Z')));
  const preview=k=>runs[k](db,auth,residualRequest(k));
  beforeAll(async()=>{
    if(new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55438')throw Error('Isolated guard');
    pool=new pg.Pool({connectionString:url});db=createStore({connectionString:url,role:'ledger_server',max:8});
    await pool.query("insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','zero-test@isolated.test'),('22222222-2222-4222-8222-222222222222','zero-test2@isolated.test') on conflict(id) do nothing");
  });
  beforeEach(async()=>{
    const names=[...new Set([...SCHEMA.map(t=>t.table),...SCHEMA.filter(t=>t.lines).map(t=>t.lines),'firebase_uid_map'])];
    await pool.query(`truncate ${names.map(n=>`public."${n}"`).join(', ')} cascade`);
    const batch=db.batch();for(let [path,row]of Object.entries(residualSeed())){
      path=path.replace('users/funding-admin',`users/${auth.uid}`).replace('users/other-admin','users/22222222-2222-4222-8222-222222222222');batch.set(db.doc(path),row);
    }await batch.commit();
  },120000);
  afterAll(async()=>{if(db)await db.close();if(pool)await pool.end();});
  it('serializes both sets of concurrent saves, replays receipts, reaches zero and preserves all original domains',async()=>{
    const originals=await db.collection('journal_entries').get(),lineCount=(await pool.query('select count(*)::int n from journal_entry_lines')).rows[0].n;
    await expect(preview(1)).rejects.toThrow(/أكمل/);
    const p=await preview(0),req=residualSave(0,p);const [a,b]=await Promise.all([runs[0](db,auth,req),runs[0](db,auth,req)]);
    expect(a.entryId).toBe(b.entryId);expect([a,b].filter(x=>x.replay)).toHaveLength(1);
    const q=await preview(1),req2=residualSave(1,q);const [c,d]=await Promise.all([runs[1](db,auth,req2),runs[1](db,auth,req2)]);
    expect(c.entryId).toBe(d.entryId);expect([c,d].filter(x=>x.replay)).toHaveLength(1);
    expect(q.after.cashHalala).toBe(0);expect(q.after.bankHalala).toBe(24095000);expect(q.after.assetHalala-q.before.assetHalala).toBe(3000);
    for(const original of originals.docs)expect((await original.ref.get()).data()).toEqual(original.data());
    for(const k of [0,1]){const read=await runs[k](db,auth,residualRequest(k,'read'));expect(read.currentProtection).toEqual(p.protectedDomains);expect(read.entry.lines).toHaveLength(2);}
    expect((await db.collection('journal_entries').get()).size).toBe(originals.size+2);
    expect((await pool.query('select count(*)::int n from journal_entry_lines')).rows[0].n).toBe(lineCount+4);
    expect((await db.collection('posting_locks').get()).size).toBe(28);
  },120000);
  it.each(['changed-source','deleted-source-input','added-source-input','wrong-amount','stale-payments','old168','old169','period-lock','role-revocation','counter-change'])(
    'rejects %s in the real transaction without financial side effects',async scenario=>{
      const p=await preview(0),req=residualSave(0,p);
      if(scenario==='changed-source')await db.doc('temporary_expenses/synthetic-0').update({description:'تغيير اصطناعي'});
      if(scenario==='deleted-source-input')req.sources=req.sources.slice(1);
      if(scenario==='added-source-input')req.sources=[...req.sources,req.sources[0]];
      if(scenario==='wrong-amount')req.sources=req.sources.map((s,i)=>({...s,netCashCreditHalala:s.netCashCreditHalala+(i===0?1:0)}));
      if(scenario==='stale-payments')await db.doc('payroll_runs/2026-09__r1/payments/synthetic-0').update({changed:true});
      if(scenario==='old168')await db.doc('journal_entries/prior168').update({description:'تغيير اصطناعي'});
      if(scenario==='old169')await db.doc('journal_entries/prior169').update({description:'تغيير اصطناعي'});
      if(scenario==='period-lock')await db.doc('accounting_periods/2026-10').update({status:'closed'});
      if(scenario==='role-revocation')await db.doc(`users/${auth.uid}`).update({role:'partner'});
      if(scenario==='counter-change')await db.doc('counters/journal').update({nextNumber:180});
      await expect(runs[0](db,auth,req)).rejects.toBeTruthy();
      expect((await pool.query('select count(*)::int n from journal_entries where source_id=any($1)',[residualPolicies.map(p=>p.reference)])).rows[0].n).toBe(0);
      expect((await db.collection('finance_workbench_receipts').get()).size).toBe(1);
    },120000);
  it('preserves the saved first component when a changed triplet blocks the second; no first-component repeat',async()=>{
    const p=await preview(0),a=await runs[0](db,auth,residualSave(0,p)),q=await preview(1);
    await db.doc('journal_entries/reversal-2').update({description:'تغير لاحق'});
    await expect(runs[1](db,auth,residualSave(1,q))).rejects.toThrow(/تغير/);
    const read=await runs[0](db,auth,residualRequest(0,'read'));expect(read.entryId).toBe(a.entryId);expect(read.completed).toBe(true);
    expect((await pool.query('select count(*)::int n from journal_entries where source_id=any($1)',[residualPolicies.map(p=>p.reference)])).rows[0].n).toBe(1);
  },120000);
});
