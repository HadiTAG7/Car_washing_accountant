import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {createCashBankCorrection} from '../cashBankCorrection.js';
import {correctionSeed,correctionPolicy,correctionRequest,correctionSave,correctionAuth as auth} from './cashBankCorrectionFixture.js';
const projectId='demo-sweater-finance';
const enabled=/^(127\.0\.0\.1|localhost):19080$/.test(process.env.FIRESTORE_EMULATOR_HOST||'');
describe.skipIf(!enabled)('approved correction on isolated real Firestore transactions',()=>{
  let app,db;
  const run=createCashBankCorrection(correctionPolicy,()=>new Date('2026-10-25T08:00:00Z'));
  const preview=()=>run(db,auth,{...correctionRequest,action:'preview'});
  beforeAll(()=>{app=initializeApp({projectId},'cash-bank-correction-isolated');db=getFirestore(app);});
  beforeEach(async()=>{
    const response=await fetch(`http://127.0.0.1:19080/emulator/v1/projects/${projectId}/databases/(default)/documents`,{method:'DELETE'});
    if(!response.ok)throw new Error('Isolated emulator reset failed');
    const batch=db.batch();for(const [path,value] of Object.entries(correctionSeed()))batch.set(db.doc(path),value);await batch.commit();
  },120000);
  afterAll(async()=>{if(db)await db.terminate();if(app)await deleteApp(app);});
  it('commits one journal from simultaneous requests, preserves all original rows, and rereads the receipt',async()=>{
    const before=await db.collection('journal_entries').get(),p=await preview(),request=correctionSave(p);
    const [a,b]=await Promise.all([run(db,auth,request),run(db,auth,request)]);
    expect(a.entryId).toBe(b.entryId);expect([a,b].filter(x=>x.replay)).toHaveLength(1);
    const after=await db.collection('journal_entries').get();expect(after.size).toBe(before.size+1);
    for(const doc of before.docs)expect((await doc.ref.get()).data()).toEqual(doc.data());
    expect((await db.collection('finance_workbench_receipts').get()).size).toBe(1);
    const status=await run(db,auth,{kind:'cash_bank_correction',sourceId:correctionPolicy.reference,action:'read'});
    expect(status.completed).toBe(true);expect(status.sourceHash).toBe(a.sourceHash);
    expect(status.entry.totalDebit).toBe(379968.44);expect(status.entry.totalCredit).toBe(379968.44);
  },120000);
  it('rejects a stale source or locked period without a correction journal',async()=>{
    const p=await preview();await db.doc('startup_cost_entries/synthetic-000').update({description:'تغيير بعد المعاينة'});
    await expect(run(db,auth,correctionSave(p))).rejects.toThrow(/تغيرت/);
    const p2=await preview();await db.doc('accounting_periods/2026-10').update({status:'closed'});
    await expect(run(db,auth,correctionSave(p2))).rejects.toThrow(/فترة/);
    expect((await db.collection('journal_entries').get()).size).toBe(81);
    expect((await db.collection('finance_workbench_receipts').get()).size).toBe(0);
  },120000);
  it('rechecks revoked membership inside the financial transaction',async()=>{
    const p=await preview();await db.doc(`users/${auth.uid}`).update({role:'accountant'});
    await expect(run(db,auth,correctionSave(p))).rejects.toMatchObject({code:'permission-denied'});
    expect((await db.collection('finance_workbench_receipts').get()).size).toBe(0);
  },120000);
});
