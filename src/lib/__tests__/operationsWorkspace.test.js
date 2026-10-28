import {expect,it} from 'vitest';
import {operationsWorkspace} from '../operationsWorkspace.js';
import {overviewOperations} from '../overviewDashboard.js';
import {idleBikers} from '../idleBikers.js';
import {bikerBreakEven,dailyBreakEven} from '../breakEven.js';
import {COMPENSATION_KEYS} from '../../../functions/src/sweater/metricsContract.js';
const input=()=>{
  const periodKey='2026-10',today='2026-11-01';
  const bikers=[{id:'b',name:'Test',startDate:'2026-10-01',residence:'السكن',currentStatus:'يشتغل',driverExternalId:'2000',idleFollowup:{reasonKey:'training'}}];
  const washes=[{id:'w',washDate:'2026-10-31',bikerId:'b',quantity:10,status:'مكتملة'}];
  const statement={totalCosts:310,issues:[]};
  const payrollLines=[{bikerId:'b',basicDue:310,daysEntitled:31,eligibleStart:'2026-10-01',eligibleEnd:'2026-10-31'}];
  return {periodKey,today,bikers,washes,statement,payrollLines,bookings:[],
    ops:overviewOperations({periodKey,today,bikers,washes}),idle:idleBikers({periodKey,today,bikers,washes,statement,payrollLines,historyComplete:true}),
    snapshot:{periodKey,metrics:{completedWashes:10,violations:0,cancelledByBiker:0,freeWashCompensation:0},metricSources:{completedWashes:{extractedAtIso:'2026-11-01T05:00:00Z'}},eventGroups:Object.fromEntries(COMPENSATION_KEYS.map(key=>[key,{complete:true,rows:[]}]))},
    resources:{startup:[],startupEntries:[],annual:[],annualEntries:[],housing:[{name:'السكن',capacity:4}],bikes:Array.from({length:50},(_,i)=>({id:String(i),internalNumber:String(i),status:'working'})),maintenance:[],policies:[],objections:[],qualitySettings:null},
    freshness:{tone:'green',savedAt:'2026-11-01T05:00:00Z'}};
};
it('reuses existing wash, daily, availability and idle models without mutating input',()=>{
  const i=input(),before=JSON.stringify(i),r=operationsWorkspace(i),b=bikerBreakEven(i),d=dailyBreakEven({...i,completeMonth:true});
  expect(r.quantity).toBe(i.ops.quantity);expect(r.dailyRequired).toBe(d.required);
  expect(r.actualPerBiker).toBe(b.averageActualDaily);expect(r.coverage).toBe(b.averageCoverage);
  expect(r.idle).toBe(i.idle.count);expect(r.housingActive).toBe(1);expect(r.vacancies).toBe(3);
  expect(JSON.stringify(i)).toBe(before);
});
it('requires all eight evidenced checks and an ended month',()=>{
  const r=operationsWorkspace(input());expect(r.checks).toHaveLength(8);expect(r.failedCount).toBe(0);expect(r.ready).toBe(true);
  const i=input();i.today='2026-10-28';expect(operationsWorkspace(i).checks.find(c=>c.id==='ended').ok).toBe(false);
});
it('does not treat missing source readings or resources as successful zeros',()=>{
  const r=operationsWorkspace({...input(),ops:null,bikers:null,idle:null,resources:null,snapshot:null});
  expect(r.ready).toBe(false);expect(r.quantity).toBeNull();expect(r.registered).toBeNull();expect(r.violations).toBeNull();
  expect(r.checks.find(c=>c.id==='count').ok).toBe(false);expect(r.checks.find(c=>c.id==='details').count).toBe(7);
});
it('does not declare a running-month match without same-time evidence even when raw totals agree',()=>{
  const i=input();i.today='2026-10-28';i.snapshot.metricSources.completedWashes.extractedAtIso='2026-10-28T05:00:00Z';
  i.washes[0].washDate='2026-10-28';i.ops=overviewOperations(i);
  const r=operationsWorkspace(i);expect(r.difference).toBeNull();expect(r.checks.find(c=>c.id==='count').ok).toBe(false);
});
it('shows only actionable positive counts and preserves missing attribution and partial details',()=>{
  const i=input();i.bikers[0].driverExternalId='';i.bikers[0].currentStatus='هرب';i.resources.bikes=[];
  i.snapshot.eventGroups.cancelledByBiker.complete=false;
  const r=operationsWorkspace(i);expect(r.housingInactive).toBe(1);expect(r.workingBikes).toBeNull();
  expect(r.actions.find(a=>a.id==='fleet').count).toBe(50);expect(r.actions.some(a=>a.id==='link')).toBe(false);
  expect(r.checks.find(c=>c.id==='details').ok).toBe(false);expect(r.ready).toBe(false);
});
it('uses the existing objection deadline and skips closed objections for the same source reading',()=>{
  const i=input();i.resources.qualitySettings={deadlineDays:3};i.snapshot.metricSources.violations={snapshotId:'s'};
  i.snapshot.eventGroups.violations.rows=[{metricKey:'violations',sourceId:'e',date:'2026-10-30'}];
  expect(operationsWorkspace(i).nearDeadline).toBe(1);
  i.resources.objections=[{metricKey:'violations',sourceId:'e',snapshotId:'s',status:'accepted'}];
  expect(operationsWorkspace(i).nearDeadline).toBe(0);
});
