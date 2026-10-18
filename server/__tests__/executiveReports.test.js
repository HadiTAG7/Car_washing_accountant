import { expect,it,vi } from 'vitest';
import { executiveFixture } from './executiveFixture.js';
import { executiveReports } from '../executiveReports.js';
import { parseExecutiveReport } from '../../src/lib/executiveReportContract.js';
import { createExecutiveHandler } from '../../api/executive-reports.js';

function fakeDb(role='admin'){
  const docs=new Map(),reads=[],writes=[];
  const ref=path=>({path,collection:name=>collection(`${path}/${name}`),get:async()=>read(path)});
  const read=path=>{reads.push(path);return {exists:path==='users/caller'||docs.has(path),data:()=>path==='users/caller'?{role}:docs.get(path)};};
  const collection=path=>({doc:key=>ref(`${path}/${key}`)});
  return {collection,docs,reads,writes,runTransaction:async fn=>fn({get:async r=>read(r.path),
    create:(r,data)=>{if(docs.has(r.path))throw new Error('duplicate');docs.set(r.path,data);writes.push(r.path);},
    set:(r,data)=>{docs.set(r.path,data);writes.push(r.path);}})};
}
const auth={uid:'caller'},save=(db,report,expectedRevision=report.revision-1)=>executiveReports(db,auth,{action:'save',report,expectedRevision});
it('saves an administrative immutable revision and makes an exact replay idempotent',async()=>{
  const db=fakeDb(),report=executiveFixture();
  expect(await save(db,report)).toMatchObject({revision:1,duplicate:false});
  expect(await save(db,report)).toMatchObject({revision:1,duplicate:true});
  expect(db.writes).toHaveLength(2);
  expect(db.writes.every(p=>p.startsWith('executive_reports/'))).toBe(true);
  expect(db.docs.get(`${db.writes[0]}`).publishedByUid).toBe('caller');
});
it('rejects conflicting/old content and revision gaps; correction leaves the first version intact',async()=>{
  const db=fakeDb(),first=executiveFixture();await save(db,first);
  await expect(save(db,{...first,summary:'محتوى مختلف'})).rejects.toMatchObject({code:'already-exists'});
  await expect(save(db,{...first,revision:3,correctionReason:'سبب'})).rejects.toMatchObject({code:'failed-precondition'});
  await save(db,{...first,revision:2,correctionReason:'تصحيح موثق',summary:'تقرير مصحح'});
  expect(db.docs.get('executive_reports/ceo-digest-2026-10-18/revisions/000001').report.summary).toBe(first.summary);
  expect(db.docs.get('executive_reports/ceo-digest-2026-10-18').revision).toBe(2);
});
it.each(['partner','accountant','operator','supervisor',null])('denies %s before any report read/write',async role=>{
  const db=fakeDb(role);await expect(save(db,executiveFixture())).rejects.toMatchObject({code:'permission-denied'});
  expect(db.writes).toEqual([]);expect(db.reads.some(p=>p.startsWith('executive_reports'))).toBe(false);
});
it('rechecks actual membership atomically before saving',async()=>{
  const db=fakeDb();db.runTransaction=async fn=>fn({get:async ref=>({exists:ref.path==='users/caller',data:()=>({role:'partner'})})});
  await expect(save(db,executiveFixture())).rejects.toMatchObject({code:'permission-denied'});
  expect(db.writes).toEqual([]);
});
it.each([
  {reportId:'ceo-digest-2026-10-19'}, {revision:2}, {schemaVersionProposal:1},
  {weekly:{status:'included',from:'2026-10-11',to:'2026-10-18',text:'زائف'}},
  {cutAtRiyadh:'not-a-date'}, {summary:'Bearer PRIVATE_TOKEN_ABCD123456'},
])('rejects malformed/unsafe inputs before a write: %o',async changes=>{
  const db=fakeDb();await expect(save(db,executiveFixture(changes))).rejects.toBeTruthy();expect(db.writes).toEqual([]);
});
it('does not promote a self review to independent closure or accept evidence after the cut',()=>{
  const r=executiveFixture();r.decisions[0].status='verified_closed';
  expect(()=>parseExecutiveReport(r)).toThrow();
  r.decisions[0].verification={kind:'independent',reviewerRole:11,sourceRef:'TEST',at:r.cutAtRiyadh};
  expect(()=>parseExecutiveReport(r)).toThrow();
  r.decisions[0].verification.kind='self';expect(parseExecutiveReport(r).decisions[0].verification.kind).toBe('self');
  r.metrics[0].asOfRiyadh='2026-10-19T00:00:00+03:00';expect(()=>parseExecutiveReport(r)).toThrow();
});
it('checks tokens including revocation and sanitizes internal failures',async()=>{
  const response=()=>({setHeader:vi.fn(),status:vi.fn(function(n){this.code=n;return this;}),json:vi.fn(function(x){this.body=x;return this;})});
  const runtime=vi.fn(),a=response();await createExecutiveHandler(runtime)({method:'POST',headers:{}},a);expect(a.code).toBe(401);expect(runtime).not.toHaveBeenCalled();
  const verifyIdToken=vi.fn().mockRejectedValue(new Error('PRIVATE_SECRET'));const b=response();
  await createExecutiveHandler(()=>({auth:{verifyIdToken}}))({method:'POST',headers:{authorization:'Bearer fake'}},b);
  expect(b.code).toBe(401);expect(verifyIdToken).toHaveBeenCalledWith('fake',true);expect(JSON.stringify(b.body)).not.toContain('PRIVATE_SECRET');
});
