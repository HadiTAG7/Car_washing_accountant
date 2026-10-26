import { z } from 'zod';
import { operationsSnapshotSchema } from './operationsReportPublication.js';

const text = max => z.string().trim().min(1).max(max);
const ref = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const at = z.string().datetime({ offset: true });
export const OPERATIONS_KINDS = Object.freeze({ morning_review: 'مراجعة التشغيل', sync: 'المزامنة', assets: 'الأصول والصيانة', weekly: 'أسبوعي', targeted: 'متابعة محددة' });
export const OPERATIONS_STATES = Object.freeze({ open: 'مفتوح', in_progress: 'قيد المعالجة', blocked: 'متعذر', awaiting_owner: 'بانتظار قرار هادي', verified_closed: 'مغلق بدليل' });
export const OPERATIONS_STATUSES = Object.freeze({ reviewed: 'مراجع', partial: 'جزئي', blocked: 'متعذر' });
export const OPERATIONS_STAGES = Object.freeze({ read: 'مقروء', previewed: 'معاين', saved: 'محفوظ', blocked: 'متعذر' });
const verification = z.object({ kind: z.enum(['self', 'independent', 'owner']), reviewerRole: z.number().int().min(0).max(13), at, sourceRef: ref }).strict();
const source = z.object({ id: ref, label: text(180), sourceRef: text(300), checkedAt: at.nullable(), coverage: text(1500), status: z.enum(['verified', 'partial', 'unavailable']) }).strict();
const state = z.object({ caseId: ref, title: text(200), ownerRole: z.number().int().min(0).max(13), status: z.enum(Object.keys(OPERATIONS_STATES)),
  evidence: text(2000), next: text(2000), lastVerifiedAt: at.optional(), verification: verification.optional() }).strict();
const cell = z.union([z.string().max(1000), z.number().finite(), z.null()]);
const section = z.object({ id: ref, title: text(180), text: text(6000), columns: z.array(text(120)).min(1).max(8).optional(), rows: z.array(z.array(cell).max(8)).max(60).optional() }).strict();
const coverage = z.object({ status: z.enum(['verified', 'partial', 'unavailable']), detail: text(1500) }).strict();
const activity = z.object({ count: z.number().int().nonnegative().nullable(), detail: text(1500) }).strict();

