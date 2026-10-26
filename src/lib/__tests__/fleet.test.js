import { describe, it, expect } from 'vitest';
import { fleetSummary, fleetPolicy, parseFleetCsv, FLEET_CSV_COLUMNS } from '../fleet.js';
const today = '2026-10-27';
describe('fleet availability and source-only alerts', () => {
  it('never counts assigned, missing, stopped or open-repair bikes as available', () => {
    const bikes = [{ id:'free',status:'working' },{ id:'assigned',status:'working',currentBikerId:'worker' },{ id:'repair',status:'working' },{ id:'stopped',status:'stopped' },{ id:'lost',status:'missing' }];
    const r = fleetSummary({ bikes, maintenance:[{bikeId:'repair',startedOn:'2026-10-18',endedOn:''}],today });
    expect(r.available.map(b=>b.id)).toEqual(['free']); expect(r.longMaintenance).toMatchObject([{bike:{id:'repair'},days:9}]);
  });
  it('warns after seven whole days, not on seven, and ignores closed repairs', () => {
    const bikes = [{id:'a',status:'maintenance',statusSince:'2026-10-20'},{id:'b',status:'maintenance',statusSince:'2026-10-19'},{id:'c',status:'working'}];
    expect(fleetSummary({bikes,today,maintenance:[{bikeId:'c',startedOn:'2026-10-01',endedOn:'2026-10-02'}]}).longMaintenance.map(r=>r.bike.id)).toEqual(['b']);
  });
  it('supports shared and individual insurance, including exactly 30 days and expired policies', () => {
    const policies=[{id:'global',wholeFleet:true,startsOn:'2026-01-01',expiresOn:'2026-11-26'},{id:'old',wholeFleet:true,expiresOn:'2026-09-01'},{id:'own',wholeFleet:false,expiresOn:'2026-10-26'}];
    expect(fleetPolicy({policyId:'own'},policies,today).id).toBe('own'); expect(fleetPolicy({},policies,today).id).toBe('global');
    const r=fleetSummary({bikes:[{id:'a',policyId:'own'}],policies,today}); expect(r.insuranceAlerts.map(a=>a.days).sort((a,b)=>a-b)).toEqual([-1,30]);
  });
  it('keeps an empty real register empty',()=>expect(fleetSummary({today}).available).toEqual([]));
});
describe('fleet CSV preview', () => {
  const csv = row => FLEET_CSV_COLUMNS.join(',')+'\r\n'+row;
  it('reads BOM, quoted commas/newlines and blank unknown fields without creating records', () => {
    const rows=parseFleetCsv('\uFEFF'+csv('REAL-7,"أ ب ج 123","Model, one\nline",,,working,,'));
    expect(rows).toMatchObject([{internalNumber:'REAL-7',plate:'أ ب ج 123',model:'Model, one\nline',purchasedOn:'',startupItemId:'',status:'working',policyId:''}]);
  });
  it('rejects duplicate identities and plates within the file and against the register', () => {
    expect(()=>parseFleetCsv(csv('A,ABC,,, ,working,,\nA,,,,,working,,'))).toThrow();
    expect(()=>parseFleetCsv(csv('NEW,a b c,,,,working,,'),[{internalNumber:'old',plate:'ABC'}])).toThrow();
    expect(()=>parseFleetCsv(csv('existing,,,,,working,,'),[{internalNumber:'EXISTING'}])).toThrow();
  });
  it.each(['A,,,,,maintenance,,','A,,,,,working,2026-02-30,','A,,,,,unknown,,','"bad,,,,,working,,','A,,,,,working,,extra,','A,"bad"junk,,,,working,,'])('rejects malformed or unsupported source rows %s',row=>expect(()=>parseFleetCsv(csv(row))).toThrow());
  it('refuses a header-only upload and unknown/private columns',()=>{
    expect(()=>parseFleetCsv(FLEET_CSV_COLUMNS.join(','))).toThrow(); expect(()=>parseFleetCsv('internalNumber,customerPhone\nA,private')).toThrow();
  });
  it('preflights future facts and nonexistent source references before any import',()=>{
    expect(()=>parseFleetCsv(csv('A,,,2026-11-01,,working,,'),[],{today})).toThrow();
    expect(()=>parseFleetCsv(csv('A,,,,missing,working,,'),[],{today,startupIds:[]})).toThrow();
    expect(()=>parseFleetCsv(csv('A,,,,,working,,unknown'),[],{today,policyIds:[]})).toThrow();
  });
});
