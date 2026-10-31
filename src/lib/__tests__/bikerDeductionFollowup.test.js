import { expect, it } from 'vitest';
import { BIKER_DEDUCTION_TYPE, BIKER_DEDUCTION_AUTHORITY } from '../sweater/bikerDeductions';
import { bikerDeductionFollowupAmount, summarizeBikerDeductions } from '../sweater/bikerDeductionFollowup';

const row = (id, bikerId, value, extra = {}) => ({ id, recordType: BIKER_DEDUCTION_TYPE, status: 'recorded', bikerId, bikerName: `Test ${bikerId}`,
  periodKey: '2026-10', sourceKind: 'booking', sourceId: `C-${id}`, metricKey: 'cancelledByBiker', decisionReference: BIKER_DEDUCTION_AUTHORITY, unit: 'count', quantity: 1, amountSAR: value,
  event: { metricKey: 'cancelledByBiker', bookingId: `C-${id}`, date: '2026-10-20', amount: value, quantity: 1 }, ...extra });
it('preserves known amounts including true zero and uses the owner policy only for missing assigned cancellation amounts', () => {
  expect(bikerDeductionFollowupAmount(row('1','A',129.95))).toEqual({ sourceAmountSAR:129.95,effectiveAmountSAR:129.95,basis:'source' });
  expect(bikerDeductionFollowupAmount(row('2','A',0))).toEqual({ sourceAmountSAR:0,effectiveAmountSAR:0,basis:'source' });
  expect(bikerDeductionFollowupAmount(row('3','A',null))).toEqual({ sourceAmountSAR:null,effectiveAmountSAR:20,basis:'owner_decision' });
  expect(bikerDeductionFollowupAmount(row('4','A',null,{metricKey:'violations',unit:'sar'})).effectiveAmountSAR).toBeNull();
  expect(bikerDeductionFollowupAmount(row('5','A','129.95')).effectiveAmountSAR).toBeNull();
  const zero=row('6','A',null);zero.event.amount=0; expect(bikerDeductionFollowupAmount(zero).basis).toBe('source');
});
it('does not price conflicting cancellation quantities or a mismatched booking link', () => {
  const valid=row('101','A',null);
  expect(bikerDeductionFollowupAmount({...valid,quantity:2}).effectiveAmountSAR).toBeNull();
  expect(bikerDeductionFollowupAmount({...valid,event:{...valid.event,quantity:2}}).effectiveAmountSAR).toBeNull();
  expect(bikerDeductionFollowupAmount({...valid,sourceId:'C-102'}).effectiveAmountSAR).toBeNull();
  expect(bikerDeductionFollowupAmount({...valid,eventIdentity:'wrong'}).effectiveAmountSAR).toBeNull();
  const known=row('101','A',129.95);
  expect(bikerDeductionFollowupAmount({...known,quantity:2})).toMatchObject({sourceAmountSAR:129.95,effectiveAmountSAR:null,basis:'unavailable'});
});
it('matches the four assigned-event example, splits provenance, and leaves every source field unchanged', () => {
  const records = [row('101','A',129.95),row('102','A',null),row('103','B',129.95),row('104','C',129.95)];
  const before = structuredClone(records), result = summarizeBikerDeductions(records,'2026-10');
  expect(result).toMatchObject({eventCount:4,sourceSAR:389.85,ownerSAR:20,totalSAR:409.85,unpricedCount:0});
  expect(result.bikers.map(b=>b.totalSAR)).toEqual([149.95,129.95,129.95]);
  expect(records).toEqual(before); expect(records[1].amountSAR).toBeNull(); expect(records[1].event.amount).toBeNull();
});
it('counts repeated readings and B/C/S cancellation aliases once without rewriting stored IDs', () => {
  const first=row('101','A',129.95), alias={...first,id:'alias',event:{...first.event,bookingId:'B-101'}};
  const result=summarizeBikerDeductions([first,structuredClone(first),alias]);
  expect(result).toMatchObject({eventCount:1,totalSAR:129.95,duplicateCount:2});
  expect(first.event.bookingId).toBe('C-101'); expect(alias.event.bookingId).toBe('B-101');
});
it('does not assign customer cancellations, maintenance, unassigned records, other months or events outside the existing authority', () => {
  const valid=row('101','A',null);
  const records=[valid,...['cancelledByCustomer','cancelledMaintenance'].map((metricKey,i)=>row(String(i),'A',null,{metricKey,event:{...valid.event,metricKey}})),
    row('102',null,null),row('103','A',null,{periodKey:'2026-09'}),row('104','A',null,{decisionReference:'other'}),
    row('105','A',null,{event:{...valid.event,date:'2026-10-29'}}),{...valid,id:'untyped',recordType:'other'}];
  expect(summarizeBikerDeductions(records,'2026-10')).toMatchObject({eventCount:1,totalSAR:20,ignoredCount:7});
});
it('uses the saved current revision only and refuses conflicting duplicate assignments or money', () => {
  const current=row('101','A',0), old=row('101','B',129.95);
  expect(summarizeBikerDeductions([{...old,current}]).bikers[0]).toMatchObject({bikerId:'A',totalSAR:0,ownerSAR:0});
  const conflict=summarizeBikerDeductions([current,{...old,id:'other'}]);
  expect(conflict).toMatchObject({eventCount:0,totalSAR:0,unpricedCount:1}); expect(conflict.conflicts).toHaveLength(1);
  expect(bikerDeductionFollowupAmount({...current,event:{...current.event,amount:129.95}}).basis).toBe('unavailable');
});