export const operationsReportSchema = z.object({
  schemaVersion: z.literal(1), reportId: ref, revision: z.number().int().min(1).max(999999),
  dateRiyadh: day, serviceDateRiyadh: day.nullable(), cutAtRiyadh: at.nullable(), issuedAtRiyadh: at.nullable(),
  sourceRole: z.number().int().min(0).max(13), sourceLabel: text(180),
  archiveMode: z.enum(['current', 'historical_imported']),
  historicalImported: z.object({ originalSourceRole: z.number().int().min(0).max(13), originalSourceRef: ref,
    originalReportDate: day, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), evidenceThroughDate: day,
    cutPrecision: z.enum(['exact', 'date_only', 'approximate']), timeNote: text(2000) }).strict().optional(),
  kind: z.enum(Object.keys(OPERATIONS_KINDS)), round: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/),
  status: z.enum(Object.keys(OPERATIONS_STATUSES)), snapshot: z.enum(['bounded', 'partial']),
  period: z.object({ from: day.nullable(), to: day.nullable() }).strict(), title: text(180), summary: text(6000),
  review: z.object({ completed: z.literal(true), reviewerRole: z.literal(4), sourceRef: ref, at }).strict(),
  activity: z.object({ read: activity, previewed: activity, saved: activity, blocked: activity }).strict(),
  coverage: z.object({ individual: coverage, b2b: coverage }).strict(),
  metrics: z.array(z.object({ id: ref, label: text(150), value: z.number().finite().nullable(), unit: text(40),
    basis: z.enum(['operational', 'estimate', 'unavailable']), coverage: text(1500), asOf: at.nullable() }).strict()).max(6),
  visibleWarnings: z.array(z.object({ id: ref, severity: z.enum(['limitation', 'open', 'critical']), text: text(2000) }).strict()).max(30),
  sources: z.array(source).min(1).max(40), cases: z.array(state).max(100), sections: z.array(section).max(24),
  historicalIntegrity: text(2000), correctionReason: text(1500).optional(), operationsSnapshot: operationsSnapshotSchema.optional(),
}).strict().superRefine((report, ctx) => {
  const problem = message => ctx.addIssue({ code: 'custom', message });
  const cut = Date.parse(report.cutAtRiyadh);
  const historical = report.archiveMode === 'historical_imported';
  const imported = report.historicalImported;
  const exact = !historical || imported?.cutPrecision === 'exact';
  const evidenceDay = imported?.evidenceThroughDate || report.dateRiyadh;
  const afterCut = value => value && (exact ? Date.parse(value) > cut : new Date(Date.parse(value) + 10800000).toISOString().slice(0, 10) > evidenceDay);
  if (report.reportId !== operationsReportId(report)) problem('معرف تقرير العمليات لا يطابق المصدر والتاريخ والنوع والجولة والفترة.');
  if (exact && !report.cutAtRiyadh) problem('وقت القطع الدقيق مطلوب للتقرير الحالي أو التاريخي الدقيق.');
  if (report.cutAtRiyadh && (!report.cutAtRiyadh.endsWith('+03:00') || report.cutAtRiyadh.slice(0, 10) !== evidenceDay)) problem('وقت القطع يجب أن يطابق آخر تاريخ دليل موثق بتوقيت الرياض.');
  if (report.issuedAtRiyadh && (!report.issuedAtRiyadh.endsWith('+03:00') || (exact && Date.parse(report.issuedAtRiyadh) < cut))) problem('وقت إصدار التقرير الأصلي يسبق القطع أو ليس بتوقيت الرياض.');
  if (!historical && !report.issuedAtRiyadh) problem('وقت الإصدار مطلوب للتقرير الحالي.');
  if (historical !== Boolean(imported)) problem('بيانات النقل التاريخي مطلوبة للأرشيف التاريخي فقط.');
  if (imported?.cutPrecision === 'date_only' && report.cutAtRiyadh !== null) problem('تاريخ فقط لا يحمل ساعة قطع مختلقة؛ استخدمnull.');
  if (imported && (imported.originalSourceRole !== report.sourceRole || imported.originalReportDate !== report.dateRiyadh || imported.evidenceThroughDate < report.dateRiyadh)) problem('هوية المصدر الأصلي أو حد أدلته لا يطابق الأرشيف.');
  if (!historical && (!report.serviceDateRiyadh || !report.period.from || !report.period.to)) problem('التقرير الحالي يحتاج تاريخ الخدمة وحدود الفترة.');
  if ((report.period.from && report.period.to && report.period.from > report.period.to)
    || (report.period.to && report.period.to > (report.serviceDateRiyadh || report.dateRiyadh))
    || (report.serviceDateRiyadh && report.serviceDateRiyadh > report.dateRiyadh)) problem('تاريخ الخدمة أو الفترة غير صالح.');
  if (report.archiveMode === 'current' && report.sourceRole !== 4) problem('التقرير الحالي من مدير العمليات4؛ الدور الأصلي المختلف للأرشيف التاريخي فقط.');
  if (report.round === '2200' && report.snapshot !== 'partial') problem('جولة22:00 لقطة جزئية وليست إغلاق اليوم.');
  if (exact && Date.parse(report.review.at) < cut) problem('المراجعة لا تسبق وقت القطع.');
  if (new Date(Date.parse(report.review.at) + 10800000).toISOString().slice(0, 10) < evidenceDay) problem('مراجعة الأرشفة تسبق آخر تاريخ دليل.');
  if (!historical && (report.sources.some(s => !s.checkedAt) || report.metrics.some(m => !m.asOf))) problem('التقرير الحالي يحتاج توقيت مصادره ومؤشراته.');
  if (report.sources.some(s => afterCut(s.checkedAt)) || report.metrics.some(m => afterCut(m.asOf))) problem('الدليل أحدث من وقت القطع؛ لا يضاف دليل لاحق لتقرير قديم.');
  if (report.metrics.some(m => m.basis === 'unavailable' && m.value !== null)) problem('القيمة غير المتاحة يجب أن تكونnull لا صفرًا.');
  for (const ids of [report.metrics.map(m => m.id), report.visibleWarnings.map(w => w.id), report.sources.map(s => s.id), report.cases.map(c => c.caseId), report.sections.map(s => s.id)]) {
    if (new Set(ids).size !== ids.length) problem('معرف مكرر داخل التقرير.');
  }
  for (const c of report.cases) {
    if (c.status === 'verified_closed' && !c.verification) problem('إغلاق الحالة يحتاج دليل تحقق.');
    if (afterCut(c.lastVerifiedAt) || afterCut(c.verification?.at)) problem('تحقق أحدث من القطع.');
    if (c.verification?.kind === 'independent' && c.verification.reviewerRole === c.ownerRole) problem('التحقق الذاتي ليس مستقلًا.');
  }
  for (const s of report.sections) if (Boolean(s.columns) !== Boolean(s.rows) || s.rows?.some(row => row.length !== s.columns.length)) problem('أعمدة الجدول لا تطابق صفوفه.');
  if (report.revision > 1 && !report.correctionReason) problem('نسخة التصحيح تحتاج سببًا.');
});

export function operationsReportId(report) {
  return `ops-${report.dateRiyadh}-${report.sourceRole}-${report.kind}-${report.round}-${report.period.from || 'unknown'}-${report.period.to || 'unknown'}`;
}
export function parseOperationsReport(value) {
  const parsed = operationsReportSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues.map(i => i.message).join(' '));
  const serialized = JSON.stringify(parsed.data);
  if (new TextEncoder().encode(serialized).length > 96000) throw new Error('تقرير العمليات يتجاوز96KB.');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{12,}|https?:\/\/[^\s"<>]+\/api\/(?:mcp|partner-mcp)\/|[?&](?:token|secret|api_key|key)=|(?:^|[\s"'])[A-Z]:[\\/]/i.test(serialized)) throw new Error('يتضمن التقرير سرًا أو مرجع قرص محلي غير صالح للنشر.');
  return parsed.data;
}
