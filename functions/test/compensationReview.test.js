import { beforeEach, describe, expect, it } from 'vitest';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { compensationReview } from '../src/compensationReview.js';
import { reviewSource, reviewSeed, owner, sourceActor, testNow } from './compensationReviewFixture.js';
import { isTicketReview, isInternalQualityObjection } from '../../src/lib/compensationReview.js';
import { summarizeBikerDeductions } from '../../src/lib/sweater/bikerDeductionFollowup.js';
import { encodeDocument, decodeDocument } from '../../src/lib/data/schema/codec.js';
import { tableFor } from '../../src/lib/data/schema/registry.js';
let db, seq;
const call = (input, auth=sourceActor, now=testNow) => compensationReview(db,input,auth,now);
const read = () => call({op:'read'});
const source = async (s=reviewSource(), expectedRevision=0, requestId='source-'+(++seq)) => call({op:'source',data:{source:s,expectedRevision,requestId}});
const decide = async (action,text='',row=null,extra={}) => {
  const all=await read(), current=row || all.cases.find(r=>r.ticketId===all.queue.activeTicketId);
  return call({op:'owner',data:{ticketId:current.ticketId,expectedRevision:current.revision,expectedQueueRevision:all.queue.revision,
    requestId:'decision-'+(++seq),action,text,confirmed:true,...extra}},owner);
};
beforeEach(()=>{db=memoryFinanceDb(reviewSeed());seq=100;});
describe('administrative ticket review with owner-only exact-text decisions',()=>{
  it('uses the October ticket date rather than a September service date for exclusions',async()=>{
    const s=reviewSource();s.queueDisposition='historical_excluded';s.historicalReference='Synthetic owner October decision';s.facts.serviceDate='2026-09-30';
    const saved=await source(s);expect(saved.record.reviewStatus).toBe('historical_excluded');expect(saved.queue.activeTicketId).toBeNull();
  });
  it('preserves signed SAR values while refusing negative counts/minutes',async()=>{
    const s=reviewSource();s.amounts[0].value=-25;const saved=await source(s);expect(saved.record.source.amounts[0].value).toBe(-25);
    s.amounts[2].value=-1;await expect(source(s,1)).rejects.toMatchObject({code:'invalid-argument'});
  });
  it('requires a separate owner reopen decision; viewing/selecting the archive grants no submission',async()=>{
    const s=reviewSource('TEST-900001',{queueDisposition:'historical_excluded',historicalReference:'Synthetic October leave'});
    const saved=await source(s);await expect(decide('select','',saved.record)).rejects.toThrow(/إعادة مراجعة/);
    const reopened=await decide('reopen','Explicit synthetic owner instruction',saved.record);
    expect(reopened.record.decisions.map(d=>d.action)).toEqual(['reopen']);expect(reopened.record.submission.status).toBe('draft');
    expect(reopened.record.source.historicalReference).toBe(s.historicalReference);expect(reopened.record.ownerReopenedAt).toBeTruthy();
  });
  it('updates scan time without duplicating source or OBJ content',async()=>{
    const s=reviewSource();s.objections=[{id:'OBJ-TEST',ticketId:s.ticketId,status:'Open',reply:'Same reply',checkedAt:s.source.readAt,url:s.source.url}];
    await source(s);const newer=structuredClone(s);newer.source.readAt='2026-11-01T14:30:00+03:00';newer.objections[0].checkedAt=newer.source.readAt;
    const saved=await source(newer,1);
    expect(saved.record.source.source.readAt).toBe(newer.source.readAt);
    expect(saved.record.sourceHistory).toHaveLength(0);expect(saved.record.objectionObservations).toHaveLength(1);
    expect(saved.record.sourceChecks).toHaveLength(2);expect(saved.record.sourceChecks[1].materiallyChanged).toBe(false);
  });
  it('resolves an unverified historical decision without creating a duplicate or owner decision',async()=>{
    await source(reviewSource('TEST-900001',{queueDisposition:'prior_decision_unverified',historicalReference:'Synthetic unresolved search'}));
    expect((await read()).queue.activeTicketId).toBeNull();
    const saved=await source(reviewSource(),1);expect(saved.record.reviewStatus).toBe('pending');
    expect(saved.record.decisions).toEqual([]);expect(saved.queue.activeTicketId).toBe('TEST-900001');
  });
  it('archives the active case on an October exclusion without automatically advancing another case',async()=>{
    await source();await source(reviewSource('TEST-900002'));
    const saved=await source(reviewSource('TEST-900001',{queueDisposition:'historical_excluded',historicalReference:'Synthetic verified October leave'}),1);
    expect(saved.queue.activeTicketId).toBeNull();expect(saved.record.reviewStatus).toBe('historical_excluded');
    await source(reviewSource('TEST-900003'));expect((await read()).queue.activeTicketId).toBeNull();
  });
  it('does not activate a ticket with an existing objection',async()=>{
    const s=reviewSource();s.objections=[{id:'OBJ-TEST',ticketId:s.ticketId,status:'Rejected',reply:'Synthetic',checkedAt:s.source.readAt,url:s.source.url}];
    const saved=await source(s);expect(saved.queue.activeTicketId).toBeNull();expect(saved.record.reviewStatus).toBe('previously_objected');
  });
  it('reads without writing and refuses every non-admin role',async()=>{
    const before=structuredClone([...db.rows]);expect((await read()).cases).toEqual([]);expect([...db.rows]).toEqual(before);
    for(const uid of ['partner','operator','accountant']) await expect(call({op:'read'},{uid})).rejects.toMatchObject({code:'permission-denied'});
  });
  it('creates one active ticket and saves/reads one natural record across month boundaries',async()=>{
    const first=await source();await source(reviewSource('TEST-900002'));
    const s=reviewSource();s.source.readAt='2026-11-02T10:00:00+03:00';s.facts.serviceDate='2026-11-01';
    const result=await call({op:'source',data:{source:s,expectedRevision:1,requestId:'next-month'}},sourceActor,new Date('2026-11-02T11:00:00+03:00'));
    const all=await read();expect(all.cases).toHaveLength(2);expect(all.queue.activeTicketId).toBe(first.record.ticketId);
    expect(result.record.id).toBe(first.record.id);expect(result.record.periodKey).toBe('2026-10');
  });
  it('preserves source values and missing money, and round-trips extra using the production codec',async()=>{
    const saved=await source(),table=tableFor('quality_objections').table,encoded=encodeDocument(table,saved.record.id,saved.record);
    expect(decodeDocument(table,encoded.row,encoded.lines,{})).toEqual(saved.record);
    expect(saved.record.source.amounts[1].value).toBeNull();expect(isTicketReview(saved.record)).toBe(true);
    expect(isInternalQualityObjection(saved.record)).toBe(false);
    expect(summarizeBikerDeductions([saved.record]).eventCount).toBe(0);
  });
  it('replays an identical request once and refuses changed content with the same key',async()=>{
    await source(reviewSource(),0,'same-source-key');
    expect(await source(reviewSource(),0,'same-source-key')).toMatchObject({replay:true,saved:false});
    await expect(source(reviewSource('TEST-900001',{facts:{...reviewSource().facts,complaint:'changed'}}),1,'same-source-key'))
      .rejects.toMatchObject({code:'already-exists'});
    expect((await read()).cases).toHaveLength(1);
  });
  it('serializes two conflicting edits and preserves the winning revision',async()=>{
    await source();const s=reviewSource();s.facts.complaint='First change';
    const t=reviewSource();t.facts.complaint='Second change';
    const result=await Promise.allSettled([source(s,1,'conflict-one'),source(t,1,'conflict-two')]);
    expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(result.filter(r=>r.status==='rejected')[0].reason.code).toBe('aborted');
  });
  it('rejects decision or sent-status injection from the source package',async()=>{
    for(const extra of [{submission:{status:'sent'}},{decisions:[{action:'request_submission'}]},{reviewStatus:'left'},{recordType:'biker_deduction'}])
      await expect(source({...reviewSource(),...extra})).rejects.toMatchObject({code:'invalid-argument'});
    expect((await read()).cases).toHaveLength(0);
  });
  it('requires the actual owner UID and verified token identity beyond an admin flag',async()=>{
    await source();const all=await read(),input={op:'owner',data:{ticketId:'TEST-900001',expectedRevision:1,expectedQueueRevision:all.queue.revision,
      requestId:'forged-owner',action:'leave',text:'',confirmed:true}};
    await expect(call(input,sourceActor)).rejects.toMatchObject({code:'permission-denied'});
    await expect(call(input,{uid:owner.uid,token:{email:'someone@example.test'}})).rejects.toMatchObject({code:'permission-denied'});
    expect((await read()).cases[0].decisions).toEqual([]);
  });
  it('cannot turn a draft, next, source refresh or elapsed time into a submission',async()=>{
    await source();await source(reviewSource('TEST-900002'));await decide('next');
    const all=await read();expect(all.queue.activeTicketId).toBe('TEST-900002');
    const deferred=all.cases.find(r=>r.ticketId==='TEST-900001');
    expect(deferred.reviewStatus).toBe('deferred');expect(deferred.submission.status).toBe('draft');
    expect(deferred.decisions.map(r=>r.action)).toEqual(['next']);
  });
  it('archives documented October exclusions and will not requeue them through a source refresh',async()=>{
    const s=reviewSource('TEST-900001',{queueDisposition:'historical_excluded',historicalReference:'Synthetic owner decision reference'});
    await source(s);expect((await read()).queue.activeTicketId).toBeNull();
    await source(reviewSource('TEST-900002'));expect((await read()).queue.activeTicketId).toBe('TEST-900002');
    await expect(source(reviewSource(),1)).rejects.toThrow(/أكتوبر/);
    expect((await read()).cases.find(r=>r.ticketId===s.ticketId).reviewStatus).toBe('historical_excluded');
  });
  it('preserves owner leave decision and draft on source refresh',async()=>{
    await source();await decide('draft','نص هادي');await decide('leave','كلامهم صحيح');
    const row=(await read()).cases[0],s=reviewSource();s.analysis.proposedDraft='Agent replacement';s.facts.complaint='New source details';
    const result=await source(s,row.revision);expect(result.record.draft.text).toBe('نص هادي');
    expect(result.record.reviewStatus).toBe('left');expect(result.record.decisions).toEqual(row.decisions);
  });
  it('binds queued request to exact ticket/text/revision and invalidates it on a draft change',async()=>{
    await source();await expect(decide('request_submission','نص آخر')).rejects.toThrow(/النص/);
    const queued=await decide('request_submission',reviewSource().analysis.proposedDraft);
    expect(queued.record.submission.status).toBe('queued');
    expect(queued.record.submission.text).toBe(queued.record.draft.text);
    await expect(decide('request_submission',queued.record.draft.text)).rejects.toThrow(/طلب قائم/);
    const changed=await decide('draft','نص جديد');expect(changed.record.submission.status).toBe('draft');
    expect(changed.record.submission.invalidatedRequestId).toBe(queued.record.submission.requestId);
  });
  it('refuses submission without an owner request or with any prior OBJ',async()=>{
    await source();
    await expect(call({op:'execution',data:{ticketId:'TEST-900001',expectedRevision:1,requestId:'fake-receipt',submissionRequestId:'no-owner-request',action:'receipt',objectionId:'OBJ-TEST'}})).rejects.toThrow(/طلب هادي/);
    const s=reviewSource();s.objections=[{id:'OBJ-TEST',ticketId:s.ticketId,status:'Accepted',reply:'Synthetic',checkedAt:'2026-11-01T14:00:00+03:00',url:s.source.url}];
    await source(s,1);const row=(await read()).cases[0];await decide('reopen','Synthetic explicit review',row);await expect(decide('request_submission',s.analysis.proposedDraft)).rejects.toThrow(/اعتراض/);
  });
  it('requires a matching OBJ read after the explicit request; acceptance never writes finance',async()=>{
    const protectedBefore=[...db.rows].filter(([k])=>!k.startsWith('quality_objections/')&&!k.startsWith('audit_logs/'));
    await source();const queued=await decide('request_submission',reviewSource().analysis.proposedDraft);
    const requestId=queued.record.submission.requestId;
    const exec=(action,rev,objectionId=null)=>call({op:'execution',data:{ticketId:'TEST-900001',expectedRevision:rev,requestId:'execution-'+(++seq),submissionRequestId:requestId,action,objectionId}});
    await expect(exec('receipt',queued.record.revision,'OBJ-TEST')).rejects.toThrow(/OBJ/);
    const observed=await exec('observed',queued.record.revision);
    expect(observed.record.submission.status).toBe('in_progress_uncertain');
    await expect(decide('draft','Changed while in flight')).rejects.toThrow(/غير محسوم/);
    const s=reviewSource();s.source.readAt='2026-11-01T15:01:00+03:00';s.objections=[{id:'OBJ-TEST',ticketId:s.ticketId,status:'Accepted',reply:'Synthetic accepted response, not a refund',checkedAt:s.source.readAt,url:s.source.url}];
    const update=await source(s,observed.record.revision);
    const sent=await exec('receipt',update.record.revision,'OBJ-TEST');expect(sent.record.submission.status).toBe('sent');
    expect(isInternalQualityObjection(sent.record)).toBe(false);
    expect([...db.rows].filter(([k])=>!k.startsWith('quality_objections/')&&!k.startsWith('audit_logs/'))).toEqual(protectedBefore);
  });
  it('retains OBJ histories when later coverage is incomplete and rejects forged ticket binding',async()=>{
    const s=reviewSource();s.objections=[{id:'OBJ-TEST',ticketId:s.ticketId,status:'Open',reply:'Synthetic',checkedAt:s.source.readAt,url:s.source.url}];
    await source(s);const newer=reviewSource();newer.source.coverage.complete=false;
    const saved=await source(newer,1);expect(saved.record.objectionHistory).toHaveLength(1);
    expect(saved.record.objectionObservations).toHaveLength(1);
    await expect(source({...s,ticketId:'TEST-900002'})).rejects.toThrow(/مطابق/);
  });
  it('enforces current revision and queue revision, including wrong active ticket',async()=>{
    await source();const second=await source(reviewSource('TEST-900002'));
    await expect(decide('leave','',second.record)).rejects.toThrow(/النشطة/);
    await expect(decide('leave','',null,{expectedRevision:0})).rejects.toMatchObject({code:'aborted'});
    await expect(decide('leave','',null,{expectedQueueRevision:0})).rejects.toMatchObject({code:'aborted'});
  });
  it('never leaks source/owner text into the shared audit',async()=>{
    await source();await decide('information','Private synthetic owner note');
    const audits=[...db.rows].filter(([k])=>k.startsWith('audit_logs/'));
    expect(JSON.stringify(audits)).not.toContain('Private synthetic');expect(JSON.stringify(audits)).not.toContain('complaint');
  });
  it('refuses stale source reads, unsafe URLs and advancing incomplete coverage',async()=>{
    await source();const s=reviewSource();s.source.readAt='2026-10-31T14:00:00+03:00';
    await expect(source(s,1)).rejects.toThrow();
    const t=reviewSource();t.source.url='https://host.example/?token=secret';
    await expect(source(t,1)).rejects.toMatchObject({code:'invalid-argument'});
    const u=reviewSource();u.source.coverage.complete=false;u.source.coverage.lastCompleteThrough='2026-11-01T14:01:00+03:00';
    await expect(source(u,1)).rejects.toThrow(/تغطية/);
  });
});




