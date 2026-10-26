import { z } from 'zod';

export const REPORT_FINANCIAL_IDS = ['revenue', 'expenses', 'net-profit', 'bank-ledger', 'cash-ledger', 'vat-due'];
export const financialSnapshotSchema = z.object({
  version: z.literal(1), source: z.literal('site-functions'),
  requestedCutAt: z.string().datetime({ offset: true }), capturedAt: z.string().datetime({ offset: true }),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  metrics: z.array(z.object({ id: z.enum(REPORT_FINANCIAL_IDS), value: z.number().finite().nullable(),
    basis: z.enum(['operational', 'ledger', 'unavailable']), coverage: z.string().min(1).max(500) }).strict()).length(6),
}).strict().refine(s => new Set(s.metrics.map(m => m.id)).size === 6
  && s.month === s.capturedAt.slice(0, 7)
  && Date.parse(s.capturedAt) >= Date.parse(s.requestedCutAt)
  && s.metrics.every(m => (m.value === null) === (m.basis === 'unavailable')), 'لقطة الأرقام الست غير مكتملة.');

// This field belongs to the server. Replays compare the author's original
// payload, not fresh balances. Never refresh a saved snapshot during a read.
export function reportSubmission(report) {
  const { financialSnapshot: _serverSnapshot, ...submission } = report;
  return submission;
}
export function sameReportSubmission(a, b) {
  return JSON.stringify(reportSubmission(a)) === JSON.stringify(reportSubmission(b));
}

// Nonblocking editorial check. URLs and ordinary decimal amounts are not code.
export function needsReportWording(value = '') {
  const text = String(value).replace(/https?:\/\/[^\s<>]+/giu, '');
  return /=|\b(?:true|false|null|undefined)\b|\b[A-Za-z][A-Za-z0-9]*[-_][A-Za-z0-9_-]+\b|\b[a-z]+[A-Z][A-Za-z]*\b|\bQ[1-4]\b|\b[A-Za-z]+\/[A-Za-z]+\b/u.test(text);
}
export const reportWordingWarnings = report => (report.visibleWarnings || [])
  .filter(w => needsReportWording(w.text)).map(w => ({ id: w.id, message: 'تحتاج صياغة' }));
