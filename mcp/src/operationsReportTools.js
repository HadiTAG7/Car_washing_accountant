import { z } from 'zod';
import { connect, readOnly, SweaterMcpError } from './client.js';
import { operationsReportSchema, parseOperationsReport } from '../../src/lib/operationsReportContract.js';

const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
export async function callOperationsReports(input, { write = false } = {}) {
  if (write && readOnly) throw new SweaterMcpError('الخادم في وضع القراءة فقط.', { code: 'permission-denied' });
  const { auth } = await connect();
  if (!auth?.currentUser) throw new SweaterMcpError('تسجيل الدخول مطلوب.', { code: 'unauthenticated' });
  const token = await auth.currentUser.getIdToken();
  let response;
  try {
    response = await fetch('https://sweater-hadi-alghanim.vercel.app/api/operations-reports', { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(55000) });
  } catch { throw new SweaterMcpError('تعذر الاتصال؛ اقرأ النسخة قبل إعادة الحفظ.', { code: 'unavailable' }); }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.error || !Object.hasOwn(body, 'result')) throw new SweaterMcpError(body?.error?.message || 'استجابة تقرير العمليات غير متحققة.', { code: body?.error?.code || 'internal' });
  return body.result;
}
export const operationsReportReadTools = [{
  name: 'sweater_operations_reports', title: 'أرشيف تقارير العمليات',
  description: 'يقرأ أرشيف العمليات الإداري ونسخه المحفوظة للأدمن فقط؛ لا يقرأ SSP أو يعيد المزامنة. list محدود30 مع before،read للنسخة. يحفظ تاريخ الخدمة والقطع ودقة التاريخ والأصل وحدود الفردي وB2B.',
  schema: { action: z.enum(['list', 'read']), reportId: z.string().optional(), revision: z.number().int().positive().optional(), before: z.string().optional() },
  run: input => callOperationsReports(input).then(text), annotations: { readOnlyHint: true, destructiveHint: false },
}];
export const operationsReportWriteTools = [{
  name: 'sweater_publish_operations_report', title: 'حفظ تقرير عمليات مراجع والتحقق',
  description: 'يحفظ تقرير عمليات مراجع ثم يعيد قراءة النسخة ومطابقتها؛ الأرشيف التاريخي له وسمه وهوية مصدره ودقة قطعه. append-only والتصحيح بسبب واضح؛إعادة المحتوى لا تكرره. لا ينفذ غسلة/عمولة/أصل/قيد أو يغير SSP والمرسل. غموض النتيجة يحتاج قراءة قبل إعادة الحفظ.',
  schema: { report: operationsReportSchema, expectedRevision: z.number().int().nonnegative(), confirm: z.literal(true) },
  run: async ({ report, expectedRevision }) => {
    const parsed = parseOperationsReport(report);
    const result = await callOperationsReports({ action: 'save', report: parsed, expectedRevision }, { write: true });
    if (result?.reportId !== parsed.reportId || result?.revision !== parsed.revision || typeof result?.duplicate !== 'boolean') throw new SweaterMcpError('إيصال الحفظ غير متحقق؛ اقرأ الأرشيف قبل أي إعادة.');
    const after = await callOperationsReports({ action: 'read', reportId: parsed.reportId, revision: parsed.revision });
    if (JSON.stringify(parseOperationsReport(after.report)) !== JSON.stringify(parsed)) throw new SweaterMcpError('لم تتطابق إعادة قراءة النسخة؛ لا تعد الحفظ عميانيًا.');
    return text({ ...result, verified: true, report: after.report, savedAt: after.savedAt });
  }, annotations: { readOnlyHint: false, destructiveHint: false },
}];
