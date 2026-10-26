import {describe,it,expect,vi} from 'vitest';
import {projectGrowth,readGrowthPerformance,validateGrowthRequest} from '../growthPerformance.js';
import {createGrowthHandler} from '../../api/growth-performance.js';
import {mapWash} from '../../src/lib/mappers.js';
import {washDailySummary} from '../../src/lib/washDailySummary.js';
import {growthMetrics} from '../../src/lib/growthMetrics.js';
const worker={id:'a',driver_external_id:'1984',name:'Worker',name_ar:'عامل',start_date:'2026-10-01',current_status:'يشتغل',contact_number:'PRIVATE',salary:900};
const roster={at:'2026-10-18T18:12:10Z',rows:[{code:'1984',region:'Muroj',status:'Active'}]};
const pay=id=>({bikerId:id,eligibleStart:'2026-10-01',eligibleEnd:'2026-10-31',daysEntitled:31,basicDue:900});
const wash=(id,biker='a',quantity=1)=>({id,ssp_booking_id:id,biker_id:biker,wash_date:'2026-10-17',status:'completed',quantity});
const project=extra=>projectGrowth({workers:[worker],washes:[wash('S-1')],payroll:[{periodKey:'2026-10',lines:[pay('a')]}],from:'2026-10-17',to:'2026-10-17',lookback:'2026-10-10',roster,...extra});
describe('growth current register projection',()=>{
 it('uses current active payroll or a wash, not the snapshot population; strips private data',()=>{
  const workers=[worker,{...worker,id:'new',driver_external_id:'2007'}, {...worker,id:'left',driver_external_id:'2008',current_status:'هرب'}, {...worker,id:'ended',driver_external_id:'2009',end_date:'2026-10-16'}];
  const r=project({workers,payroll:[{periodKey:'2026-10',lines:workers.map(w=>pay(w.id))}],washes:[wash('S-1'),wash('S-2','left'),wash('S-3','ended')]});
  expect(r.workers.map(w=>w.id).sort()).toEqual(['a','ended','left','new']);expect(r.workers.find(w=>w.id==='new').region).toBe('غير محددة');expect(r.registerTotal).toBe(3);expect(JSON.stringify(r)).not.toMatch(/PRIVATE|basicDue|salary|contact_number/);
 });
 it('exactly matches WashesPage including corporate, manual quantity, administrative completion and orphan records',()=>{
  const washes=[wash('corporate'),wash('C-5584720'),{...wash('batch','a',4),ssp_booking_id:null},wash('orphan',null),wash('deleted','missing'),{...wash('pending'),status:'قيد التنفيذ'}];
  const before=JSON.stringify(washes),r=project({washes});
  expect(r.registerTotal).toBe(washDailySummary(washes.map(mapWash)).completed);expect(r.registerTotal).toBe(8);
  expect(growthMetrics({workers:r.workers,from:r.from,to:r.to,measurementDay:r.to}).total).toBe(8);expect(JSON.stringify(washes)).toBe(before);
  expect(r.workers.filter(w=>!w.linked)).toHaveLength(2);
 });
 it('preserves zero-active workers and uses the snapshot for zones only, including ambiguous external IDs',()=>{
  const r=project({workers:[worker,{...worker,id:'b'}],payroll:[{periodKey:'2026-10',lines:[pay('a'),pay('b')]}],washes:[]});
  expect(r.workers).toHaveLength(2);expect(r.workers.every(w=>w.region==='غير محددة')).toBe(true);expect(r.registerTotal).toBe(0);
 });
 it('refuses missing or duplicated payroll eligibility instead of silently dropping inactive rows',()=>{
  expect(()=>project({payroll:[{periodKey:'2026-10',error:{message:'unavailable'}}]})).toThrow();
  expect(()=>project({payroll:[{periodKey:'2026-10',lines:[pay('a'),pay('a')]}]})).toThrow();
 });
 it.each(['partner','accountant','operator','supervisor',null])('authorizes %s before source reads',async role=>{
  const names=[],db={collection:name=>{names.push(name);if(!['users','app_admins'].includes(name))throw Error('source');return{doc:()=>({get:async()=>({exists:name==='users',data:()=>({role})})})};}};
  await expect(readGrowthPerformance(db,{uid:'caller'},{})).rejects.toMatchObject({code:'permission-denied'});expect(names).not.toContain('washes');
 });
 it('queries all current workers, bounds reads, and never reads source bookings or writes',async()=>{
  const names=[],limits=[],where=[],rows={bikers:[worker],washes:[wash('S-1')]};
  const db={collection:name=>{names.push(name);if(['users','app_admins'].includes(name))return{doc:()=>({get:async()=>({exists:name==='users',data:()=>({role:'admin'})})})};
   const q={select:()=>q,where:(...args)=>{where.push([name,...args]);return q;},limit:n=>{limits.push(n);return q;},get:async()=>({size:rows[name].length,docs:rows[name].map(r=>({id:r.id,data:()=>r}))})};return q;}};
  const preview=vi.fn(async()=>[{periodKey:'2026-10',lines:[pay('a')]}]);
  const r=await readGrowthPerformance(db,{uid:'admin'},{from:'2026-10-17',to:'2026-10-17'},{preview});
  expect(r.registerTotal).toBe(1);expect(names).not.toContain('sweater_bookings');expect(limits).toEqual([501,10001]);expect(where.some(([n,f])=>n==='bikers'&&f==='driver_external_id')).toBe(false);expect(preview).toHaveBeenCalledOnce();
 });
 it('rejects future, oversized, invalid periods and unknown keys',()=>{
  for(const input of [{from:'2026-10-27',to:'2026-10-27'},{from:'2026-02-30',to:'2026-10-17'},{from:'2026-01-01',to:'2026-10-17'},{from:'2026-10-17',to:'2026-10-17',role:'admin'}])expect(()=>validateGrowthRequest(input,new Date('2026-10-26T12:00:00Z'))).toThrow();
  expect(validateGrowthRequest({from:'2026-10-17',to:'2026-10-17'},new Date('2026-10-26T12:00:00Z')).lookback).toBe('2026-10-10');
 });
 it('requires a token and keeps runtime errors private',async()=>{
  const runtime=vi.fn(()=>{throw Error('secret');}),res=()=>({setHeader:vi.fn(),status:vi.fn(function(code){this.code=code;return this;}),json:vi.fn(function(body){this.body=body;return this;})});
  const a=res();await createGrowthHandler(runtime)({method:'POST',headers:{}},a);expect(a.code).toBe(401);expect(runtime).not.toHaveBeenCalled();
  const b=res();await createGrowthHandler(runtime)({method:'POST',headers:{authorization:'Bearer token'}},b);expect(b.code).toBe(503);expect(JSON.stringify(b.body)).not.toContain('secret');
 });
 it.each([8,'resource-exhausted','firestore/resource-exhausted'])('preserves safe quota diagnostics %s',async code=>{
  const log={warn:vi.fn()},runtime={auth:{verifyIdToken:async()=>({uid:'test-admin'})},db:{collection:()=>({doc:()=>({get:async()=>{throw Object.assign(Error('PRIVATE'),{code});}})})}};
  const res={setHeader:vi.fn(),status:vi.fn(function(code){this.code=code;return this;}),json:vi.fn(function(body){this.body=body;return this;})};
  await createGrowthHandler(()=>runtime,log)({method:'POST',headers:{authorization:'Bearer synthetic'},body:{from:'2026-10-01',to:'2026-10-17'}},res);expect(res.code).toBe(503);expect(JSON.stringify([res.body,log.warn.mock.calls])).not.toMatch(/PRIVATE|synthetic|test-admin/);
 });
});
