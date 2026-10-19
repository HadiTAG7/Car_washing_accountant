import { z } from 'zod';

const text = max => z.string().trim().min(1).max(max);
const ref = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
export const financeDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const at = z.string().datetime({ offset: true });
export const FINANCE_ROLES = Object.freeze({ 1: 'المدير المالي', 2: 'تسجيل المصروفات', 3: 'الضرائب والالتزام' });
export const FINANCE_STATES = Object.freeze({ open: 'مفتوح', in_progress: 'قيد المعالجة', blocked: 'متعذر',
  awaiting_owner: 'بانتظار قرار هادي', verified_closed: 'مغلق بدليل' });
const verification = z.object({ kind: z.enum(['self', 'independent', 'owner']), reviewerRole: z.number().int().min(0).max(13),
  at, sourceRef: ref }).strict();
const source = z.object({ id: ref, label: text(180), sourceRef: text(300), checkedAt: at,
  coverage: text(1500), status: z.enum(['verified', 'partial', 'unavailable']) }).strict();
const state = z.object({ caseId: ref, title: text(200), ownerRole: z.number().int().min(0).max(13),
  status: z.enum(Object.keys(FINANCE_STATES)), evidence: text(2000), next: text(2000),
  lastVerifiedAt: at.optional(), verification: verification.optional() }).strict();
const cell = z.union([z.string().max(1000), z.number().finite(), z.null()]);
const section = z.object({ id: ref, title: text(180), text: text(6000),
  columns: z.array(text(120)).min(1).max(8).optional(), rows: z.array(z.array(cell).max(8)).max(60).optional() }).strict();

export const financeReportSchema = z.object({
  schemaVersion: z.literal(1), reportId: ref, revision: z.number().int().min(1).max(999999),
  dateRiyadh: financeDay, cutAtRiyadh: at, sourceRole: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  period: z.object({ kind: z.enum(['daily', 'weekly', 'monthly', 'ad-hoc']), from: financeDay, to: financeDay }).strict(),
  title: text(180), summary: text(6000),
  review: z.object({ completed: z.literal(true), reviewerRole: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    sourceRef: ref, at }).strict(),
  metrics: z.array(z.object({ id: ref, label: text(150), value: z.number().finite().nullable(), unit: text(40),
    basis: z.enum(['ledger', 'operational', 'collected', 'estimate', 'unavailable']), coverage: text(1500), asOf: at }).strict()).max(6),
  visibleWarnings: z.array(z.object({ id: ref, severity: z.enum(['limitation', 'open', 'critical']), text: text(2000) }).strict()).max(30),
  sources: z.array(source).min(1).max(40), cases: z.array(state).max(100), sections: z.array(section).max(24),
  historicalIntegrity: text(2000), correctionReason: text(1500).optional(),
}).strict().superRefine((report, ctx) => {
  const problem = message => ctx.addIssue({ code: 'custom', message });
  const cut = Date.parse(report.cutAtRiyadh);
  if (report.reportId !== financeReportId(report)) problem('معرف تقرير المالية لا يطابق الدور والتاريخ والفترة.');
  if (!report.cutAtRiyadh.endsWith('+03:00') || report.cutAtRiyadh.slice(0, 10) !== report.dateRiyadh) problem('وقت القطع يجب أن يطابق يوم التقرير بتوقيت الرياض.');
  if (report.period.from > report.period.to || report.period.to > report.dateRiyadh) problem('فترة التقرير غير صالحة.');
  if (Date.parse(report.review.at) > cut || report.sources.some(s => Date.parse(s.checkedAt) > cut)
    || report.metrics.some(m => Date.parse(m.asOf) > cut)) problem('الدليل أحدث من وقت قطع التقرير.');
  for (const ids of [report.metrics.map(m => m.id), report.visibleWarnings.map(w => w.id), report.sources.map(s => s.id),
    report.cases.map(c => c.caseId), report.sections.map(s => s.id)]) {
    if (new Set(ids).size !== ids.length) problem('معرف مكرر داخل التقرير.');
  }
  for (const c of report.cases) {
    if (c.status === 'verified_closed' && !c.verification) problem('إغلاق الحالة يحتاج دليل تحقق.');
    if ((c.lastVerifiedAt && Date.parse(c.lastVerifiedAt) > cut) || (c.verification && Date.parse(c.verification.at) > cut)) problem('تحقق أحدث من القطع.');
    if (c.verification?.kind === 'independent' && c.verification.reviewerRole === c.ownerRole) problem('التحقق الذاتي ليس رقابة مستقلة.');
  }
  for (const s of report.sections) {
    if (Boolean(s.columns) !== Boolean(s.rows) || s.rows?.some(row => row.length !== s.columns.length)) problem('أعمدة الجدول لا تطابق صفوفه.');
  }
  if (report.revision > 1 && !report.correctionReason) problem('نسخة التصحيح تحتاج سببًا.');
});

export function financeReportId(report) {
  return `finance-${report.dateRiyadh}-${report.sourceRole}-${report.period.kind}-${report.period.from}-${report.period.to}`;
}
export function parseFinanceReport(value) {
  const parsed = financeReportSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues.map(i => i.message).join(' '));
  const serialized = JSON.stringify(parsed.data);
  if (new TextEncoder().encode(serialized).length > 96000) throw new Error('تقرير المالية يتجاوز 96KB.');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{12,}|https?:\/\/[^\s"<>]+\/api\/mcp\/|(?:^|[\s"'])[A-Z]:[\\/]/i.test(serialized)) {
    throw new Error('يتضمن التقرير سرًا أو مرجع قرص محلي غير صالح للنشر.');
  }
  return parsed.data;
}
