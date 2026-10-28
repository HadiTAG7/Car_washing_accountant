import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { previewAdministrativeCompletion, saveAdministrativeCompletion } from '../src/sweater/administrativeCompletion.js';
import { previewOperations, saveOperations } from '../src/sweater/operationsSync.js';
import { hashRecord, normalizeRecord } from '../src/sweater/record.js';
import { calculatePayrollPreview } from '../src/payroll.js';
import { dispatch } from '../src/handlers.js';
import { completionFixture, missingStartCompletionFixture } from './administrativeCompletionFixture.js';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Local demo emulator required');
const suite = host ? describe : describe.skip;
let app, db;
const names = ['users','app_admins','bikers','washes','sweater_bookings','sweater_owner_booking_claims','sweater_owner_collection_confirmations',
  'sweater_operational_wash_links','sweater_booking_links','sweater_raw_payloads','sweater_import_runs','sweater_integration_state','sweater_settlements','accounting_periods','audit_logs','journal_entries','payroll_runs'];
async function seed() {
  for (const name of names) for (const doc of (await db.collection(name).get()).docs) await doc.ref.delete();
  for (const role of ['admin','accountant','partner','operator']) await db.collection('users').doc(role).set({ role });
  await db.collection('bikers').doc('worker1').set({ name: 'Synthetic one', driver_external_id: '1982', salary: 900, start_date: '2026-08-01' });
  await db.collection('bikers').doc('worker2').set({ name: 'Synthetic two', driver_external_id: '2009', salary: 900, start_date: '2026-08-01' });
  const p = completionFixture();
  // Stored raw evidence predates the worker-link correction. It must not be rewritten.
  for (const raw of p.records) {
    const record = normalizeRecord({ ...raw, region: 'Previously observed region' });
    await db.collection('sweater_bookings').doc(raw.sspBookingId).set({ sspBookingId: raw.sspBookingId, source: 'operations_sync_v2', record,
      serviceDate: raw.serviceDate, sourceHash: hashRecord(record), lastImportRunId: 'closed-raw-run', processingStatus: 'needs_review', operationalWorkerId: null, reviewReasonCode: 'unverified_worker_link' });
    await db.collection('sweater_owner_booking_claims').doc(raw.sspBookingId.slice(2)).set({ bookingNumber: raw.sspBookingId.slice(2), sspBookingId: raw.sspBookingId,
      washId: `ssp__${raw.sspBookingId}`, source: 'operations_sync_v2', importRunId: 'closed-raw-run' });
  }
  await db.collection('sweater_import_runs').doc('closed-raw-run').set({ source: 'operations_sync_v2', payloadHash: 'unchanged-closed-run', result: { fixed: true } });
}
async function save(p = completionFixture()) { const pre = await previewAdministrativeCompletion(db,p,'admin'); return saveAdministrativeCompletion(db,FieldValue,{ payload:p,reviewedPayloadHash:pre.reviewedPayloadHash,previewStateHash:pre.previewStateHash },'admin'); }
suite('administrative completion — isolated transactions and integration regression', () => {
  beforeAll(() => { app = initializeApp({ projectId: 'demo-sweater' }, 'administrative-completion'); db = getFirestore(app); });
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(seed, 60000);
  it('read-verifies saved source/claim/wash/commission in a consistent replay without any new save or journal', async () => {
    const payload = completionFixture(); await save(payload);
    const snapshot = async () => Object.fromEntries(await Promise.all(names.map(async name => [name, (await db.collection(name).get()).docs.map(doc => ({ id: doc.id, row: doc.data() }))])));
    const before = await snapshot(), replay = await previewAdministrativeCompletion(db, payload, 'admin');
    expect(replay.canSave).toBe(false); expect(replay.saved).toBe(false);
    expect(replay.verification).toMatchObject({ status: 'verified', matched: 4, total: 4, readOnly: true, coverage: { complete: true } });
    expect(replay.verification.rows.every(row => row.washCount === 1 && row.claimCount === 1 && row.commission.amountPerWash === 4.5 && row.commission.paid === false)).toBe(true);
    expect(await snapshot()).toEqual(before);
    const washId = replay.verification.rows[0].washId;
    await db.collection('washes').doc(washId).update({ worker_commission_paid: true });
    const changed = await snapshot(), check = await previewAdministrativeCompletion(db, payload, 'admin');
    expect(check.verification.status).toBe('mismatch'); expect(check.verification.rows[0].commission.paid).toBe(true);
    expect(await snapshot()).toEqual(changed);
    await expect(previewAdministrativeCompletion(db, payload, 'partner')).rejects.toThrow();
  }, 120000);
  it('atomically creates four pending-collection washes; preserves raw/claims/closed runs and records only unpaid commission', async () => {
    const p = completionFixture(), old = (await db.collection('sweater_bookings').doc(p.records[0].sspBookingId).get()).data();
    const claimBefore = (await db.collection('sweater_owner_booking_claims').get()).docs.map(d=>d.data());
    const closed = (await db.collection('sweater_import_runs').doc('closed-raw-run').get()).data();
    const r = await save(p); expect(r.washesCreated).toBe(4);
    const washes = (await db.collection('washes').get()).docs.map(d=>({ id:d.id,...d.data() }));
    expect(washes).toHaveLength(4);
    for (const w of washes) expect(w).toMatchObject({ price:20,vat_amount:3,gross_amount:23,collection_status:'pending',payment_method:null,
      worker_commission_per_wash:4.5,worker_commission_paid:false,ssp_raw_status:'Cancelled by Admin',owner_completion_decision:{conversationId:'test-thread',messageId:'test-message'} });
    const booked = (await db.collection('sweater_bookings').doc(p.records[0].sspBookingId).get()).data();
    for (const key of ['record','sourceHash','source','lastImportRunId','operationalWorkerId','reviewReasonCode']) expect(booked[key]).toEqual(old[key]);
    expect(booked.record.completedAt).toBeNull();
    expect((await db.collection('sweater_owner_booking_claims').get()).docs.map(d=>d.data())).toEqual(claimBefore);
    expect((await db.collection('sweater_import_runs').doc('closed-raw-run').get()).data()).toEqual(closed);
    expect((await db.collection('washes').doc('ssp__C-990005').get()).exists).toBe(false);
    for (const name of ['journal_entries','payroll_runs','sweater_owner_collection_confirmations']) expect((await db.collection(name).get()).empty).toBe(true);
    const bikers = (await db.collection('bikers').get()).docs.map(d=>({id:d.id,...d.data()}));
    const payroll = calculatePayrollPreview({ periodKey:'2026-10',bikers,washes,advances:[],adjustments:[] });
    expect(payroll.totals.commissions).toBe(18);
    const replay = await saveAdministrativeCompletion(db,FieldValue,{ payload:p,reviewedPayloadHash:r.reviewedPayloadHash,previewStateHash:r.previewStateHash },'admin');
    expect(replay.replay).toBe(true); expect((await db.collection('washes').get()).size).toBe(4);
    expect((await db.collection('audit_logs').get()).size).toBe(1);
    const other = await save({...p,importRunId:'synthetic-second-run'}); expect(other.washesCreated).toBe(0);
    expect((await db.collection('washes').get()).size).toBe(4);
  });
  it('late real completion through unchanged operations v2 never duplicates wash/commission or overwrites original cancellation', async () => {
    const p = completionFixture(); await save(p);
    const before = (await db.collection('washes').get()).docs.map(d=>d.data());
    const body = { contractVersion:2,importRunId:'late-source-completion',agentStatus:'partial',workerLinks:p.workerLinks,
      coverage:{ rangeFrom:'2026-10-21',rangeTo:'2026-10-21',extractedAt:'2026-10-24T01:15:00+03:00',pageCount:1,pagesFetched:1,recordCount:4,isComplete:false,
        sourceUrl:p.coverage.sourceUrl,modules:{individual:'complete',corporate:'unavailable'},gaps:['Corporate coverage unavailable'] },
      records:p.records.map(r=>({...r,serviceType:'interior_exterior_wash',rawStatus:'CollectingPayment',startedAt:'2026-10-21T14:00:00+03:00',completedAt:'2026-10-21T14:30:00+03:00'})) };
    const preview = await previewOperations(db,body);
    const actual = await saveOperations(db,FieldValue,{payload:body,reviewedPayloadHash:preview.reviewedPayloadHash,previewStateHash:preview.previewStateHash},'admin');
    expect(actual.washesCreated).toBe(0); expect((await db.collection('washes').get()).docs.map(d=>d.data())).toEqual(before);
    expect((await db.collection('sweater_bookings').doc('C-990001').get()).data().record.rawStatus).toBe('Cancelled by Admin');
  });
  it.each(['accountant','partner','operator'])('rejects %s on the actual dispatch preview/save paths', async role => {
    const p = completionFixture();
    await expect(dispatch(db,FieldValue,'sweaterPreviewAdministrativeCompletion',p,{uid:role,token:{role:'admin'}})).rejects.toMatchObject({code:'permission-denied'});
    await expect(dispatch(db,FieldValue,'sweaterSaveAdministrativeCompletion',{payload:p},{uid:role,token:{role:'admin'}})).rejects.toMatchObject({code:'permission-denied'});
    expect((await db.collection('washes').get()).empty).toBe(true);
  });
  it('stale preview, alias collision and protected month all reject without partial writes', async () => {
    const p = completionFixture(), pre = await previewAdministrativeCompletion(db,p,'admin');
    await db.collection('bikers').doc('worker2').update({name:'Changed synthetic name'});
    await expect(saveAdministrativeCompletion(db,FieldValue,{payload:p,reviewedPayloadHash:pre.reviewedPayloadHash,previewStateHash:pre.previewStateHash},'admin')).rejects.toThrow(/المعاينة/);
    expect((await db.collection('washes').get()).empty).toBe(true);
    await db.collection('washes').doc('legacy-alias').set({ssp_booking_id:'S-990001',biker_id:'worker1',quantity:1});
    expect((await previewAdministrativeCompletion(db,p,'admin')).canSave).toBe(false);
    await db.collection('washes').doc('legacy-alias').delete();
    await db.collection('accounting_periods').doc('2026-10').set({status:'closed'});
    await expect(previewAdministrativeCompletion(db,p,'admin')).rejects.toThrow(/محمية/);
  });
  it('two simultaneous runs cannot create a second wash', async () => {
    const p = completionFixture(), second = {...p,importRunId:'concurrent-second'};
    const a=await previewAdministrativeCompletion(db,p,'admin'), b=await previewAdministrativeCompletion(db,second,'admin');
    const results=await Promise.allSettled([[p,a],[second,b]].map(([payload,v])=>saveAdministrativeCompletion(db,FieldValue,{payload,reviewedPayloadHash:v.reviewedPayloadHash,previewStateHash:v.previewStateHash},'admin')));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect((await db.collection('washes').get()).size).toBe(4);
  });
});

