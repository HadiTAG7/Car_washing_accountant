import { z } from 'zod';
import { connect, readOnly, SweaterMcpError } from './client.js';
import { operationsReportSchema, parseOperationsReport } from '../../src/lib/operationsReportContract.js';
import { sameOperationsSubmission } from '../../src/lib/operationsReportPublication.js';

const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
export async function callOperationsReports(input, { write = false } = {}) {
  if (write && readOnly) throw new SweaterMcpError('الخادم في وضع القراءة فقط.', { code: 'permission-denied' });
  const { auth } = await connect();
  if (!auth?.currentUser) throw new SweaterMcpError('تسجيل الدخول مطلوب.', { code: 'unauthenticated' });
  const token = await auth.currentUser.getIdToken();
  let response;
  try {
    response = await fetch('https://app.hadialghanim.com/api/operations-reports', { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(55000) });
  } catch { throw new SweaterMcpError('تعذر الاتصال؛ اقرأ النسخة قبل إعادة الحفظ.', { code: 'unavailable' }); }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.error || !Object.hasOwn(body, 'result')) throw new SweaterMcpError(body?.error?.message || 'استجابة تقرير العمليات غير متحققة.', { code: body?.error?.code || 'internal' });
  return body.result;
}
export const operationsReportReadTools = [{
  name: 'sweater_operations_reports', title: 'أرشيف تقارير العمليات',
  description: 'يقرأ أرشيف العمليات الإداري ونسخه للأدمن فقط. البحث والفلاتر على كامل الأرشيف قبل ترقيم الصفحات؛ before يبقى للتوافق. لا يتصل بسويتر ولا يعيد المزامنة.',
  schema: { action: z.enum(['list', 'read']), reportId: z.string().optional(), revision: z.number().int().positive().optional(), before: z.string().optional(),
    page:z.number().int().positive().optional(),pageSize:z.number().int().min(1).max(30).optional(),query:z.string().max(200).optional(),
    kind:z.enum(['morning_review','sync','assets','weekly','targeted']).optional(),status:z.enum(['reviewed','partial','blocked']).optional(),
    sourceRole:z.number().int().min(0).max(13).optional(),from:z.string().optional(),to:z.string().optional() },
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
    if (!sameOperationsSubmission(parseOperationsReport(after.report),parsed)) throw new SweaterMcpError('لم تتطابق إعادة قراءة النسخة؛ لا تعد الحفظ عميانيًا.');
    return text({ ...result, verified: true, report: after.report, savedAt: after.savedAt });
  }, annotations: { readOnlyHint: false, destructiveHint: false },
}];
