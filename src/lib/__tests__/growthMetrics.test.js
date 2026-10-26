import { describe,it,expect } from 'vitest';
import {growthMetrics,growthAvailableDays,growthDifference,growthDay} from '../growthMetrics.js';
import {availableWorkDays} from '../availableWorkDays.js';
const worker=(id,counts,start='2026-10-01')=>({id,name:id,region:'A',startDate:start,availability:[{periodKey:'2026-10',startDate:start,endDate:'2026-10-31',daysEntitled:32-Number(start.slice(8))}],days:counts.map((count,i)=>({date:`2026-10-${10+i}`,count,recordedCount:count}))});
const period={from:'2026-10-10',to:'2026-10-17',measurementDay:'2026-10-17'};
describe('current growth uses shared available-day definitions',()=>{
 it('matches availableWorkDays, includes zeros and excludes the measurement day from the prior seven days',()=>{
  const w=worker('a',[5,4,5,4,0,7,4,7]),r=growthMetrics({...period,workers:[w]});
  const expected=availableWorkDays({periodKey:'2026-10',startDate:'2026-10-10',endDate:'2026-10-17'}).workDays;
  expect(r.total).toBe(36);expect(r.workDays).toBeCloseTo(expected);expect(r.actualDaily).toBeCloseTo(36/expected);
  expect(r.currentRate).toBeCloseTo(7/(29/31));expect(r.previousRate).toBeCloseTo(4/(29/31));expect(r.baselineRate).toBeCloseTo(29/(7*29/31));
  expect(r.daily.percent).toBeCloseTo(75);expect(r.sampleFrom).toBe('2026-10-10');
 });
 it('sorts by washes per available day rather than totals or days with washes',()=>{
  const a=worker('a',Array(8).fill(2)),b=worker('b',[0,0,0,0,0,0,3,3],'2026-10-16');
  const r=growthMetrics({...period,workers:[a,b]});expect(r.rows.map(w=>w.id)).toEqual(['b','a']);expect(r.total).toBe(22);expect(r.rows[0].actualDaily).toBeCloseTo(3/(29/31));
 });
 it('pools numerators and available days, not individual averages',()=>{
  const a=worker('a',Array(8).fill(2)),b=worker('b',[0,0,0,0,0,0,3,3],'2026-10-16');
  const r=growthMetrics({...period,workers:[a,b]});expect(r.actualDaily).toBeCloseTo(22/(10*29/31));expect(r.actualDaily).not.toBe((r.rows[0].actualDaily+r.rows[1].actualDaily)/2);
 });
 it('does not omit ended or unlinked workers with registered washes; missing availability stays unknown',()=>{
  const a=worker('a',Array(8).fill(1)),u={id:'unlinked',name:'unknown',region:'غير محددة',days:a.days};
  const r=growthMetrics({...period,workers:[a,u]});expect(r.total).toBe(16);expect(r.actualDaily).toBeNull();expect(r.unavailableAvailability).toBe(1);expect(r.timeline[0].count).toBe(2);
 });
 it('uses same worker/zone filter for cards, trend and table',()=>{
  const a=worker('a',Array(8).fill(2)),b={...worker('b',Array(8).fill(5)),region:'B'};
  const r=growthMetrics({...period,workers:[a,b],workerId:'b'});expect(r.total).toBe(40);expect(r.rows).toHaveLength(1);expect(r.timeline.every(d=>d.count===5)).toBe(true);
  expect(growthMetrics({...period,workers:[a,b],region:'A'}).total).toBe(16);
 });
 it('retains lookback when the visible period starts on the measurement day',()=>{
  const r=growthMetrics({...period,from:period.to,workers:[worker('a',[5,4,5,4,6,7,4,7])]});expect(r.total).toBe(7);expect(r.previous).toBe(4);expect(r.baselineRate).toBeCloseTo(5/(29/31));
 });
 it('handles prorated days off across month boundaries and zero eligibility before joining',()=>{
  const w=worker('a',[]);w.startDate='2026-09-01';w.availability.unshift({periodKey:'2026-09',startDate:'2026-09-01',endDate:'2026-09-30',daysEntitled:30});
  expect(growthAvailableDays(w,'2026-09-30','2026-10-01')).toBeCloseTo(28/30+29/31);
  expect(growthAvailableDays(worker('new',[],'2026-10-01'),'2026-09-24','2026-09-30')).toBe(0);
 });
 it('never invents a rate on unknown days or divides by zero',()=>{
  const w=worker('a',Array(8).fill(0));w.availability[0].daysEntitled=10;
  expect(growthMetrics({...period,workers:[w]}).actualDaily).toBeNull();expect(growthDifference(7,0).percent).toBeNull();expect(growthDifference(null,5).delta).toBeNull();
 });
 it('validates real dates and bounded periods',()=>{expect(growthDay('2026-02-30')).toBeNull();expect(()=>growthMetrics({...period,to:'2026-10-09'})).toThrow();});
 it('keeps out-of-eligibility washes in the register total while refusing a misleading workday rate',()=>{
  const w=worker('a',Array(8).fill(1),'2026-10-16'),r=growthMetrics({...period,workers:[w]});expect(r.total).toBe(8);expect(r.actualDaily).toBeNull();expect(r.rows[0].actualDaily).toBeNull();expect(r.timeline[0].rate).toBeNull();
 });
});
