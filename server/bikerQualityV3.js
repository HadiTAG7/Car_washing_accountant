import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthError } from '../functions/src/handlers.js';
import { completedCommissionWash } from '../functions/src/washCommission.js';
import { normalizeQualityV2, qualityIdentitySchema as id, qualityDaySchema as day, qualityProofSchema as proof,
  qualityWashSchema as wash, qualityRatingSegmentSchema as rating, qualityRateSchema as rate } from './bikerQualityV2.js';

export const QUALITY_V3 = 'cqo-20261015-v3';
const round = n => Math.round(n * 100) / 100;
const bad = message => { throw new AuthError(message, { code: 'invalid-argument' }); };
const coverage = z.enum(['sample', 'complete-period']).default('sample');
const stamp = z.string().datetime({ offset: true }).nullable();
const reviewBase = wash.extend({ appointmentId: id, source: proof });
const review = z.discriminatedUnion('readStatus', [
  reviewBase.extend({ readStatus: z.literal('read'), arrival: stamp, start: stamp, end: stamp }).strict(),
  reviewBase.extend({ readStatus: z.literal('unreadable'), reason: z.string().trim().min(1).max(500) }).strict(),
]);
const extras = z.object({ rulesVersion: z.literal(QUALITY_V3), evidence: z.object({
  ratings: z.array(rating).max(31).optional(), ratingsCoverage: coverage,
  productivity: z.object({ completed: z.array(wash).max(500), source: proof, coverage }).strict().optional(),
  updates: z.object({ reviews: z.array(review).max(500), coverage }).strict().optional(),
  complaints: rate.extend({ coverage }).strict().optional(), cancellations: rate.extend({ coverage }).strict().optional(),
  lateness: rate.extend({ coverage }).strict().optional(),
  gaps: z.array(wash.extend({ kind: z.enum(['unreadable-source', 'completion-conflict', 'missing-start-end']),
    reason: z.string().trim().min(1).max(500), source: proof }).strict()).max(500).optional(),
}).strict() }).passthrough();
const unique = a => new Set(a).size === a.length;
const sameIds = (a,b) => a.length === b.length && a.every(id => new Set(b).has(id));

