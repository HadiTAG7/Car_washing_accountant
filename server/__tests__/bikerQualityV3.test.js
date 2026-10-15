import { expect, it } from 'vitest';
import { normalizeQualityReport } from '../bikerQualityReports.js';
import { finalizeQualityV3 } from '../bikerQualityV3.js';

const proof = () => ({ reference: 'Isolated reviewed source', hash: 'c'.repeat(64), readDate: '2026-10-15' });
export const v3Input = () => ({ bikerUID: 'test-worker', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14',
  rulesVersion: 'cqo-20261015-v3', sourceReadDate: '2026-10-15', snapshotAt: '2026-10-15T09:00:00Z',
  sourceIdentity: { externalId: '1984', sspId: '1320' }, samples: [], improvement: 'Quality evidence only, no penalty or employment decision.', evidence: {} });
const rate = (n, affected) => ({ eligible: Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, serviceDate: '2026-10-10' })),
  attributedIds: Array.from({ length: affected }, (_, i) => `item-${i}`), source: proof() });
it.each([['complaints',100,0,10],['complaints',100,1,10],['complaints',100,3,5],['complaints',100,5,0],
  ['cancellations',100,1,5],['cancellations',100,3,2.5],['cancellations',100,5,0],
  ['lateness',100,0,5],['lateness',100,5,2.5],['lateness',100,10,0]])('applies only the approved %s curve at n=%s affected=%s', (key,n,affected,points) => {
  const input = v3Input(); input.evidence[key] = rate(n, affected);
  const c = normalizeQualityReport(input).components.find(c => c.key === key);
  expect(c).toMatchObject({ points, n, affected });
});
it('keeps zero denominators unavailable and rejects attributed cases outside the eligible set', () => {
  const input = v3Input(); input.evidence.complaints = rate(0,0);
  expect(normalizeQualityReport(input).components.find(c=>c.key==='complaints').points).toBeNull();
  input.evidence.complaints.attributedIds = ['other']; expect(()=>normalizeQualityReport(input)).toThrow();
});
it('uses wash dates rather than attendance, and keeps the empty-date denominator unavailable', () => {
  const input=v3Input(); input.evidence.productivity={completed:[{washId:'one',serviceDate:'2026-10-10'},{washId:'two',serviceDate:'2026-10-10'}],source:proof()};
  expect(normalizeQualityReport(input).components.find(c=>c.key==='productivity')).toMatchObject({points:2.5,n:1,completed:2});
  input.evidence.productivity.completed=[];
  expect(normalizeQualityReport(input).components.find(c=>c.key==='productivity').points).toBeNull();
});
it('measures readable SSP timestamp completeness, not forgetting; unreadable sources are independent gaps', () => {
  const input=v3Input(); input.evidence.updates={reviews:Array.from({length:21},(_,i)=>i===20
    ? {washId:`wash-${i}`,serviceDate:'2026-10-10',appointmentId:`appt-${i}`,readStatus:'unreadable',reason:'Source detail unavailable',source:proof()}
    : {washId:`wash-${i}`,serviceDate:'2026-10-10',appointmentId:`appt-${i}`,readStatus:'read',arrival:'2026-10-10T09:50:00+03:00',
      start:i===0?null:'2026-10-10T10:00:00+03:00',end:i===0?null:'2026-10-10T10:50:00+03:00',source:proof()})};
  const c=normalizeQualityReport(input).components.find(c=>c.key==='statusUpdates');
  expect(c).toMatchObject({points:5,n:20,affected:1,unreadable:1,reason:'timestamp-completeness'});
  input.evidence.updates.reviews=input.evidence.updates.reviews.slice(-1);
  expect(normalizeQualityReport(input).components.find(c=>c.key==='statusUpdates')).toMatchObject({points:null,n:0,unreadable:1});
});
it('never accepts old forgetting/working-day inputs under the new policy version', () => {
  const input=v3Input();
  expect(()=>normalizeQualityReport({...input,evidence:{productivity:{workDays:['2026-10-10'],completed:[],source:proof()}}})).toThrow();
  expect(()=>normalizeQualityReport({...input,evidence:{updates:{reviews:[{washId:'one',serviceDate:'2026-10-10',appointmentId:'appt',forgotten:['start'],evidenceType:'explicit-status-review',source:proof()}]}}})).toThrow();
});
const completeInput = () => {
  const input={...v3Input(),from:'2026-10-10',to:'2026-10-10'};
  input.samples=Array.from({length:8},(_,i)=>({washId:`wash-${i}`,serviceDate:'2026-10-10',start:`2026-10-10T${String(6+i).padStart(2,'0')}:00:00+03:00`,
    end:`2026-10-10T${String(6+i).padStart(2,'0')}:50:00+03:00`,sourceHash:'a'.repeat(64)}));
  input.evidence={ratingsCoverage:'complete-period',ratings:[{from:input.from,to:input.to,wash:{mean:5,n:8},behavior:{mean:5,n:8},source:proof()}],
    productivity:{completed:input.samples.map(s=>({washId:s.washId,serviceDate:s.serviceDate})),source:proof(),coverage:'complete-period'},
    updates:{coverage:'complete-period',reviews:input.samples.map((s,i)=>({washId:s.washId,serviceDate:s.serviceDate,appointmentId:`appt-${i}`,readStatus:'read',arrival:s.start,start:s.start,end:s.end,source:proof()}))}};
  for(const key of ['complaints','cancellations','lateness']) input.evidence[key]={eligible:input.samples.map(s=>({id:s.washId,serviceDate:s.serviceDate})),attributedIds:[],source:proof(),coverage:'complete-period'};
  return input;
};
const canonical = input=>({available:true,eligible:input.samples.map((s,i)=>({washId:s.washId,serviceDate:s.serviceDate,sspBookingId:`appt-${i}`})),excluded:[]});
it('requires all eight period coverages, including every duration, before calculating final/100', () => {
  const input=completeInput(), source=canonical(input);
  const complete=finalizeQualityV3(normalizeQualityReport(input),source);
  expect(complete).toMatchObject({finalScore:100,status:'complete',availableWeight:100,coverage:{canonicalCompleted:8,durationMeasured:8,durationMissing:0}});
  input.samples=input.samples.slice(0,7);
  const partial=finalizeQualityV3(normalizeQualityReport(input),source);
  expect(partial.finalScore).toBeNull(); expect(partial.coverage.durationMissing).toBe(1);
});
it('does not let sample ratings or unresolved source gaps become a final result', () => {
  const input=completeInput(); input.evidence.ratingsCoverage='sample';
  expect(finalizeQualityV3(normalizeQualityReport(input),canonical(input)).finalScore).toBeNull();
  input.evidence.ratingsCoverage='complete-period';input.evidence.gaps=[{washId:'wash-0',serviceDate:'2026-10-10',kind:'completion-conflict',reason:'Verified conflict remains open',source:proof()}];
  expect(finalizeQualityV3(normalizeQualityReport(input),canonical(input)).finalScore).toBeNull();
});
it('does not turn a source failure into verified zero washes or productivity', () => {
  const result=finalizeQualityV3(normalizeQualityReport(v3Input()),{available:false,reason:'requires-pagination'});
  expect(result.coverage.canonicalCompleted).toBeNull(); expect(result.finalScore).toBeNull();
  expect(result.components.find(c=>c.key==='productivity').points).toBeNull();
});
it('rejects a claimed productivity list that omits a canonical completed wash', () => {
  const input=completeInput();input.evidence.productivity={completed:[],source:proof(),coverage:'complete-period'};
  expect(()=>finalizeQualityV3(normalizeQualityReport(input),canonical(input))).toThrow(/الإنتاجية/);
});
it('rejects contradictory repeated appointment readings and never counts two missing stamps twice', () => {
  const input=completeInput();const rows=input.evidence.updates.reviews;
  rows[0].arrival=null; rows[0].start=null;rows[1].appointmentId=rows[0].appointmentId;
  expect(()=>normalizeQualityReport(input)).toThrow(/متعارضة/);
  rows[1].arrival=null;rows[1].start=null;rows[1].end=rows[0].end;
  expect(normalizeQualityReport(input).components.find(c=>c.key==='statusUpdates')).toMatchObject({affected:1,n:8,points:0});
});
