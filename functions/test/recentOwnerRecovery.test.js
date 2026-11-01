import {describe,expect,it} from 'vitest';
import {memoryFinanceDb} from '../../server/__tests__/financeFixtures.js';
import {recentRecoveryFixture} from './recentOwnerRecoveryFixture.js';
import {previewAdministrativeCompletion,saveAdministrativeCompletion} from '../src/sweater/administrativeCompletion.js';
import {executionEligibility} from '../src/sweater/operationsExecution.js';
import {normalizeRecord} from '../src/sweater/record.js';
const fieldValue={serverTimestamp:()=> 'SYNTHETIC-TIMESTAMP'};
const request=(payload,preview)=>({payload,reviewedPayloadHash:preview.reviewedPayloadHash,previewStateHash:preview.previewStateHash});

describe('bounded recent-wash completion under the verified new owner instruction',()=>{
  it.each(['2026-10-30','2026-10-31','2026-11-01'])('preserves claim/source/history and creates one canonical wash and unpaid commission per approved identity for%s',async day=>{
    const {payload,seed}=recentRecoveryFixture(day),db=memoryFinanceDb(seed),before=structuredClone(seed);
    const preview=await previewAdministrativeCompletion(db,payload,'admin');
    expect(preview.canSave).toBe(true);expect(preview.rows.every(row=>row.sourceRecovery.eligible)).toBe(true);
    expect(Object.fromEntries(db.rows)).toEqual(before);
    const result=await saveAdministrativeCompletion(db,fieldValue,request(payload,preview),'admin');
    expect(result.washesCreated).toBe(payload.records.length);
    for(const r of payload.records){
      const number=r.sspBookingId.slice(2),claimKey=`sweater_owner_booking_claims/${number}`;
      expect(db.rows.get(claimKey)).toEqual(before[claimKey]);
      const sourceKey=`sweater_bookings/${number}`;
      expect(db.rows.get(sourceKey).record).toEqual(before[sourceKey].record);
      expect(db.rows.get(sourceKey).serviceDate).toBe(before[sourceKey].serviceDate);
      expect(db.rows.get(sourceKey).operationalWorkerId).toBe(before[sourceKey].operationalWorkerId);
      expect(db.rows.get(`washes/${before[claimKey].washId}`)).toMatchObject({ssp_booking_id:r.sspBookingId,quantity:1,net_amount:20,vat_amount:3,gross_amount:23,
        completion_basis:'owner_administrative_decision',collection_status:'pending',payment_method:null,worker_commission_per_wash:4.5,worker_commission_paid:false});
    }
    for(const [key,value] of Object.entries(before).filter(([key])=>/sweater_raw_payloads|sweater_import_runs/.test(key)))expect(db.rows.get(key)).toEqual(value);
    const after=structuredClone([...db.rows]);
    const replay=await previewAdministrativeCompletion(db,payload,'admin');
    expect(replay.verification).toMatchObject({status:'verified',matched:payload.records.length,total:payload.records.length,readOnly:true});
    expect([...db.rows]).toEqual(after);
    await saveAdministrativeCompletion(db,fieldValue,request(payload,preview),'admin');expect([...db.rows]).toEqual(after);
    expect([...db.rows.keys()].some(key=>key.startsWith('journal_entries/')||key.startsWith('payroll_runs/'))).toBe(false);
  });
  it('retains equal displayed Start/End as owner completion without changing automatic eligibility',async()=>{
    const {payload,seed}=recentRecoveryFixture('2026-11-01',['5678622']),db=memoryFinanceDb(seed),r=payload.records[0];
    expect(r.startedAt).toBe(r.completedAt);
    expect(executionEligibility(normalizeRecord(r),payload.coverage,{name:'Synthetic worker'}).eligible).toBe(false);
    const preview=await previewAdministrativeCompletion(db,payload,'admin');expect(preview.canSave).toBe(true);
    await saveAdministrativeCompletion(db,fieldValue,request(payload,preview),'admin');
    const replay=await previewAdministrativeCompletion(db,payload,'admin');
    expect(replay.verification.rows[0].originalSource.startedAt).toBe(r.startedAt);
    expect(replay.verification.rows[0].originalSource.completedAt).toBe(r.completedAt);
  });
  it.each(['worker','day','start','end','source-url','extra-source-field','notes-only','other-prefix','other-identity','old-owner-reference','cut','statement'])('rejects changed%s without a write',async fault=>{
    const {payload,seed}=recentRecoveryFixture('2026-11-01',['5683816']),db=memoryFinanceDb(seed),r=payload.records[0];
    if(fault==='worker')r.driverExternalId='1982';
    if(fault==='day')r.serviceDate='2026-11-02';
    if(fault==='start')r.startedAt='2026-11-01T21:29:00+03:00';
    if(fault==='end')r.completedAt='2026-11-01T21:58:00+03:00';
    if(fault==='source-url')r.sourceUrl='https://ssp-portal.sweater.sa/bikers';
    if(fault==='extra-source-field')r.platformAmount=23;
    if(fault==='notes-only')r.notes='Owner approved or End verified in this text';
    if(fault==='other-prefix'){r.sspBookingId='B-5683816';payload.decision.bookingIds=[r.sspBookingId];}
    if(fault==='other-identity'){r.sspBookingId='S-9999999';payload.decision.bookingIds=[r.sspBookingId];}
    if(fault==='old-owner-reference')payload.decision.messageId='01a16fb9-0e70-7203-b117-6f8c2fe44a8c';
    if(fault==='cut')payload.coverage.extractedAt='2026-11-01T22:08:08.943Z';
    if(fault==='statement')payload.decision.statement+=' changed';
    const before=structuredClone([...db.rows]);
    await expect(previewAdministrativeCompletion(db,payload,'admin')).rejects.toThrow();expect([...db.rows]).toEqual(before);
  });
  it.each(['missing-claim','missing-booking','missing-raw','duplicate-receipt','duplicate-claim','foreign-wash','foreign-link','financial-reference','locked-booking','unknown-booking-field','foreign-booking-alias','bad-raw','unfinished-run','old-created-wash','bad-canonical-id'])('blocks%s with all protection retained',async fault=>{
    const {payload,seed}=recentRecoveryFixture('2026-11-01',['5683816']),n='5683816';
    if(fault==='missing-claim')delete seed[`sweater_owner_booking_claims/${n}`];
    if(fault==='missing-booking')delete seed[`sweater_bookings/${n}`];
    if(fault==='missing-raw')delete seed[`sweater_raw_payloads/synthetic-first-${n}__B-${n}`];
    if(fault==='duplicate-receipt')seed[`sweater_import_runs/synthetic-first-${n}`].result.rows.push({...seed[`sweater_import_runs/synthetic-first-${n}`].result.rows[0]});
    if(fault==='duplicate-claim')seed['sweater_owner_booking_claims/alias']={...seed[`sweater_owner_booking_claims/${n}`]};
    if(fault==='foreign-wash')seed['washes/ssp__Z-5683816']={ssp_booking_id:'Z-5683816'};
    if(fault==='foreign-link')seed['sweater_booking_links/foreign']={sspBookingId:'Z-5683816'};
    if(fault==='financial-reference')seed['journal_entries/unrelated-prefix']={sourceId:'Z-5683816'};
    if(fault==='locked-booking')seed[`sweater_bookings/${n}`].financialLock=true;
    if(fault==='unknown-booking-field')seed[`sweater_bookings/${n}`].unexpected=true;
    if(fault==='foreign-booking-alias')seed[`sweater_bookings/${n}`].aliases=['B-9999999'];
    if(fault==='bad-raw')seed[`sweater_raw_payloads/synthetic-first-${n}__B-${n}`].normalizedRecord.rawStatus='altered';
    if(fault==='unfinished-run')seed[`sweater_import_runs/synthetic-first-${n}`].status='started';
    if(fault==='old-created-wash')seed[`sweater_import_runs/synthetic-first-${n}`].result.rows[0].washCreated=true;
    if(fault==='bad-canonical-id')seed[`sweater_owner_booking_claims/${n}`].washId='ssp__B-9999999';
    const db=memoryFinanceDb(seed),before=structuredClone([...db.rows]);
    expect((await previewAdministrativeCompletion(db,payload,'admin')).canSave).toBe(false);expect([...db.rows]).toEqual(before);
  });
  it('keeps period, settlement, actual role and stale-preview guards and serializes simultaneous saves',async()=>{
    const {payload,seed}=recentRecoveryFixture('2026-11-01',['5683816']);
    await expect(previewAdministrativeCompletion(memoryFinanceDb(seed),payload,'partner')).rejects.toThrow(/للمدير/);
    await expect(previewAdministrativeCompletion(memoryFinanceDb({...seed,'accounting_periods/2026-11':{status:'closed'}}),payload,'admin')).rejects.toThrow(/محمية/);
    await expect(previewAdministrativeCompletion(memoryFinanceDb({...seed,'sweater_settlements/2026-11':{status:'approved'}}),payload,'admin')).rejects.toThrow(/محمية/);
    const db=memoryFinanceDb(seed),preview=await previewAdministrativeCompletion(db,payload,'admin');
    db.rows.get('sweater_bookings/5683816').updatedAtIso='changed';
    await expect(saveAdministrativeCompletion(db,fieldValue,request(payload,preview),'admin')).rejects.toThrow(/تغير/);
    const fresh=await previewAdministrativeCompletion(db,payload,'admin');
    const results=await Promise.all([saveAdministrativeCompletion(db,fieldValue,request(payload,fresh),'admin'),saveAdministrativeCompletion(db,fieldValue,request(payload,fresh),'admin')]);
    expect(results.reduce((sum,row)=>sum+(row.replay?0:row.washesCreated),0)).toBe(1);
    const changed=structuredClone(payload);changed.importRunId+='-other';
    expect((await previewAdministrativeCompletion(db,changed,'admin')).canSave).toBe(false);
  });
  it('allows a truthful newer delivery cut without changing old source cuts, and still blocks a protected original period',async()=>{
    const {payload,seed}=recentRecoveryFixture('2026-11-01',['5681609']);
    payload.coverage.extractedAt='2026-11-01T22:40:00Z';
    expect((await previewAdministrativeCompletion(memoryFinanceDb(seed),payload,'admin')).canSave).toBe(true);
    const db=memoryFinanceDb({...seed,'accounting_periods/2026-10':{status:'closed'}});
    const blocked=await previewAdministrativeCompletion(db,payload,'admin');
    expect(blocked.canSave).toBe(false);expect(blocked.rows[0].sourceRecovery.checks.originalSourcePeriodsUnprotected).toBe(false);
    expect([...db.rows.keys()].some(key=>key.startsWith('washes/'))).toBe(false);
  });
  it.each(['claim','booking','history','unpaid-commission'])('readback detects changed%s without repairing it',async fault=>{
    const {payload,seed}=recentRecoveryFixture('2026-11-01',['5683816']),db=memoryFinanceDb(seed),preview=await previewAdministrativeCompletion(db,payload,'admin');
    await saveAdministrativeCompletion(db,fieldValue,request(payload,preview),'admin');
    if(fault==='claim')db.rows.get('sweater_owner_booking_claims/5683816').claimedBy='changed';
    if(fault==='booking')db.rows.get('sweater_bookings/5683816').record.serviceDate='2026-10-31';
    if(fault==='history')db.rows.get('sweater_import_runs/synthetic-first-5683816').coverage.extractedAt='changed';
    if(fault==='unpaid-commission')db.rows.get('washes/ssp__B-5683816').worker_commission_paid=true;
    const before=structuredClone([...db.rows]),readback=await previewAdministrativeCompletion(db,payload,'admin');
    expect(readback.verification.status).toBe('mismatch');expect([...db.rows]).toEqual(before);
  });
});
