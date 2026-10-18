import { readFileSync } from 'node:fs';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { initializeApp,deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment,assertFails } from '@firebase/rules-unit-testing';
import { collection,doc,getDoc,getDocs,setDoc } from 'firebase/firestore';
import { executiveReports } from '../executiveReports.js';
import { executiveFixture } from './executiveFixture.js';

const local=/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'');
describe.skipIf(!local)('executive administrative persistence — isolated demo only',()=>{
  let app,db,environment;
  const projectId='demo-sweater-executive',paths=new Set(['users/executive-admin','users/executive-partner']);
  const auth={uid:'executive-admin'};
  const report=executiveFixture();
  const head=`executive_reports/${report.reportId}`;
  beforeAll(async()=>{
    if(!projectId.startsWith('demo-')||!local)throw new Error('Isolated demo required.');
    app=initializeApp({projectId},`executive-tests-${Date.now()}`);db=getFirestore(app);
    const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
    environment=await initializeTestEnvironment({projectId,firestore:{host,port:Number(port),rules:readFileSync('firestore.rules','utf8')}});
    await db.doc('users/executive-admin').set({role:'admin'});await db.doc('users/executive-partner').set({role:'partner'});
  });
  afterAll(async()=>{if(db){await Promise.all([...paths].map(p=>db.doc(p).delete()));await db.terminate();}if(environment)await environment.cleanup();if(app)await deleteApp(app);});
  it('saves, re-reads, replays idempotently and retains old corrected revisions on the real SDK',async()=>{
    for(const path of [head,`${head}/revisions/000001`,`${head}/revisions/000002`])paths.add(path);
    const save=(r,expectedRevision)=>executiveReports(db,auth,{action:'save',report:r,expectedRevision});
    expect(await save(report,0)).toMatchObject({duplicate:false,revision:1});
    expect(await save(report,0)).toMatchObject({duplicate:true});
    const first=await executiveReports(db,auth,{action:'read',reportId:report.reportId});
    expect(first.report.summary).toBe(report.summary);expect(first.currentRevision).toBe(1);
    const corrected={...report,revision:2,summary:'تصحيح وهمي موثق',correctionReason:'سبب التصحيح في العزل'};
    await save(corrected,1);
    const reloaded=await executiveReports(db,auth,{action:'read',reportId:report.reportId});
    expect(reloaded.report.summary).toBe(corrected.summary);expect(reloaded.history).toHaveLength(2);
    const old=await executiveReports(db,auth,{action:'read',reportId:report.reportId,revision:1});
    expect(old.report.summary).toBe(report.summary);expect(old.currentRevision).toBe(2);
    await expect(save({...report,summary:'هجوم استبدال'},0)).rejects.toMatchObject({code:'already-exists'});
    await expect(save({...corrected,revision:4},3)).rejects.toMatchObject({code:'failed-precondition'});
  });
  it('fails a concurrent conflicting create without overwriting its winning report',async()=>{
    const r=executiveFixture({reportId:'ceo-digest-2026-10-19',dateRiyadh:'2026-10-19',cutAtRiyadh:'2026-10-19T00:00:00+03:00'});
    const base=`executive_reports/${r.reportId}`;paths.add(base);paths.add(`${base}/revisions/000001`);
    const attempts=await Promise.allSettled([r,{...r,summary:'محتوى متعارض'}].map(value=>executiveReports(db,auth,{action:'save',report:value,expectedRevision:0})));
    expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(attempts.filter(x=>x.status==='rejected')).toHaveLength(1);
  });
  it('lists bounded archive pages without losing older dates',async()=>{
    for(let n=1;n<=32;n++){
      const day=new Date(Date.UTC(2026,7,n)).toISOString().slice(0,10),id=`ceo-digest-${day}`,path=`executive_reports/${id}`;paths.add(path);
      await db.doc(path).set({reportId:id,dateRiyadh:day,title:'فهرس وهمي',revision:1,cutAtRiyadh:`${day}T23:00:00+03:00`});
    }
    const first=await executiveReports(db,auth,{action:'list'});expect(first.items).toHaveLength(30);expect(first.nextBefore).toBeTruthy();
    const next=await executiveReports(db,auth,{action:'list',before:first.nextBefore});expect(next.items.length).toBeGreaterThan(0);
    expect(next.items.some(b=>first.items.some(a=>a.reportId===b.reportId))).toBe(false);
  });
  it('rejects a real partner before returning or saving a report',async()=>{
    for(const input of [{action:'list'},{action:'read',reportId:report.reportId},{action:'save',report,expectedRevision:0}])
      await expect(executiveReports(db,{uid:'executive-partner'},input)).rejects.toMatchObject({code:'permission-denied'});
  });
  it.each(['executive-admin','executive-partner',null])('unchanged production rules deny direct read/list/write including %s',async uid=>{
    const client=uid?environment.authenticatedContext(uid).firestore():environment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(client,head)));
    await assertFails(getDocs(collection(client,'executive_reports')));
    await assertFails(setDoc(doc(client,'executive_reports','attack'),{summary:'not allowed'}));
    await assertFails(getDoc(doc(client,`${head}/revisions/000001`)));
  });
});
