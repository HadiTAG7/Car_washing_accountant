import { describe,it,expect } from 'vitest';
import { captureReportOperations } from '../reportOperationsSnapshot.js';
import { operationsReports } from '../operationsReports.js';
import { operationsFixture } from './operationsFixture.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { operationsSubmission } from '../../src/lib/operationsReportPublication.js';
import { overviewOperations } from '../../src/lib/overviewDashboard.js';
import { mapWash,mapBiker } from '../../src/lib/mappers.js';
import { operationsSnapshotSeed } from './operationsSnapshotFixture.js';
const now=new Date('2026-10-27T06:00:00Z'),auth={uid:'test-admin'};
const numbers=s=>Object.fromEntries(s.metrics.map(m=>[m.id,m.value]));
describe('operations snapshots from the site engines',()=>{
  it('captures the six figures and canonical counts without source writes',async()=>{
    const seed=operationsSnapshotSeed(),db=memoryFinanceDb(seed),before=JSON.stringify([...db.rows]);
    const s=await captureReportOperations(db,'2026-10-20T09:00:00+03:00',now);
    expect(numbers(s)).toEqual({'yesterday-washes':3,'month-washes':5,'working-bikers':1,'idle-bikers':1,'sweater-difference':2,'biker-cancellations':4});
    const ops=overviewOperations({washes:['one','two','three','four','five'].map(id=>mapWash({id,...seed[`washes/${id}`]})),bikers:['a','b'].map(id=>mapBiker({id,...seed[`bikers/${id}`]})),periodKey:'2026-10',today:'2026-10-27'});
    expect(numbers(s)['month-washes']).toBe(ops.quantity);expect(numbers(s)['working-bikers']).toBe(ops.working);
    expect(s.capturedAt).toBe('2026-10-27T09:00:00.000+03:00');expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('keeps absent or failed sources unknown while preserving independently available values',async()=>{
    const seed=operationsSnapshotSeed();delete seed['sweater_metric_snapshots/month'];const db=memoryFinanceDb(seed),collection=db.collection;
    db.collection=name=>name==='payroll_periods'?{doc:()=>({get:async()=>{throw Error('private failure');}})}:collection(name);
    const s=await captureReportOperations(db,null,now);expect(numbers(s)).toMatchObject({'month-washes':5,'idle-bikers':null,'sweater-difference':null,'biker-cancellations':null});expect(JSON.stringify(s)).not.toContain('private failure');
  });
  it('refuses SQL failures instead of claiming a committed administrative report',async()=>{
    const db=memoryFinanceDb(operationsSnapshotSeed()),collection=db.collection;
    db.collection=name=>name==='washes'?{get:async()=>{throw Object.assign(Error('query'),{code:'42P01'});}}:collection(name);
    await expect(captureReportOperations(db,null,now)).rejects.toMatchObject({code:'42P01'});
  });
  it('counts yesterday across the first-of-month boundary and ignores future source snapshots',async()=>{
    const seed=operationsSnapshotSeed();seed['sweater_metric_snapshots/month'].extractedAtIso='2026-11-02T09:00:00+03:00';seed['sweater_metric_snapshots/month'].periodKey='2026-11';
    seed['washes/last']={wash_date:'2026-10-31',status:'completed',quantity:8,biker_id:'a'};
    const s=await captureReportOperations(memoryFinanceDb(seed),null,new Date('2026-10-31T21:01:00Z'));expect(numbers(s)['yesterday-washes']).toBe(8);expect(numbers(s)['biker-cancellations']).toBeNull();
  });
  it('freezes first publication, strips forged numbers, warns without rejection and preserves retries/revisions',async()=>{
    const db=memoryFinanceDb(operationsSnapshotSeed()),report=operationsFixture({visibleWarnings:[{id:'code',severity:'open',text:'policyUnconfigured=true'}]});
    const request={action:'save',expectedRevision:0,report:{...report,operationsSnapshot:{spoof:true}}};
    const result=await operationsReports(db,auth,request,now);expect(numbers(result.operationsSnapshot)['month-washes']).toBe(5);expect(result.wordingWarnings).toEqual([{id:'code',message:'تحتاج صياغة'}]);
    const path=`operations_reports/${report.reportId}/revisions/000001`,original=JSON.stringify(db.rows.get(path));
    db.rows.set('washes/new',{wash_date:'2026-10-26',status:'completed',quantity:10});
    expect((await operationsReports(db,auth,request,now)).duplicate).toBe(true);expect(JSON.stringify(db.rows.get(path))).toBe(original);
    const saved=(await operationsReports(db,auth,{action:'read',reportId:report.reportId},now)).report;
    expect(operationsSubmission(saved)).toEqual(report);expect(numbers(saved.operationsSnapshot)['month-washes']).toBe(5);
    await operationsReports(db,auth,{action:'save',expectedRevision:1,report:{...report,revision:2,correctionReason:'اختبار تصحيح'}},now);
    expect(JSON.stringify(db.rows.get(path))).toBe(original);
  });
  it('does not backfill an old saved report on read',async()=>{
    const report=operationsFixture(),db=memoryFinanceDb({'users/test-admin':{role:'admin'},[`operations_reports/${report.reportId}`]:{...report},[`operations_reports/${report.reportId}/revisions/000001`]:{reportJson:JSON.stringify(report),revision:1}}),before=JSON.stringify([...db.rows]);
    expect((await operationsReports(db,auth,{action:'read',reportId:report.reportId},now)).report.operationsSnapshot).toBeUndefined();expect(JSON.stringify([...db.rows])).toBe(before);
  });
});
