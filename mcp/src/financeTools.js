import { z } from 'zod';
import { connect, readOnly, SweaterMcpError } from './client.js';
import { financeReportSchema, parseFinanceReport } from '../../src/lib/financeReportContract.js';
import { sameReportSubmission } from '../../src/lib/reportPublication.js';

const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
// Fixed same-app endpoints; no tool-controlled origin, account, or secret.
export async function callFinanceServer(endpoint, input, { write = false } = {}) {
  if (!['finance-reports', 'finance-workbench'].includes(endpoint)) throw new SweaterMcpError('مسار غير مسموح.');
  if (write && readOnly) throw new SweaterMcpError('الخادم في وضع القراءة فقط.', { code: 'permission-denied' });
  const { auth } = await connect();
  if (!auth?.currentUser) throw new SweaterMcpError('تسجيل الدخول مطلوب.', { code: 'unauthenticated' });
  const token = await auth.currentUser.getIdToken();
  let response;
  try {
    response = await fetch(`https://sweater-hadi-alghanim.vercel.app/api/${endpoint}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input),
      redirect: 'error', signal: AbortSignal.timeout(55000) });
  } catch { throw new SweaterMcpError('تعذر الاتصال؛ اقرأ النتيجة قبل إعادة أي حفظ.', { code: 'unavailable' }); }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.error || !Object.hasOwn(body, 'result')) throw new SweaterMcpError(body?.error?.message || 'استجابة مالية غير متحققة.', { code: body?.error?.code || 'internal' });
  return body.result;
}
export const financeReadTools = [
  { name: 'sweater_finance_reports', title: 'أرشيف تقارير المالية', description: 'يقرأ تقارير المالية المحفوظة للإدارة فقط، بتاريخها ومصادرها ونسخها. ليست تقارير CEO ولا أرصدة لحظية. list للأرشيف المحدود وread للنسخة؛ لا يعيد حساب الماضي.',
    schema: { action: z.enum(['list', 'read']), reportId: z.string().optional(), revision: z.number().int().positive().optional(), before: z.string().optional() },
    run: request => callFinanceServer('finance-reports', request).then(text), annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'sweater_finance_workbench', title: 'قراءة ومعاينة صندوق العمل المالي', description: 'قراءة أو معاينة فقط: list/read/preview/previewCapture. يعرض المصدر وبنود الفاتورة وبصمته ونواقصه وقيد المعاينة وحالة الاعتماد والقفل. البنود المختلفة في patch.invoiceLines بدل quantity الإجمالية؛ عقدها docs/FINANCE_INVOICE_LINES.md. لا يفترض السداد أو تمويل الصندوق، ولا ينشئ مصروفًا من المعاينة.',
    schema: { action: z.enum(['list', 'read', 'options', 'preview', 'previewCapture']), request: z.record(z.unknown()) },
    run: ({ action, request }) => callFinanceServer('finance-workbench', { ...request, action }).then(text), annotations: { readOnlyHint: true, destructiveHint: false } },
];
export const financeWriteTools = [
  { name: 'sweater_publish_finance_report', title: 'حفظ تقرير مالي مراجع', description: 'يحفظ لقطة إدارية مراجعة من فريق المالية1/2/3 ثم يعيد قراءتها للتحقق. تفويض نشر التقرير لا يعتمد مصروفًا أو يرحّل أو يصرف. التقرير له معرف ثابت ونسخ؛ التصحيح بسبب واضح، وإعادة نفس الطلب لا تكرر النسخة. مصدرالدور وصف، والحساب الفعلي هو هوية الناشر.',
    schema: { report: financeReportSchema, expectedRevision: z.number().int().nonnegative(), confirm: z.literal(true) },
    run: async ({ report, expectedRevision }) => {
      const parsed = parseFinanceReport(report);
      const result = await callFinanceServer('finance-reports', { action: 'save', report: parsed, expectedRevision }, { write: true });
      const after = await callFinanceServer('finance-reports', { action: 'read', reportId: parsed.reportId, revision: parsed.revision });
      if (!sameReportSubmission(parseFinanceReport(after.report),parsed)) throw new SweaterMcpError('حُفظ طلب التقرير لكن لم تتطابق إعادة قراءته؛ لا تعِد الحفظ عميانيًا.');
      return text({ ...result, verified: true, report: after.report });
    }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'sweater_finance_workbench_save', title: 'حفظ خطوة مالية محددة', description: 'ينفذ خطوة واحدة: capture تسجيل غيرمرحّل بمفتاحطلب؛ save تصحيح نفس المصدر ببصمة معاينة؛ approve اعتماد النسخة الحالية بعد اكتمال الدليل؛ post ترحيل المصروف المؤهل بمساره القائم. كل خطوة مستقلة بتأكيد صريح وإعادة قراءة. ليس دفعًا أو راتبًا أو عكسًا أو إذن تعديل قيد قائم.',
    schema: { action: z.enum(['capture', 'save', 'approve', 'post']), request: z.record(z.unknown()), confirm: z.literal(true) },
    run: async ({ action, request }) => {
      const result = await callFinanceServer('finance-workbench', { ...request, action, confirm: true }, { write: true });
      const sourceId = result.sourceId || result.verification?.sourceId;
      if (!sourceId) throw new SweaterMcpError('تعذر التحقق من معرّف المصدر؛ لا تعِد التنفيذ قبل القراءة.');
      const after = await callFinanceServer('finance-workbench', { action: 'read', kind: request.kind, sourceId });
      if (after.sourceId !== sourceId || (['save', 'capture'].includes(action) && after.sourceHash !== result.sourceHash)
        || (action === 'approve' && (!after.approved || after.sourceHash !== request.sourceHash))
        || (action === 'post' && (!result.verification?.linesMatched || !after.protectedSource || !after.journalIds?.length))) {
        throw new SweaterMcpError('لم تتطابق إعادة قراءة الخطوة المالية؛ اقرأ المصدر قبل أي إعادة.');
      }
      return text({ result, after, readbackVerified: true });
    }, annotations: { readOnlyHint: false, destructiveHint: false } },
];
