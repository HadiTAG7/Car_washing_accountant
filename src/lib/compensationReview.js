import { z } from 'zod';
export { TICKET_REVIEW_TYPE, TICKET_QUEUE_TYPE, isTicketReview, isInternalQualityObjection } from './sweater/qualityRecordTypes.js';
export const REVIEW_OWNER_UID = '35b55029-8f93-5c3d-b505-3f0b7e96d5b9';
export const REVIEW_OWNER_EMAIL = 'haditag77+admin@gmail.com';
export const TICKET_REVIEW_ARCHIVE_STATES = Object.freeze(['historical_excluded','historical_deferred','previously_objected','left','prior_decision_unverified']);
// No source URL is fetched by our server. Links are opened only by the authorized reader.
export function safeReviewUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash
      && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|[^.]+$)/i.test(u.hostname)
      && !/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)
      && !/\/(api\/(partner-)?mcp|auth|login)\b/i.test(u.pathname)
      && ![...u.searchParams.keys()].some(k => /token|secret|password|signature|credential|api.?key|authorization/i.test(k));
  } catch { return false; }
}
const text = max => z.string().max(max);
const url = z.string().max(2000).refine(safeReviewUrl, 'استخدم رابط HTTPS أصليًا دون سر أو جلسة.');
const nullableText = text(300).nullable();
const stamp = z.string().datetime({ offset: true });
const ticket = z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,79}$/);
export const ticketKey = value => String(value || '').trim().toUpperCase();
export const ticketDocumentId = value => 'ssp-ticket-' + ticketKey(value);
// JSONB may reorder object keys. Preserve field presence, array order and every
// value while ignoring object insertion order in independent readback.
export function reviewRecordEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left).sort(), b = Object.keys(right).sort();
  return a.length === b.length && a.every((key, index) => key === b[index] && reviewRecordEqual(left[key], right[key]));
}
export const sourceSchema = z.object({
  schemaVersion: z.literal(1), ticketId: ticket,
  source: z.object({ url, readAt: stamp, coverage: z.object({
    from: stamp.nullable(), to: stamp.nullable(), complete: z.boolean(),
    pages: z.array(text(100)).max(100), filters: text(2000), limitations: z.array(text(1000)).max(40),
    lastCompleteThrough: stamp.nullable(),
  }).strict() }).strict(),
  facts: z.object({ washIds: z.array(text(80)).max(20), biker: z.object({
    name: nullableText, externalId: nullableText, siteId: nullableText, linkEvidence: text(2000),
  }).strict(), createdAt: nullableText, updatedAt: nullableText, ticketDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    complaint: text(12000), supportResponse: text(12000), comments: z.array(text(4000)).max(100),
  }).strict(),
  amounts: z.array(z.object({ kind: z.enum(['customer_code','compensation','invoice_deduction','settlement','late']),
    value: z.number().finite().min(-1e9).max(1e9).nullable(), unit: z.enum(['SAR','count','minutes']),
    sourceRef: text(2000),
  }).strict()).max(30),
  attachments: z.array(z.object({ id: text(100), kind: z.enum(['image','video','other']),
    url: url.nullable(), observation: z.enum(['viewed','unavailable','missing','duplicate']), note: text(4000),
  }).strict()).max(100),
  timeline: z.array(z.object({ label: text(150), value: nullableText, timezone: nullableText,
    precision: z.enum(['second','minute','date','unknown']), sourceRef: text(2000),
  }).strict()).max(50),
  analysis: z.object({ proven: z.array(text(2000)).max(30), limitations: z.array(text(2000)).max(30),
    objectionPoints: z.array(text(2000)).max(30), proposedDraft: text(8000),
  }).strict(),
  objections: z.array(z.object({ id: z.string().regex(/^OBJ[-A-Z0-9]+$/), ticketId: ticket,
    status: z.enum(['Open','Processing','Accepted','Rejected']), reply: text(8000),
    checkedAt: stamp, url,
  }).strict()).max(100),
  queueDisposition: z.enum(['eligible','historical_excluded','historical_deferred','prior_decision_unverified']),
  historicalReference: text(2000).nullable(),
}).strict().superRefine((s, ctx) => {
  if (s.objections.some(o => o.ticketId !== s.ticketId) || new Set(s.objections.map(o => o.id)).size !== s.objections.length)
    ctx.addIssue({ code: 'custom', message: 'رقم التكت أو الاعتراض مكرر أو غير مطابق.' });
  if (s.queueDisposition !== 'eligible' && !s.historicalReference?.trim())
    ctx.addIssue({ code: 'custom', message: 'مرجع القرار التاريخي مطلوب.' });
  if (s.queueDisposition === 'historical_excluded' && !(s.facts.ticketDate || s.facts.createdAt || '').startsWith('2026-10'))
    ctx.addIssue({ code: 'custom', message: 'استثناء أكتوبر يحتاج تاريخًا مثبتًا في أكتوبر.' });
  for (const a of s.amounts) {
    if (a.unit !== 'SAR' && a.value !== null && a.value < 0)
      ctx.addIssue({ code: 'custom', message: 'العدد والدقائق لا يقبلان قيمة سالبة؛ إشارة الريال تحفظ كما في المصدر.' });
    if ((a.kind === 'late') !== (a.unit === 'minutes'))
      ctx.addIssue({ code: 'custom', message: 'دقائق التأخير منفصلة عن مبالغ التعويض.' });
  }
});
export const reviewStatusLabels = { pending: 'بانتظار هادي', deferred: 'مؤجلة دون قرار', left: 'تركها هادي',
  information_requested: 'مطلوب معلومات', historical_excluded: 'أرشيف قرارات أكتوبر', prior_decision_unverified: 'قرار سابق غير متحقق', previously_objected: 'اعترض عليها سابقًا', historical_deferred: 'تأجيل تاريخي دون قرار ترك' };
export const submissionLabels = { none: 'لا يوجد طلب رفع', draft: 'مسودة غير مرسلة', queued: 'طلب رفع محفوظ · بانتظار قراءة الوكيل',
  in_progress_uncertain: 'الوكيل قرأ الطلب · الإرسال غير محسوم', sent: 'اعتراض مرسل بإيصال OBJ' };