export function normalizeQualityV3(input, normalizeV1) {
  const parsed = extras.safeParse(input);
  if (!parsed.success) bad('أدلة إصدار الجودة الجديد غير صالحة.');
  const { evidence, ...base } = parsed.data;
  const result = normalizeQualityV2({ ...base, rulesVersion: 'cqo-20261015-v2', evidence: { ratings: evidence.ratings } }, normalizeV1);
  result.rulesVersion = QUALITY_V3; result.evidence = evidence;
  const within = d => d >= result.from && d <= result.to;
  const checkProof = (p, dates) => {
    if (p.readDate > result.sourceReadDate || dates.some(d => !within(d) || d > p.readDate)) bad('نطاق أو تاريخ دليل الجودة لا يطابق اللقطة.');
  };
  const checkRows = rows => {
    if (!unique(rows.map(r=>r.washId)) || rows.some(r=>!within(r.serviceDate))) bad('دليل الغسلات مكرر أو خارج الفترة.');
  };
  const update = (key, data) => Object.assign(result.components.find(c=>c.key===key),data);
  update('productivity',{points:null,n:null,reason:'missing-canonical-wash-source'});
  update('statusUpdates',{points:null,n:null,reason:'missing-readable-ssp-events'});
  if (evidence.productivity) {
    const p=evidence.productivity; checkRows(p.completed); checkProof(p.source,p.completed.map(r=>r.serviceDate));
    const days=new Set(p.completed.map(r=>r.serviceDate)).size;
    update('productivity',{points:days?round(10*Math.min(1,p.completed.length/days/8)):null,n:days,completed:p.completed.length,
      reason:days?'wash-day-productivity':'no-eligible-wash-days',unit:'wash-days'});
  }
  if (evidence.updates) {
    const rows=evidence.updates.reviews; checkRows(rows);
    const appointments=new Map();
    for(const row of rows) {
      checkProof(row.source,[row.serviceDate]);
      if(row.readStatus!=='read') continue;
      const stamps=[row.arrival,row.start,row.end];
      if(stamps.some(t=>t&&Date.parse(t)>Date.parse(result.snapshotAt))
        || (row.start&&row.end&&Date.parse(row.start)>Date.parse(row.end))
        || (row.arrival&&row.start&&Date.parse(row.arrival)>Date.parse(row.start))) bad('طوابع الأحداث متعارضة أو مستقبلية.');
      const signature=JSON.stringify(stamps.map(t=>t?new Date(t).toISOString():null));
      if(appointments.has(row.appointmentId)&&appointments.get(row.appointmentId)!==signature) bad('قراءات الموعد نفسه متعارضة.');
      appointments.set(row.appointmentId,signature);
    }
    const readable=rows.filter(r=>r.readStatus==='read');
    const affected=new Set(readable.filter(r=>!r.arrival||!r.start||!r.end).map(r=>r.appointmentId)).size;
    update('statusUpdates',{points:readable.length?round(Math.max(0,10-100*affected/readable.length)):null,n:readable.length,affected,
      unreadable:rows.length-readable.length,reason:readable.length?'timestamp-completeness':'missing-readable-ssp-events',unit:'reviewed-washes'});
  }
  for(const key of ['complaints','cancellations','lateness']) {
    const facts=evidence[key];
    update(key,{points:null,n:null,reason:'missing-attributed-denominator'});
    if(!facts) continue;
    if(!result.sourceIdentity.externalId) bad('تحتاج الأدلة هوية سويتر المتحققة.');
    checkProof(facts.source,facts.eligible.map(r=>r.serviceDate));
    const ids=facts.eligible.map(r=>r.id);
    if(!unique(ids)||!unique(facts.attributedIds)||facts.attributedIds.some(id=>!ids.includes(id))) bad('مقام الحالات أو ربطها غير صالح.');
    const ratio=ids.length?facts.attributedIds.length/ids.length:null;
    const weight=result.components.find(c=>c.key===key).weight;
    const multiplier=ratio===null?null:key==='lateness'?Math.max(0,1-ratio/.10):Math.min(1,Math.max(0,(.05-ratio)/.04));
    update(key,{points:multiplier===null?null:round(weight*multiplier),n:ids.length,affected:facts.attributedIds.length,rate:ratio,
      reason:ratio===null?'missing-attributed-denominator':'approved-attributed-rate'});
  }
  for(const gap of evidence.gaps||[]) checkProof(gap.source,[gap.serviceDate]);
  if(!unique((evidence.gaps||[]).map(g=>g.washId))) bad('فجوة المصدر مكررة.');
  const known=result.components.filter(c=>c.points!==null);
  result.availablePoints=known.length?round(known.reduce((n,c)=>n+c.points,0)):null;
  result.availableWeight=known.reduce((n,c)=>n+c.weight,0);
  return result; // Final completion is verified against the canonical cohort at save time.
}

export async function readCanonicalQualitySource(db,bikerUID,periodKey,{transaction,worker}={}) {
  if(!worker) { const ref=db.collection('bikers').doc(bikerUID); const doc=await (transaction?transaction.get(ref):ref.get()); if(!doc.exists) return {available:false,reason:'worker-missing'}; worker=doc.data(); }
  const query=db.collection('washes').where('biker_id','==',bikerUID).limit(501);
  const snap=await (transaction?transaction.get(query):query.get());
  if(snap.size>=501) return {available:false,reason:'requires-pagination'};
  const eligible=[],excluded=[];
  for(const doc of snap.docs) {
    const row=doc.data(), serviceDate=String(row.wash_date||'').slice(0,10);
    if(serviceDate.slice(0,7)!==periodKey||!completedCommissionWash(row)) continue;
    const ref={washId:doc.id,serviceDate,sspBookingId:row.ssp_booking_id?String(row.ssp_booking_id):null};
    if(!day.safeParse(serviceDate).success) { excluded.push({...ref,reason:'invalid-date'}); continue; }
    if((worker.start_date&&serviceDate<worker.start_date)||(worker.end_date&&serviceDate>worker.end_date)) { excluded.push({...ref,reason:'outside-employment'}); continue; }
    (Number(row.quantity)===1?eligible:excluded).push(ref);
  }
  eligible.sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate)||a.washId.localeCompare(b.washId));
  return {available:true,bikerUID,externalId:String(worker.driver_external_id||'').trim()||null,periodKey,eligible,excluded,readAt:new Date().toISOString()};
}

