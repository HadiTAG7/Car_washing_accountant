import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import pg from 'pg';
import {createStore} from '../db/pgstore/index.js';
import {operationsReports} from '../operationsReports.js';
import {operationsFixture} from './operationsFixture.js';
import {deleteOperationsFixture} from './operationsPgCleanup.js';
const url='postgresql://postgres:postgres@127.0.0.1:55622/sweater_report_snapshot_test_20261026';
const uid='11111111-1111-4111-8111-333333333333',tag='ops_snapshot_20261027',now=new Date('2048-10-27T06:00:00Z');
describe.skipIf(process.env.OPERATIONS_SNAPSHOT_PG_TESTS!=='1')('operations publication on isolated Postgres',()=>{
  let db,pool;const paths=[];
  beforeAll(async()=>{
    const target=new URL(url);if(target.hostname!=='127.0.0.1'||target.pathname!=='/sweater_report_snapshot_test_20261026')throw Error('isolation guard');
    pool=new pg.Pool({connectionString:url});expect((await pool.query('select current_database() db')).rows[0].db).toBe('sweater_report_snapshot_test_20261026');
    await pool.query("insert into auth.users(id,email) values($1,'ops-snapshot@isolated.test') on conflict(id) do nothing",[uid]);
    db=createStore({connectionString:url,role:'ledger_server',max:8});
    const seed={[`users/${uid}`]:{role:'admin'},'payroll_periods/2048-10':{currentRunId:tag},[`payroll_runs/${tag}`]:{periodKey:'2048-10',status:'approved',estimated:false,totals:{}},
      [`sweater_metric_snapshots/${tag}`]:{periodKey:'2048-10',extractedAtIso:'2048-10-27T00:00:00+03:00',metrics:{completedWashes:7,cancelledByBiker:4}}};
    for(const id of ['a','b']){const key=`${tag}_${id}`;seed[`bikers/${key}`]={name:key,start_date:'2048-10-01',current_status:'شغال'};
      seed[`payroll_runs/${tag}/items/${key}`]={bikerId:key,basicDue:900,daysEntitled:31,eligibleStart:'2048-10-01',eligibleEnd:'2048-10-31'};}
    for(let i=0;i<5;i++)seed[`washes/${tag}_${i}`]={wash_date:i<2?'2048-10-25':'2048-10-26',status:'completed',quantity:1,biker_id:`${tag}_a`};
    const batch=db.batch();for(const [path,row]of Object.entries(seed)){if((await db.doc(path).get()).exists)throw Error('Own fixture already exists; no overwrite');batch.set(db.doc(path),row);}await batch.commit();paths.push(...Object.keys(seed));
  },120000);
  afterAll(async()=>{if(db){for(const path of [...paths].reverse())await deleteOperationsFixture(pool,path);await db.close();}if(pool)await pool.end();},120000);
  it('captures atomically, deduplicates concurrent replay, and never changes source business rows',async()=>{
    const r=operationsFixture({reportId:'',dateRiyadh:'2048-10-27',serviceDateRiyadh:'2048-10-26',period:{from:'2048-10-01',to:'2048-10-26'},round:'pg-ops-snapshot',cutAtRiyadh:'2048-10-27T08:00:00+03:00',issuedAtRiyadh:'2048-10-27T08:05:00+03:00',review:{completed:true,reviewerRole:4,sourceRef:'SYNTHETIC',at:'2048-10-27T08:05:00+03:00'}});
    const head=`operations_reports/${r.reportId}`,version=`${head}/revisions/000001`;expect((await db.doc(head).get()).exists).toBe(false);
    paths.push(head,version);const before=(await db.collection('washes').get()).docs.map(d=>d.data());
    const request={action:'save',report:r,expectedRevision:0};const saved=await Promise.all([operationsReports(db,{uid},request,now),operationsReports(db,{uid},request,now)]);
    expect(saved.filter(s=>s.duplicate)).toHaveLength(1);const read=await operationsReports(db,{uid},{action:'read',reportId:r.reportId},now);
    expect(Object.fromEntries(read.report.operationsSnapshot.metrics.map(m=>[m.id,m.value]))).toEqual({'yesterday-washes':3,'month-washes':5,'working-bikers':1,'idle-bikers':1,'sweater-difference':2,'biker-cancellations':4});
    const archived=(await db.doc(version).get()).data().reportJson;await operationsReports(db,{uid},request,now);expect((await db.doc(version).get()).data().reportJson).toBe(archived);
    expect((await db.collection('washes').get()).docs.map(d=>d.data())).toEqual(before);
  },120000);
});
