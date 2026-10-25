import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import pg from 'pg';
import {financeHash} from '../../functions/src/financeReview.js';
import {createStore} from '../db/pgstore/index.js';
import {SCHEMA} from '../../src/lib/data/schema/registry.js';
import {createPayrollCashFunding} from '../payrollCashFunding.js';
import {fundingSeed,fundingPolicy,fundingRequest,fundingSave} from './payrollCashFundingFixture.js';

// Dedicated disposable container, never an environment-provided database URL.
const url='postgresql://postgres:local-payroll-funding-test-only@127.0.0.1:55437/postgres';
const enabled=process.env.PAYROLL_FUNDING_PG_TESTS==='1';
const auth={uid:'11111111-1111-4111-8111-111111111111'};
describe.skipIf(!enabled)('approved correction on isolated Postgres with production schema/RLS/triggers',()=>{
  let db,pool;
  const run=createPayrollCashFunding(fundingPolicy,()=>new Date('2026-10-25T08:00:00Z'));
  const preview=()=>run(db,auth,{...fundingRequest,action:'preview'});
  beforeAll(async()=>{
    if(new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55437')throw new Error('Isolated DB guard');
    pool=new pg.Pool({connectionString:url});db=createStore({connectionString:url,role:'ledger_server',max:8});
    await pool.query("insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111111111','cash-admin@isolated.test'),('22222222-2222-4222-8222-222222222222','cash-admin2@isolated.test') on conflict(id) do nothing");
  });
  beforeEach(async()=>{
    const names=[...new Set([...SCHEMA.map(t=>t.table),...SCHEMA.filter(t=>t.lines).map(t=>t.lines),'firebase_uid_map'])];
    await pool.query(`truncate ${names.map(n=>`public."${n}"`).join(', ')} cascade`);
    const batch=db.batch();
    for(let [path,value]of Object.entries(fundingSeed())){
      path=path.replace('users/funding-admin',`users/${auth.uid}`).replace('users/other-admin','users/22222222-2222-4222-8222-222222222222');
      batch.set(db.doc(path),value);
    }
    await batch.commit();
  },120000);
  afterAll(async()=>{if(db)await db.close();if(pool)await pool.end();});
  it('saves once under concurrent transactions and rereads identical receipt/core through pgstore',async()=>{
    const before=await db.collection('journal_entries').get(),p=await preview(),request=fundingSave(p);
    expect(p.before).toEqual({cashHalala:-4298868,bankHalala:28396868});
    const [a,b]=await Promise.all([run(db,auth,request),run(db,auth,request)]);
    expect(a.entryId).toBe(b.entryId);expect([a,b].filter(x=>x.replay)).toHaveLength(1);
    const status=await run(db,auth,{kind:'payroll_cash_funding',sourceId:fundingPolicy.reference,action:'read'});
    expect(status.completed).toBe(true);expect(status.sourceHash).toBe(a.sourceHash);expect(status.after).toEqual({cashHalala:-1732000,bankHalala:25830000});
    expect((await db.collection('journal_entries').get()).size).toBe(before.size+1);
    for(const e of before.docs)expect((await e.ref.get()).data()).toEqual(e.data());
    expect((await pool.query('select count(*)::int as n from public.journal_entry_lines')).rows[0].n).toBe(15);
    expect((await db.collection('finance_workbench_receipts').get()).size).toBe(2);
    expect(status.currentProtection).toEqual(p.protectedDomains);
    expect((await db.collection('posting_locks').get()).size).toBe(6);
  },120000);
  it('rejects stale sources, closed period and revoked admin without side effects',async()=>{
    const p=await preview();await db.doc('payroll_runs/2026-09__r1/payments/synthetic-0').update({previewHash:'تغيير لاحق'});
    await expect(run(db,auth,fundingSave(p))).rejects.toThrow(/تغيرت/);
    const fresh=await preview();await db.doc('accounting_periods/2026-10').update({status:'closed'});
    await expect(run(db,auth,fundingSave(fresh))).rejects.toThrow(/فترة/);
    await db.doc(`users/${auth.uid}`).update({role:'accountant'});
    await expect(run(db,auth,fundingSave(fresh))).rejects.toMatchObject({code:'permission-denied'});
    expect((await db.collection('journal_entries').get()).size).toBe(6);
    expect((await db.collection('finance_workbench_receipts').get()).size).toBe(1);
  },120000);
  it.each(['source-change','source-delete','source-add','wrong-amount','period-lock','role-revocation','source-lock','counter-change','old168-change'])(
    'real transaction refuses %s without new entry/receipt or consuming previous locks',async scenario=>{
      const p=await preview(),request=fundingSave(p);
      if(scenario==='source-change')await db.doc('journal_entries/synthetic-payroll-0').update({description:'تغيير اصطناعي'});
      if(scenario==='source-delete')request.sources=request.sources.slice(1);
      if(scenario==='source-add')request.sources=[...request.sources,request.sources[0]];
      if(scenario==='wrong-amount')request.sources=request.sources.map((s,i)=>({...s,netCashCreditHalala:s.netCashCreditHalala+(i===0?1:0)}));
      if(scenario==='period-lock')await db.doc('accounting_periods/2026-10').update({status:'closed'});
      if(scenario==='role-revocation')await db.doc(`users/${auth.uid}`).update({role:'partner'});
      if(scenario==='source-lock')await db.doc(`posting_locks/payroll_funding_source__${financeHash(fundingRequest.sources[0].journalId)}`).set({kind:'payroll_cash_funding',sourceId:'prior-funding'});
      if(scenario==='counter-change')await db.doc('counters/journal').update({nextNumber:170});
      if(scenario==='old168-change')await db.doc('journal_entries/prior168').update({description:'تغيير لاحق'});
      const original=(await pool.query("select md5(jsonb_agg(to_jsonb(t) order by id)::text) as h from posting_locks t where source_id='old-reference'")).rows[0].h;
      await expect(run(db,auth,request)).rejects.toBeTruthy();
      expect((await db.collection('finance_workbench_receipts').get()).size).toBe(1);
      expect((await pool.query('select count(*)::int as n from journal_entries where source_id=$1',[fundingPolicy.reference])).rows[0].n).toBe(0);
      expect((await pool.query("select md5(jsonb_agg(to_jsonb(t) order by id)::text) as h from posting_locks t where source_id='old-reference'")).rows[0].h).toBe(original);
    },120000);
});
