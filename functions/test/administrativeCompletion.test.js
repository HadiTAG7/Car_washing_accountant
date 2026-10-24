import { describe, expect, it } from 'vitest';
import { reviewAdministrativeCompletion } from '../../src/lib/sweater/administrativeCompletion.js';
import { completionFixture, missingStartCompletionFixture } from './administrativeCompletionFixture.js';
import { previewAdministrativeCompletion } from '../src/sweater/administrativeCompletion.js';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { normalizeRecord } from '../src/sweater/record.js';
import { executionEligibility } from '../src/sweater/operationsExecution.js';
describe('bounded administrative completion contract', () => {
  it('keeps original cancellations and actual/missing start/end evidence without a collection assertion', () => {
    const p = completionFixture(), copy = structuredClone(p), r = reviewAdministrativeCompletion(p);
    expect(r.ready).toBe(true); expect(r.payload).toEqual(copy);
    expect(r.rows).toHaveLength(4); expect(p.records.every(row => row.completedAt === null)).toBe(true);
    expect(r.payload.ownerConfirmation).toBeUndefined();
  });
  it.each([
    p => { p.records[0].sspBookingId = 'C-990005'; p.decision.bookingIds[0] = 'C-990005'; },
    p => { p.records.push({ ...p.records[0], sspBookingId: 'S-990001' }); p.decision.bookingIds.push('S-990001'); p.coverage.recordCount++; },
    p => { p.decision.messageId = ''; }, p => { p.decision.approved = false; },
    p => { p.records[0].rawStatus = 'Collecting Payment'; }, p => { p.coverage.isComplete = true; },
    p => { p.records[0].payment_method = 'cash'; }, p => { p.ownerConfirmation = { collectionStatus: 'confirmed_by_owner' }; },
    p => { p.decision.bookingIds = []; }, p => { p.workerLinks['1982'] = '../other'; },
  ])('rejects excluded/duplicate/out-of-scope/forged financial inputs', mutate => {
    const p = completionFixture(); mutate(p); expect(reviewAdministrativeCompletion(p).ready).toBe(false);
  });
  it('server preview works on a database with writes disabled', async () => {
    const db = memoryFinanceDb({ 'users/admin': { role: 'admin' },
      'bikers/worker1': { name: 'Synthetic one', driver_external_id: '1982', start_date: '2026-08-01' },
      'bikers/worker2': { name: 'Synthetic two', driver_external_id: '2009', start_date: '2026-08-01' } });
    db.runTransaction = () => { throw new Error('No writes permitted in preview'); };
    const before = JSON.stringify([...db.rows]);
    const r = await previewAdministrativeCompletion(db, completionFixture(), 'admin');
    expect(r.canSave).toBe(true); expect(r.rows).toHaveLength(4);
    expect(r.rows.every(x => x.collectionStatus === 'pending' && x.workerCommission === 4.5 && x.assertedAmount === 20 && x.vatAmount === 3 && x.grossAmount === 23)).toBe(true);
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
});

describe('one-time missing-start owner approval for 5655042 only', () => {
  it('accepts the named decision, preserving CP, explicit null Start and actual End without relaxing automatic execution', () => {
    const p=missingStartCompletionFixture(), before=structuredClone(p), review=reviewAdministrativeCompletion(p);
    expect(review.ready).toBe(true); expect(review.payload).toEqual(before);
    expect(executionEligibility(normalizeRecord(p.records[0]),p.coverage,{})).toEqual({eligible:false,reasonCode:'missing_execution_evidence'});
  });
  it.each([
    p=>{p.records[0].sspBookingId='S-5655043';p.decision.bookingIds=['S-5655043'];},
    p=>{p.records[0].sspBookingId='B-5655042';p.decision.bookingIds=['B-5655042'];},
    p=>{p.records[0].serviceDate='2026-10-25';p.decision.serviceDate='2026-10-25';p.coverage.rangeFrom=p.coverage.rangeTo='2026-10-25';},
    p=>{p.records[0].driverExternalId='1989';p.workerLinks={'1989':'5MMg7pj0wjYM06NLuzS7'};},
    p=>{p.workerLinks['1988']='other-worker';},
    p=>{p.records[0].completedAt='2026-10-24T14:49:00+03:00';},
    p=>{p.records[0].startedAt='2026-10-24T14:00:00+03:00';},
    p=>{delete p.records[0].startedAt;},
    p=>{p.records[0].rawStatus='Washing Started';},
    p=>{p.records[0].rawStatus='CollectingPayment';},
    p=>{p.records[0].bookingKind='corporate';},
    p=>{p.records[0].serviceType=null;},
    p=>{p.decision.messageId='another-message';},
    p=>{p.decision.conversationId='another-thread';},
    p=>{p.decision.approved=false;},
    p=>{p.records.push(completionFixture().records[0]);p.decision.bookingIds.push('C-990001');p.workerLinks['1982']='worker1';p.coverage.recordCount++;},
  ])('does not generalize the exception when an approved identity/evidence boundary changes', mutate=>{
    const p=missingStartCompletionFixture();mutate(p);expect(reviewAdministrativeCompletion(p).ready).toBe(false);
  });
  it('requires matching stored source and verified worker on a write-disabled server preview',async()=>{
    const p=missingStartCompletionFixture(), r=normalizeRecord(p.records[0]);
    const db=memoryFinanceDb({'users/admin':{role:'admin'},
      'bikers/5MMg7pj0wjYM06NLuzS7':{name:'Synthetic worker',driver_external_id:'1988'},
      'sweater_bookings/S-5655042':{sspBookingId:r.sspBookingId,source:'operations_sync_v2',record:r,operationalWorkerId:p.workerLinks['1988']}});
    db.runTransaction=()=>{throw new Error('Preview cannot write');};
    const before=JSON.stringify([...db.rows]);
    expect((await previewAdministrativeCompletion(db,p,'admin')).canSave).toBe(true);
    expect(JSON.stringify([...db.rows])).toBe(before);
    for(const change of [{record:{...r,startedAt:'2026-10-24T14:00:00+03:00'}},{operationalWorkerId:null},{source:'other'}]){
      db.rows.set('sweater_bookings/S-5655042',{sspBookingId:r.sspBookingId,source:'operations_sync_v2',record:r,operationalWorkerId:p.workerLinks['1988'],...change});
      expect((await previewAdministrativeCompletion(db,p,'admin')).canSave).toBe(false);
    }
    db.rows.delete('sweater_bookings/S-5655042');
    expect((await previewAdministrativeCompletion(db,p,'admin')).canSave).toBe(false);
  });
});
