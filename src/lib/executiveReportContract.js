import { z } from 'zod';
import { financialSnapshotSchema, reportSubmission } from './reportPublication.js';

const text = max => z.string().trim().min(1).max(max);
export const executiveDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
});
const ref = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const at = z.string().datetime({ offset: true });
const detail = z.object({ title:text(160), text:text(4000), sourceRef:ref.optional() }).strict();
export const EXECUTIVE_STATES = Object.freeze({open_result_unverified:'مفتوح — النتيجة غير متحققة',in_progress:'قيد التنفيذ',
  blocked:'متعذر',awaiting_owner:'بانتظار قرار هادي',verified_closed:'مغلق بدليل'});
const verification = z.object({kind:z.enum(['independent','owner','self']),reviewerRole:z.number().int().min(0).max(13),
  sourceRef:ref,at}).strict();
const decision = z.object({caseId:ref,priority:z.number().int().min(1).max(3),ownerRole:z.number().int().min(0).max(13),
  coordinationOwnerRole:z.number().int().min(0).max(13).optional(),status:z.enum(Object.keys(EXECUTIVE_STATES)),
  decision:text(2000),checkpointRiyadh:at.optional(),checkpointMeaning:text(500).optional(),
  evidenceLevel:text(100),evidenceRef:ref.optional(),next:text(1500),closure:text(1500).optional(),verification:verification.optional(),
  history:z.array(z.object({at,text:text(1500),sourceRef:ref.optional()}).strict()).max(40).default([])}).strict();

export const executiveReportSchema = z.object({schemaVersion:z.literal(1),reportId:ref,revision:z.number().int().min(1).max(999999),
  dateRiyadh:executiveDay,cutAtRiyadh:at,title:text(160),summary:text(4000),
  metrics:z.array(z.object({id:ref,label:text(120),value:z.number().finite().nullable(),unit:text(32),
    asOfRiyadh:at.optional(),coverage:text(600)}).strict()).max(3),
  visibleWarnings:z.array(z.object({id:ref,severity:z.enum(['limitation','open','critical']),text:text(1500)}).strict()).max(20),
  decisions:z.array(decision).max(100),
  weekly:z.object({status:z.enum(['not_due_for_this_date','unavailable','included']),text:text(4000),
    from:executiveDay.optional(),to:executiveDay.optional(),details:z.array(detail).max(15).default([])}).strict(),
  ownerAction:z.object({requiredAtCut:z.boolean(),text:text(1500)}).strict(),
  provenance:z.object({sourceRef:ref,reviewedByRole:z.literal(0),sourceCutRiyadh:at}).strict(),
  historicalIntegrity:text(1500),details:z.array(detail).max(20).default([]),correctionReason:text(1500).optional(),financialSnapshot:financialSnapshotSchema.optional(),
}).strict().superRefine((report,ctx)=>{
  const issue = message => ctx.addIssue({code:'custom',message});
  if(report.reportId!==`ceo-digest-${report.dateRiyadh}`)issue('معرف التقرير لا يطابق تاريخ الرياض.');
  const cut=Date.parse(report.cutAtRiyadh);
  if(!Number.isFinite(cut)||!report.cutAtRiyadh.endsWith('+03:00')||report.cutAtRiyadh.slice(0,10)!==report.dateRiyadh
    ||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Riyadh'}).format(new Date(cut))!==report.dateRiyadh)issue('وقت القطع لا يطابق يوم التقرير بتوقيت الرياض.');
  if(Date.parse(report.provenance.sourceCutRiyadh)>cut||report.metrics.some(m=>m.asOfRiyadh&&Date.parse(m.asOfRiyadh)>cut))issue('دليل أحدث من وقت قطع التقرير.');
  for(const list of [report.metrics.map(x=>x.id),report.visibleWarnings.map(x=>x.id),report.decisions.map(x=>x.caseId)])
    if(new Set(list).size!==list.length)issue('معرفات مكررة داخل التقرير.');
  const saturday=new Date(`${report.dateRiyadh}T12:00:00Z`).getUTCDay()===6;
  if(report.weekly.status==='included'&&(!saturday||!report.weekly.from||!report.weekly.to
    ||report.weekly.from>report.weekly.to||report.weekly.to>report.dateRiyadh))issue('الأسبوعية المدرجة تحتاج ملخص السبت وفترة صحيحة.');
  if(report.weekly.status==='not_due_for_this_date'&&saturday)issue('يوم السبت يحتاج أسبوعية أو بيان تعذرها.');
  if(report.revision>1&&!report.correctionReason)issue('نسخة التصحيح تحتاج سببًا.');
  for(const d of report.decisions){
    if(d.status==='verified_closed'&&!d.verification)issue('إغلاق الحالة يحتاج دليل تحقق.');
    if(d.verification&&(Date.parse(d.verification.at)>cut
      ||(d.verification.kind==='independent'&&d.verification.reviewerRole===d.ownerRole)))issue('وصف التحقق لا يطابق الدليل أو وقت القطع.');
    if(d.history.some(h=>Date.parse(h.at)>cut))issue('تغير لاحق لوقت القطع في السجل التاريخي.');
  }
});

export function parseExecutiveReport(input) {
  const parsed=executiveReportSchema.safeParse(input);
  if(!parsed.success)throw new Error(parsed.error.issues.map(x=>x.message).join(' '));
  const serialized=JSON.stringify(parsed.data);
  if(new TextEncoder().encode(JSON.stringify(reportSubmission(parsed.data))).length>64000)throw new Error('التقرير يتجاوز حد 64KB.');
  if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{12,}|https?:\/\/[^\s"<>]+\/api\/mcp\/|[A-Z]:[\\/]/i.test(serialized))
    throw new Error('التقرير يتضمن سرًا أو مرجعًا محليًا غير صالح للنشر.');
  return parsed.data;
}
