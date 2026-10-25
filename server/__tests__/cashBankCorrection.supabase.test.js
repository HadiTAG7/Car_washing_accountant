import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import pg from 'pg';
import {createStore} from '../db/pgstore/index.js';
import {SCHEMA} from '../../src/lib/data/schema/registry.js';
import {createCashBankCorrection} from '../cashBankCorrection.js';
import {correctionSeed,correctionPolicy,correctionRequest,correctionSave} from './cashBankCorrectionFixture.js';

// Dedicated disposable container, never an environment-provided database URL.
const url='postgresql://postgres:local-cash-test-only@127.0.0.1:55436/postgres';
const enabled=process.env.CASH_CORRECTION_PG_TESTS==='1';
const auth={uid:'11111111-1111-4111-8111-111111111111'};
describe.skipIf(!enabled)('approved correction on isolated Postgres with production schema/RLS/triggers',()=>{
  let db,pool;
  const run=createCashBankCorrection(correctionPolicy,()=>new Date('2026-10-25T08:00:00Z'));
  const preview=()=>run(db,auth,{...correctionRequest,action:'preview'});
  beforeAll(async()=>{
    if(new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55436')throw new Error('Isolated DB guard');
    pool=new pg.Pool({connectionString:url});db=createStore({connectionString:url,role:'ledger_server',max:8});
    await pool.query("insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111111111','cash-admin@isolated.test'),('22222222-2222-4222-8222-222222222222','cash-admin2@isolated.test') on conflict(id) do nothing");
  });
  beforeEach(async()=>{
    const names=[...new Set([...SCHEMA.map(t=>t.table),...SCHEMA.filter(t=>t.lines).map(t=>t.lines),'firebase_uid_map'])];
    await pool.query(`truncate ${names.map(n=>`public."${n}"`).join(', ')} cascade`);
    const batch=db.batch();
    for(let [path,value]of Object.entries(correctionSeed())){
      path=path.replace('users/correction-admin',`users/${auth.uid}`).replace('users/another-admin','users/22222222-2222-4222-8222-222222222222');
      batch.set(db.doc(path),value);
    }
    await batch.commit();
  },120000);
  afterAll(async()=>{if(db)await db.close();if(pool)await pool.end();});
  it('saves once under concurrent transactions and rereads identical receipt/core through pgstore',async()=>{
    const before=await db.collection('journal_entries').get(),p=await preview(),request=correctionSave(p);
    expect(p.before).toEqual({cashHalala:-42295712,bankHalala:66393712});
    const [a,b]=await Promise.all([run(db,auth,request),run(db,auth,request)]);
    expect(a.entryId).toBe(b.entryId);expect([a,b].filter(x=>x.replay)).toHaveLength(1);
    const status=await run(db,auth,{kind:'cash_bank_correction',sourceId:correctionPolicy.reference,action:'read'});
    expect(status.completed).toBe(true);expect(status.sourceHash).toBe(a.sourceHash);expect(status.after).toEqual({cashHalala:-4298868,bankHalala:28396868});
    expect((await db.collection('journal_entries').get()).size).toBe(before.size+1);
    for(const e of before.docs)expect((await e.ref.get()).data()).toEqual(e.data());
    expect((await pool.query('select count(*)::int as n from public.journal_entry_lines')).rows[0].n).toBe(164);
    expect((await db.collection('finance_workbench_receipts').get()).size).toBe(1);
  },120000);
  it('rejects stale sources, closed period and revoked admin without side effects',async()=>{
    const p=await preview();await db.doc('startup_cost_entries/synthetic-000').update({description:'تغيير لاحق'});
    await expect(run(db,auth,correctionSave(p))).rejects.toThrow(/تغيرت/);
    const fresh=await preview();await db.doc('accounting_periods/2026-10').update({status:'closed'});
    await expect(run(db,auth,correctionSave(fresh))).rejects.toThrow(/فترة/);
    await db.doc(`users/${auth.uid}`).update({role:'accountant'});
    await expect(run(db,auth,correctionSave(fresh))).rejects.toMatchObject({code:'permission-denied'});
    expect((await db.collection('journal_entries').get()).size).toBe(81);
    expect((await db.collection('finance_workbench_receipts').get()).size).toBe(0);
  },120000);
});
