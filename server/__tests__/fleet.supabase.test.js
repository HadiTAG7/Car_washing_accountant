import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createStore, FieldValue } from '../db/pgstore/index.js';
import { saveFleet, fleetBikeId } from '../../functions/src/fleet.js';
const url='postgresql://postgres:postgres@127.0.0.1:55622/sweater_report_snapshot_test_20261026';
const uid='99999999-4444-4444-8444-444444444444', accountant='99999999-5555-4555-8555-555555555555', operator='99999999-6666-4666-8666-666666666666';
const prefix='fleet-isolated-20261027', now=new Date('2098-10-27T12:00:00+03:00');
const bikeData = n => ({internalNumber:`${prefix}-${n}`,plate:`TEST-${n}`,model:'Synthetic',purchasedOn:'2098-05-01',startupItemId:prefix+'-startup',status:'working',statusSince:'',policyId:''});
const tables=['fleet_bikes','fleet_assignments','fleet_maintenance','fleet_incidents','fleet_policies'];
describe.skipIf(process.env.FLEET_PG_TESTS!=='1')('fleet actions with isolated Postgres and real RLS',()=>{
  let pool,db,originalControl,financialBefore,sourceBefore;
  const ids=[];
  const save = (kind,id,data,expectedRevision=0,actor=uid)=>saveFleet(db,FieldValue,{kind,id,expectedRevision,data},{userId:actor,now});
  const addBike = async n => {const data=bikeData(n),id=fleetBikeId(data.internalNumber); ids.push(id); return save('bike',id,data);};
  beforeAll(async()=>{
    const target=new URL(url); if(target.hostname!=='127.0.0.1'||target.pathname!=='/sweater_report_snapshot_test_20261026')throw Error('Isolation guard');
    pool=new pg.Pool({connectionString:url}); expect((await pool.query('select current_database() as name')).rows[0].name).toBe('sweater_report_snapshot_test_20261026');
    const existing=(await pool.query("select tablename from pg_tables where schemaname='public' and tablename like 'fleet_%'")).rows;
    if(!existing.length)await pool.query(await readFile(new URL('../../supabase/migrations/20261026214026_fleet.sql',import.meta.url),'utf8'));
    else expect(existing).toHaveLength(6);
    db=createStore({connectionString:url,role:'ledger_server',max:6}); originalControl=await db.collection('fleet_control').doc('registry').get();
    for(const [id,role]of [[uid,'admin'],[accountant,'accountant'],[operator,'operator']]){
      await pool.query('insert into auth.users(id,email) values($1,$2) on conflict(id) do nothing',[id,`${role}-fleet@isolated.test`]);
      await db.collection('users').doc(id).set({role,displayName:'Isolated fleet tester'});
    }
    for(const n of [1,2,3])await db.collection('bikers').doc(`${prefix}-biker-${n}`).set({name:`Synthetic ${n}`,salary:900,current_status:'نشط',start_date:'2098-01-01'});
    await db.collection('startup_costs').doc(prefix+'-startup').set({item_name:'Synthetic bikes',quantity:50,actual_amount:123});
    sourceBefore=(await db.collection('startup_costs').doc(prefix+'-startup').get()).data();
    financialBefore=(await pool.query('select (select count(*) from public.journal_entries) as journals,(select count(*) from public.fixed_assets) as assets,(select count(*) from public.washes) as washes')).rows;
  });
  afterAll(async()=>{
    if(pool){
      await pool.query("delete from public.audit_logs where action like 'fleet-%' and user_id=$1",[uid]);
      for(const table of tables)await pool.query(`delete from public.${table} where id=any($1::text[]) or id like $2`,[ids,prefix+'%']);
      if(originalControl?.exists)await db.collection('fleet_control').doc('registry').set(originalControl.data()); else await pool.query("delete from public.fleet_control where id='registry'");
      await pool.query('delete from public.bikers where id like $1',[prefix+'%']);await pool.query('delete from public.startup_costs where id=$1',[prefix+'-startup']);
      await pool.query('delete from public.members where id=any($1::text[])',[[uid,accountant,operator]]);await pool.query('delete from auth.users where id=any($1::uuid[])',[[uid,accountant,operator]]);
    }
    await db?.close();await pool?.end();
  });
  it('requires server-side admin and rejects foreign/financial fields',async()=>{
    const d=bikeData('denied'),id=fleetBikeId(d.internalNumber);
    await expect(save('bike',id,d,0,accountant)).rejects.toMatchObject({code:'permission-denied'});
    await expect(save('bike',id,{...d,assetId:'not-allowed'})).rejects.toMatchObject({code:'invalid-argument'});
    await expect(save('bike',id,{...d,status:'maintenance',statusSince:''})).rejects.toMatchObject({code:'invalid-argument'});
  });
  it('creates actual metadata once; duplicate numbers/plates, changed bodies and stale edits cannot overwrite it',async()=>{
    const first=await addBike('A');expect(first.record.revision).toBe(1);
    const replay=await save('bike',first.id,bikeData('A'));expect(replay.unchanged).toBe(true);
    const duplicate=bikeData('different');duplicate.plate='T E S T - A';
    await expect(save('bike',fleetBikeId(duplicate.internalNumber),duplicate)).rejects.toMatchObject({code:'already-exists'});
    await expect(save('bike',first.id,{...bikeData('A'),model:'Different'})).rejects.toMatchObject({code:'aborted'});
    const edited=await save('bike',first.id,{...bikeData('A'),model:'Updated source'},1);expect(edited.record.history).toHaveLength(2);
    await expect(save('bike',first.id,bikeData('A'),1)).rejects.toMatchObject({code:'aborted'});
    await addBike('B');await addBike('C');
  });
  it('serializes simultaneous allocation of two bikes to one biker, preserves handover history, and rejects temporal overlaps',async()=>{
    const bikeA=fleetBikeId(bikeData('A').internalNumber),bikeB=fleetBikeId(bikeData('B').internalNumber),bikerId=prefix+'-biker-1';
    const requests=[bikeA,bikeB].map((bikeId,i)=>({id:`${prefix}-handover-${i}`,data:{bikeId,bikerId,receivedOn:'2098-10-01',note:'Actual synthetic handover'}}));
    const results=await Promise.allSettled(requests.map(r=>save('receive',r.id,r.data)));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const winner=requests[results.findIndex(r=>r.status==='fulfilled')];
    await save('return',winner.id,{returnedOn:'2098-10-20',note:'Returned'},1);
    const otherBike=winner.data.bikeId===bikeA?bikeB:bikeA;
    await expect(save('receive',prefix+'-overlap',{bikeId:otherBike,bikerId,receivedOn:'2098-10-19',note:''})).rejects.toMatchObject({code:'invalid-argument'});
    await save('receive',prefix+'-next',{bikeId:otherBike,bikerId,receivedOn:'2098-10-20',note:''});
    const original=(await db.collection('fleet_assignments').doc(winner.id).get()).data();expect(original).toMatchObject({receivedOn:'2098-10-01',returnedOn:'2098-10-20',bikerName:'Synthetic 1'});expect(original.history).toHaveLength(2);
  });
  it('serializes two bikers competing for one bike',async()=>{
    const bikeId=fleetBikeId(bikeData('C').internalNumber);
    const results=await Promise.allSettled([2,3].map(n=>save('receive',prefix+'-compete-'+n,{bikeId,bikerId:prefix+'-biker-'+n,receivedOn:'2098-10-21',note:''})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  });
  it('stores insurance, expenses links and incident claims without touching the source ledger or assets',async()=>{
    const bikeId=fleetBikeId(bikeData('C').internalNumber);
    await save('policy',prefix+'-policy',{number:'SYNTHETIC-POLICY',company:'Synthetic insurer',startsOn:'2098-01-01',expiresOn:'2098-11-05',wholeFleet:true});
    const maintenance={bikeId,startedOn:'2098-10-15',endedOn:'',description:'Synthetic repair',cost:100,expenseUrl:'https://app.hadialghanim.com/?page=finance_workbench'};
    await save('maintenance',prefix+'-repair',maintenance);
    await expect(save('maintenance',prefix+'-second-repair',maintenance)).rejects.toMatchObject({code:'invalid-argument'});
    await expect(save('maintenance',prefix+'-bad-link',{...maintenance,expenseUrl:'javascript:alert(1)'})).rejects.toMatchObject({code:'invalid-argument'});
    await save('maintenance',prefix+'-repair',{...maintenance,endedOn:'2098-10-26'},1);
    const incident={bikeId,bikerId:prefix+'-biker-2',happenedOn:'2098-10-22',bookingId:'TEST-BOOKING',description:'Synthetic incident',cost:null,claimStatus:'submitted',claimNote:'Awaiting response'};
    await save('incident',prefix+'-incident',incident);const updated=await save('incident',prefix+'-incident',{...incident,claimStatus:'accepted'},1);expect(updated.record.history).toHaveLength(2);
    expect((await db.collection('startup_costs').doc(prefix+'-startup').get()).data()).toEqual(sourceBefore);
    expect((await db.collection('bikers').doc(prefix+'-biker-2').get()).data().salary).toBe(900);
    expect((await pool.query('select (select count(*) from public.journal_entries) as journals,(select count(*) from public.fixed_assets) as assets,(select count(*) from public.washes) as washes')).rows).toEqual(financialBefore);
  });
  it('RLS reads only for admin/accountant; no client DML, no anonymous read, no access to the control row',async()=>{
    const client=await pool.connect();try{
      await client.query('begin');await client.query('set local role authenticated');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[operator]);
      expect((await client.query('select id from public.fleet_bikes where id=any($1::text[])',[ids])).rows).toHaveLength(0);
      await client.query("select set_config('request.jwt.claim.sub',$1,true)",[accountant]);expect((await client.query('select id from public.fleet_bikes where id=any($1::text[])',[ids])).rows).toHaveLength(3);
      const grants=(await client.query("select has_table_privilege('authenticated','public.fleet_bikes','INSERT') as ins,has_table_privilege('authenticated','public.fleet_bikes','UPDATE') as upd,has_table_privilege('anon','public.fleet_bikes','SELECT') as anon,has_table_privilege('authenticated','public.fleet_control','SELECT') as control")).rows[0];
      expect(grants).toEqual({ins:false,upd:false,anon:false,control:false});
      await expect(client.query("update public.fleet_bikes set status='missing' where id=$1",[ids[0]])).rejects.toMatchObject({code:'42501'});
    }finally{await client.query('rollback');client.release();}
  });
});
