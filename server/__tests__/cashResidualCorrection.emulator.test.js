import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {createCashResidualCorrection} from '../cashResidualCorrection.js';
import {residualSeed,residualPolicies,residualRequest,residualSave,residualAuth as auth} from './cashResidualFixture.js';
const projectId='demo-sweater-finance';
const enabled=/^(127\.0\.0\.1|localhost):19080$/.test(process.env.FIRESTORE_EMULATOR_HOST||'');
describe.skipIf(!enabled)('approved correction on isolated real Firestore transactions',()=>{
  let app,db;
  const run=createCashResidualCorrection(residualPolicies[0],()=>new Date('2026-10-25T08:00:00Z'));
  const preview=()=>run(db,auth,{...residualRequest(0),action:'preview'});
  beforeAll(()=>{app=initializeApp({projectId},'cash-zero-isolated');db=getFirestore(app);});
  beforeEach(async()=>{
    const response=await fetch(`http://127.0.0.1:19080/emulator/v1/projects/${projectId}/databases/(default)/documents`,{method:'DELETE'});
    if(!response.ok)throw new Error('Isolated emulator reset failed');
    const batch=db.batch();for(const [path,value] of Object.entries(residualSeed()))batch.set(db.doc(path),value);await batch.commit();
  },120000);
  afterAll(async()=>{if(db)await db.terminate();if(app)await deleteApp(app);});
  it('commits one journal from simultaneous requests, preserves all original rows, and rereads the receipt',async()=>{
    const before=await db.collection('journal_entries').get(),p=await preview(),request=residualSave(0,p);
    const [a,b]=await Promise.all([run(db,auth,request),run(db,auth,request)]);
    expect(a.entryId).toBe(b.entryId);expect([a,b].filter(x=>x.replay)).toHaveLength(1);
    const after=await db.collection('journal_entries').get();expect(after.size).toBe(before.size+1);
    for(const doc of before.docs)expect((await doc.ref.get()).data()).toEqual(doc.data());
    expect((await db.collection('finance_workbench_receipts').get()).size).toBe(2);
    const status=await run(db,auth,{...residualRequest(0,'read')});
    expect(status.completed).toBe(true);expect(status.sourceHash).toBe(a.sourceHash);
    expect(status.currentProtection).toEqual(p.protectedDomains);
    expect(status.entry.totalDebit).toBe(17350);expect(status.entry.totalCredit).toBe(17350);
  },120000);
  it('rejects a stale source or locked period without a correction journal',async()=>{
    const p=await preview();await db.doc('payroll_runs/2026-09__r1/payments/synthetic-0').update({description:'تغيير بعد المعاينة'});
    await expect(run(db,auth,residualSave(0,p))).rejects.toThrow(/تغيرت/);
    const p2=await preview();await db.doc('accounting_periods/2026-10').update({status:'closed'});
    await expect(run(db,auth,residualSave(0,p2))).rejects.toThrow(/فترة/);
    expect((await db.collection('journal_entries').get()).size).toBe(32);
    expect((await db.collection('finance_workbench_receipts').get()).size).toBe(1);
  },120000);
  it('rechecks revoked membership inside the financial transaction',async()=>{
    const p=await preview();await db.doc(`users/${auth.uid}`).update({role:'accountant'});
    await expect(run(db,auth,residualSave(0,p))).rejects.toMatchObject({code:'permission-denied'});
    expect((await db.collection('finance_workbench_receipts').get()).size).toBe(1);
  },120000);
});
