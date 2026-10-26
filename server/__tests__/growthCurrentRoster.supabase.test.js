import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import pg from 'pg';
import {createStore} from '../db/pgstore/index.js';
import {readGrowthPerformance} from '../growthPerformance.js';
import {growthMetrics} from '../../src/lib/growthMetrics.js';
const url='postgresql://postgres:postgres@127.0.0.1:55622/sweater_report_snapshot_test_20261026';
const uid='99999999-2222-4222-8222-222222222222',prefix='growth-current-test-20261026';
describe.skipIf(process.env.GROWTH_CURRENT_PG_TESTS!=='1')('current growth real queries, isolated local Postgres',()=>{
 let pool,db;
 const workerIds=['a','b','left'].map(x=>`${prefix}-${x}`),washIds=['b','left','orphan'].map(x=>`${prefix}-wash-${x}`);
 beforeAll(async()=>{
  const target=new URL(url);if(target.hostname!=='127.0.0.1'||target.pathname!=='/sweater_report_snapshot_test_20261026')throw Error('Test isolation guard');
  pool=new pg.Pool({connectionString:url});expect((await pool.query('select current_database() as name')).rows[0].name).toBe('sweater_report_snapshot_test_20261026');
  await pool.query("insert into auth.users(id,email) values($1,'growth-test@isolated.test') on conflict(id) do nothing",[uid]);
  db=createStore({connectionString:url,role:'ledger_server',max:4});await db.collection('users').doc(uid).set({role:'admin'});
  for(const [i,id] of workerIds.entries())await db.collection('bikers').doc(id).set({name:`Synthetic ${i}`,driver_external_id:`TEST200${7+i}`,start_date:'2026-02-01',current_status:i===2?'هرب':'يشتغل',salary:900,contact_number:'PRIVATE'});
  for(const [i,id] of washIds.entries())await db.collection('washes').doc(id).set({biker_id:i===2?null:workerIds[i+1],wash_date:'2026-02-02',status:'completed',quantity:i===0?4:1,price:20});
 });
 afterAll(async()=>{
  if(pool){await pool.query('delete from public.washes where id=any($1::text[])',[washIds]);await pool.query('delete from public.bikers where id=any($1::text[])',[workerIds]);await pool.query('delete from public.members where id=$1',[uid]);await pool.query('delete from auth.users where id=$1',[uid]);}
  await db?.close();await pool?.end();
 });
 it('queries the whole roster and register without snapshot membership, preserving current and orphan quantities and private fields',async()=>{
  const before=(await pool.query('select id,to_jsonb(w) as row from public.washes w where id=any($1::text[]) order by id',[washIds])).rows;
  const preview=async()=>[{periodKey:'2026-02',lines:workerIds.map(bikerId=>({bikerId,eligibleStart:'2026-02-01',eligibleEnd:'2026-02-28',daysEntitled:28}))}];
  const result=await readGrowthPerformance(db,{uid},{from:'2026-02-01',to:'2026-02-02'},{preview});
  expect(result.workers.map(w=>w.id)).toEqual(expect.arrayContaining(workerIds));expect(result.registerTotal).toBe(6);
  const metrics=growthMetrics({workers:result.workers,from:result.from,to:result.to,measurementDay:result.to});expect(metrics.total).toBe(6);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|salary|contact_number/);
  expect((await pool.query('select id,to_jsonb(w) as row from public.washes w where id=any($1::text[]) order by id',[washIds])).rows).toEqual(before);
 });
 it('enforces stored membership before any performance read',async()=>{
  await db.collection('users').doc(uid).update({role:'partner'});
  try{await expect(readGrowthPerformance(db,{uid},{from:'2026-02-01',to:'2026-02-02'})).rejects.toMatchObject({code:'permission-denied'});}finally{await db.collection('users').doc(uid).update({role:'admin'});}
 });
});