suite('one-time missing-start approval — isolated transactions',()=>{
  const worker='5MMg7pj0wjYM06NLuzS7', bookingId='S-5655042';
  async function seedMissing(){
    await seed();
    const p=missingStartCompletionFixture(), record=normalizeRecord(p.records[0]);
    await db.collection('bikers').doc(worker).set({name:'Synthetic missing-start worker',driver_external_id:'1988',salary:900,start_date:'2026-08-01'});
    await db.collection('sweater_bookings').doc(bookingId).set({sspBookingId:bookingId,source:'operations_sync_v2',record,sourceHash:hashRecord(record),
      lastImportRunId:'closed-raw-run',serviceDate:record.serviceDate,operationalWorkerId:worker,processingStatus:'needs_review',reviewReasonCode:'missing_execution_evidence'});
    await db.collection('sweater_owner_booking_claims').doc('5655042').set({bookingNumber:'5655042',sspBookingId:bookingId,washId:`ssp__${bookingId}`,source:'operations_sync_v2',importRunId:'closed-raw-run'});
  }
  beforeAll(()=>{app=initializeApp({projectId:'demo-sweater'},'missing-start-completion');db=getFirestore(app);});
  afterAll(async()=>{if(app)await deleteApp(app);});
  beforeEach(seedMissing,60000);
  it('preserves source/claim, creates one unpaid commission, and replays/duplicates without another wash or side effect',async()=>{
    const p=missingStartCompletionFixture(), ref=db.collection('sweater_bookings').doc(bookingId);
    const old=(await ref.get()).data(), claim=(await db.collection('sweater_owner_booking_claims').doc('5655042').get()).data();
    const saved=await save(p);expect(saved.washesCreated).toBe(1);
    const after=(await ref.get()).data();for(const k of Object.keys(old))expect(after[k]).toEqual(old[k]);
    expect(after.ownerCompletionDecision).toMatchObject({messageId:p.decision.messageId,rawStatus:'Collecting Payment'});
    expect((await db.collection('sweater_owner_booking_claims').doc('5655042').get()).data()).toEqual(claim);
    const wash=(await db.collection('washes').doc(`ssp__${bookingId}`).get()).data();
    expect(wash).toMatchObject({biker_id:worker,quantity:1,net_amount:20,vat_amount:3,gross_amount:23,ssp_raw_status:'Collecting Payment',
      collection_status:'pending',payment_method:null,worker_commission_per_wash:4.5,worker_commission_paid:false,completion_basis:'owner_administrative_decision'});
    const raw=(await db.collection('sweater_raw_payloads').doc(`${p.importRunId}__${bookingId}`).get()).data();
    expect(raw.normalizedRecord).toMatchObject({startedAt:null,completedAt:'2026-10-24T14:48:00+03:00',rawStatus:'Collecting Payment'});
    for(const name of ['journal_entries','payroll_runs','sweater_owner_collection_confirmations'])expect((await db.collection(name).get()).empty).toBe(true);
    const workers=(await db.collection('bikers').get()).docs.map(d=>({id:d.id,...d.data()}));
    expect(calculatePayrollPreview({periodKey:'2026-10',bikers:workers,washes:[{id:`ssp__${bookingId}`,...wash}],advances:[],adjustments:[]}).totals.commissions).toBe(4.5);
    expect((await saveAdministrativeCompletion(db,FieldValue,{payload:p,reviewedPayloadHash:saved.reviewedPayloadHash,previewStateHash:saved.previewStateHash},'admin')).replay).toBe(true);
    expect((await save({...p,importRunId:'synthetic-missing-start-second'})).washesCreated).toBe(0);
    expect((await db.collection('washes').get()).size).toBe(1);
    expect((await db.collection('washes').doc(`ssp__${bookingId}`).get()).data()).toEqual(wash);
  });
  it('later real completion under either prefix never duplicates the wash/commission or rewrites the owner decision',async()=>{
    const p=missingStartCompletionFixture();await save(p);
    const before=(await db.collection('washes').doc(`ssp__${bookingId}`).get()).data(), source=(await db.collection('sweater_bookings').doc(bookingId).get()).data();
    for(const prefix of ['S','B']){
      const body={contractVersion:2,importRunId:`synthetic-late-missing-start-${prefix}`,agentStatus:'partial',workerLinks:p.workerLinks,
        coverage:{rangeFrom:'2026-10-24',rangeTo:'2026-10-24',extractedAt:'2026-10-25T00:30:00+03:00',pageCount:1,pagesFetched:1,recordCount:1,isComplete:false,
          sourceUrl:p.coverage.sourceUrl,modules:{individual:'partial',corporate:'unavailable'},gaps:['Targeted synthetic observation only']},
        records:[{...p.records[0],sspBookingId:`${prefix}-5655042`,startedAt:'2026-10-24T14:00:00+03:00'}]};
      const preview=await previewOperations(db,body),actual=await saveOperations(db,FieldValue,{payload:body,reviewedPayloadHash:preview.reviewedPayloadHash,previewStateHash:preview.previewStateHash},'admin');
      expect(actual.washesCreated).toBe(0);expect((await db.collection('washes').get()).size).toBe(1);
      expect((await db.collection('washes').doc(`ssp__${bookingId}`).get()).data()).toEqual(before);
      expect((await db.collection('sweater_bookings').doc(bookingId).get()).data()).toEqual(source);
    }
  });
  it('simultaneous runs, stale evidence and alias collisions cannot create a duplicate',async()=>{
    const p=missingStartCompletionFixture(),second={...p,importRunId:'synthetic-missing-start-concurrent'};
    const a=await previewAdministrativeCompletion(db,p,'admin'),b=await previewAdministrativeCompletion(db,second,'admin');
    const results=await Promise.allSettled([[p,a],[second,b]].map(([payload,v])=>saveAdministrativeCompletion(db,FieldValue,{payload,reviewedPayloadHash:v.reviewedPayloadHash,previewStateHash:v.previewStateHash},'admin')));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await db.collection('washes').get()).size).toBe(1);
    await seedMissing();
    const stale=await previewAdministrativeCompletion(db,p,'admin');
    await db.collection('sweater_bookings').doc(bookingId).update({'record.startedAt':'2026-10-24T14:00:00+03:00'});
    await expect(saveAdministrativeCompletion(db,FieldValue,{payload:p,reviewedPayloadHash:stale.reviewedPayloadHash,previewStateHash:stale.previewStateHash},'admin')).rejects.toThrow();
    expect((await db.collection('washes').get()).empty).toBe(true);
    await seedMissing();await db.collection('washes').doc('legacy-alias').set({ssp_booking_id:'B-5655042',biker_id:worker,quantity:1});
    expect((await previewAdministrativeCompletion(db,p,'admin')).canSave).toBe(false);
  });
  it.each(['closed-period','approved-settlement','financial-link','wrong-claim'])('rejects %s without a wash',async kind=>{
    if(kind==='closed-period')await db.collection('accounting_periods').doc('2026-10').set({status:'closed'});
    if(kind==='approved-settlement')await db.collection('sweater_settlements').doc('2026-10').set({status:'approved'});
    if(kind==='financial-link')await db.collection('sweater_bookings').doc(bookingId).update({postedEntryId:'synthetic-journal'});
    if(kind==='wrong-claim')await db.collection('sweater_owner_booking_claims').doc('5655042').update({sspBookingId:'B-5655042'});
    const p=missingStartCompletionFixture();let rejected=false;
    try{rejected=!(await previewAdministrativeCompletion(db,p,'admin')).canSave;}catch{rejected=true;}
    expect(rejected).toBe(true);expect((await db.collection('washes').get()).empty).toBe(true);
  });
  it.each(['accountant','operator','partner'])('does not grant %s access to the scoped exception',async role=>{
    await expect(dispatch(db,FieldValue,'sweaterPreviewAdministrativeCompletion',missingStartCompletionFixture(),{uid:role,token:{role:'admin'}})).rejects.toMatchObject({code:'permission-denied'});
    expect((await db.collection('washes').get()).empty).toBe(true);
  });
});
