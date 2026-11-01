import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {recentRecoveryFixture} from './recentOwnerRecoveryFixture.js';
import {previewAdministrativeCompletion,saveAdministrativeCompletion} from '../src/sweater/administrativeCompletion.js';
const host=process.env.FIRESTORE_EMULATOR_HOST;
const project='demo-sweater-owner-recovery';
if(host&&!/^(127\.0\.0\.1|localhost):18082$/.test(host))throw new Error('Only the isolated owner-recovery emulator on port18082 is allowed');
const suite=host?describe:describe.skip;
let app,db;
const names=['users','app_admins','bikers','accounting_periods','sweater_settlements','washes','sweater_bookings','sweater_owner_booking_claims',
 'sweater_owner_collection_confirmations','sweater_operational_wash_links','sweater_booking_links','sweater_raw_payloads','sweater_import_runs',
 'audit_logs','journal_entries','posting_locks','transactions','sweater_collections','sweater_adjustments'];
const request=(payload,p)=>({payload,reviewedPayloadHash:p.reviewedPayloadHash,previewStateHash:p.previewStateHash});
async function seed(day,numbers=null){
 if(app.options.projectId!==project||db.projectId!==project||process.env.FIRESTORE_EMULATOR_HOST!==host)throw new Error('Isolation check failed before any test write');
 for(const name of names){const rows=await db.collection(name).get();for(const doc of rows.docs)await doc.ref.delete();}
 const fixture=recentRecoveryFixture(day,numbers);
 for(const [path,value] of Object.entries(fixture.seed))await db.doc(path).set(value);
 return fixture;
}
suite('owner recovery — real isolated transactions',()=>{
 beforeAll(()=>{app=initializeApp({projectId:project},'owner-recovery-isolated');db=getFirestore(app);});
 afterAll(async()=>{if(app)await deleteApp(app);});
 beforeEach(()=>{if(!host)throw new Error('Emulator required');});
 it.each(['2026-10-30','2026-10-31','2026-11-01'])('preserves original evidence and verifies canonical claims for%s',async day=>{
  const {payload,seed:original}=await seed(day);
  const p=await previewAdministrativeCompletion(db,payload,'admin');expect(p.canSave).toBe(true);
  const saved=await saveAdministrativeCompletion(db,FieldValue,request(payload,p),'admin');expect(saved.washesCreated).toBe(payload.records.length);
  const replay=await previewAdministrativeCompletion(db,payload,'admin');
  expect(replay.verification).toMatchObject({status:'verified',matched:payload.records.length,total:payload.records.length});
  for(const raw of payload.records){const n=raw.sspBookingId.slice(2),claim=await db.doc(`sweater_owner_booking_claims/${n}`).get();
   expect(claim.data()).toEqual(original[`sweater_owner_booking_claims/${n}`]);
   expect((await db.doc(`sweater_bookings/${n}`).get()).data().record).toEqual(original[`sweater_bookings/${n}`].record);
  }
  expect((await db.collection('washes').get()).size).toBe(payload.records.length);
  for(const name of ['journal_entries','transactions','sweater_collections'])expect((await db.collection(name).get()).empty).toBe(true);
 });
 it('creates one wash under simultaneous saves and rejects a stale financial state',async()=>{
  const {payload}=await seed('2026-11-01',['5683816']),p=await previewAdministrativeCompletion(db,payload,'admin');
  await db.doc('journal_entries/new-effect').set({sourceId:'Z-5683816'});
  await expect(saveAdministrativeCompletion(db,FieldValue,request(payload,p),'admin')).rejects.toThrow(/تعارض/);
  expect((await db.collection('washes').get()).empty).toBe(true);
  await seed('2026-11-01',['5683816']);const fresh=await previewAdministrativeCompletion(db,payload,'admin');
  const results=await Promise.all([saveAdministrativeCompletion(db,FieldValue,request(payload,fresh),'admin'),saveAdministrativeCompletion(db,FieldValue,request(payload,fresh),'admin')]);
  expect(results.filter(row=>!row.replay)).toHaveLength(1);expect((await db.collection('washes').get()).size).toBe(1);
  expect((await previewAdministrativeCompletion(db,payload,'admin')).verification.status).toBe('verified');
 });
});