export function finalizeQualityV3(report,source) {
  const scoped=source.available?source.eligible.filter(r=>r.serviceDate>=report.from&&r.serviceDate<=report.to):[];
  const ids=scoped.map(r=>r.washId);
  const p=report.evidence.productivity;
  if(p&&source.available&&(p.completed.some(r=>!ids.includes(r.washId))
    ||(p.coverage==='complete-period'&&!sameIds(p.completed.map(r=>r.washId),ids)))) {
    throw new AuthError('قائمة الإنتاجية لا تطابق الغسلات المرتبطة بالمعرّف؛ حدّث اللقطة.',{code:'failed-precondition'});
  }
  // If no reviewed partial cohort was supplied, the same admin-authorized
  // canonical cohort is sufficient to derive wash-day productivity directly.
  const sourceConflict=(report.evidence.gaps||[]).some(g=>g.kind==='completion-conflict');
  const canonicalProductivity=!p&&source.available&&!sourceConflict;
  if(canonicalProductivity) {
    const days=new Set(scoped.map(r=>r.serviceDate)).size;
    Object.assign(report.components.find(c=>c.key==='productivity'),{
      points:days?round(10*Math.min(1,ids.length/days/8)):null,n:days,completed:ids.length,
      unit:'wash-days',reason:days?'wash-day-productivity':'no-eligible-wash-days',calculationSource:'canonical-cohort',
    });
  }
  const coversRatings=field=>{
    if(report.evidence.ratingsCoverage!=='complete-period') return false;
    const ranges=(report.evidence.ratings||[]).filter(r=>r[field].n>=0).sort((a,b)=>a.from.localeCompare(b.from));
    let next=report.from;
    for(const r of ranges) { if(r.from!==next) return false; next=new Date(Date.parse(`${r.to}T00:00:00Z`)+86400000).toISOString().slice(0,10); }
    return next>report.to;
  };
  const readable=(report.evidence.updates?.reviews||[]).filter(r=>r.readStatus==='read');
  const full={washQuality:coversRatings('wash'),behavior:coversRatings('behavior'),productivity:Boolean(source.available&&ids.length>0
    &&(canonicalProductivity||(p&&p.coverage==='complete-period'&&sameIds(p.completed.map(r=>r.washId),ids)))),
    duration:source.available&&ids.length>0&&sameIds(report.samples.map(s=>s.washId),ids),
    statusUpdates:report.evidence.updates?.coverage==='complete-period'&&sameIds(readable.map(r=>r.washId),ids)
      &&readable.length===(report.evidence.updates?.reviews.length||0)};
  for(const key of ['complaints','cancellations','lateness']) full[key]=report.evidence[key]?.coverage==='complete-period';
  if(full.complaints) full.complaints=sameIds(report.evidence.complaints.eligible.map(r=>r.id),ids);
  const excluded=source.available?(source.excluded||[]).filter(r=>r.reason==='invalid-date'||(r.serviceDate>=report.from&&r.serviceDate<=report.to)).length:null;
  report.coverage={sourceAvailable:source.available,canonicalCompleted:source.available?ids.length:null,durationMeasured:report.duration.n,
    durationMissing:source.available?Math.max(0,ids.length-report.duration.n):null,excludedSourceRecords:excluded,
    sourceScope:'canonical-linked-unit-completed-washes',canonicalWashes:scoped,cohortHash:source.available?createHash('sha256').update(JSON.stringify(scoped)).digest('hex'):null,
    criteria:full};
  const known=report.components.filter(c=>c.points!==null);
  report.availablePoints=known.length?round(known.reduce((n,c)=>n+c.points,0)):null;
  report.availableWeight=known.reduce((n,c)=>n+c.weight,0);
  const complete=source.available&&excluded===0&&!(report.evidence.gaps||[]).length&&report.availableWeight===100
    &&report.components.every(c=>c.points!==null&&c.n>0&&full[c.key]);
  report.finalScore=complete?report.availablePoints:null;
  report.status=complete?'complete':'incomplete';
  return report;
}
