import { z } from 'zod';
import { callAppServer, SweaterMcpError } from './client.js';
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const expenseKind = z.enum(['variable', 'monthly', 'annual', 'startup']);
const correction = {
  kind: expenseKind, sourceId: z.string().min(1), targetKind: expenseKind.optional(), targetParentId: z.string().optional(),
  patch: z.object({ description: z.string().optional(), date: date.optional(), quantity: z.number().int().positive().optional(), amount: z.number().positive().optional(), categoryId: z.string().nullable().optional(), unit: z.string().optional() }).strict().optional(),
};
const payment = {
  runId: z.string().min(1), bikerIds: z.array(z.string().min(1)).min(1).max(200),
  payDate: date, paymentMethod: z.enum(['cash', 'bank']), recordedNetAmount: z.number().nonnegative(),
  paymentReference: z.string().optional(), reason: z.string().min(3),
  reconciledAdvances: z.array(z.object({ advanceId: z.string(), bikerId: z.string() }).strict()).optional().describe('فقط سلف مستردة قديمة أكد المالك أنها خصمت من هذه الرواتب، وبعد مطابقة دليلها.'),
  unrelatedLegacyPayments: z.array(z.string()).optional().describe('معرفات أدلة قديمة ثبت أنها غير مرتبطة بالدفعة؛ لا تستبعدها تلقائياً لتجاوز رفض الخادم.'),
};
export const workflowReadTools = [
  { name: 'sweater_expense_correction_options', title: 'بنود تصنيف المصاريف',
    description: 'يقرأ معرّفات بنود التأسيس والمصاريف السنوية وتصنيفات المصاريف الموجودة مع وحداتها قبل معاينة النقل، حتى لا يخترع المساعد تصنيفاً أو يطلب من المستخدم معرّفات تقنية. يعلن إذا كانت القائمة محدودة ولا ينشئ أي بند.',
    schema: {}, run: () => callAppServer('expenseCorrectionOptions', {}, { write: false }).then(text) },
  { name: 'sweater_payroll_status', title: 'حالة مسير الرواتب',
    description: 'يقرأ مسيرات شهر محدد ومعرّفاتها وحالة كل عامل وصافي راتبه والسلف المحتسبة من المسير المحفوظ. للعثور على المسير قبل إثبات دفعة فردية ومراجعة ما بقي بعدها؛ ليس دليلاً على تحويل أموال غير مسجلة.',
    schema: { periodKey: month, runId: z.string().optional() }, run: a => callAppServer('payrollReadStatus', a, { write: false }).then(text) },
  { name: 'sweater_preview_expense_correction', title: 'معاينة تصحيح مصروف',
    description: 'يقرأ المصروف الحالي ويعاين تعديل وصفه أو تاريخه أو وحداته وتصنيفه، أو نقله إلى بند تأسيس/سنوي موجود. يحافظ النقل على المبلغ والضريبة ويرفض المرحّل والفترة المقفلة. لا يحفظ شيئاً؛ استخدم بصمة المعاينة للحفظ بعد طلب المستخدم الصريح.',
    schema: correction, run: a => callAppServer('expensePreviewCorrection', a, { write: false }).then(text) },
  { name: 'sweater_preview_payroll_payment', title: 'معاينة رواتب مدفوعة',
    description: 'يطابق دفعة رواتب حدثت فعلاً مع العمال المحددين في المسير المحفوظ، ويحسب المتبقي والسلف ويكشف التكرار. قراءة فقط للمدير، ليست أمراً بتحويل المال ولا تغييراً لحالة العمال الآخرين. استخدم بصمة النتيجة لتسجيل الدفعة المؤكدة.',
    schema: payment, run: a => callAppServer('payrollPreviewPartialPayment', a, { write: false }).then(text) },
  { name: 'sweater_payroll_preview', title: 'احتساب مسير الرواتب',
    description: 'يحسب رواتب الشهر من سجلات التطبيق والسلف والعمولات بواسطة محرك الرواتب نفسه. معاينة لا تعتمد المسير ولا تدفعه، ولا تسجل سلفة، ولا تحوّل نتيجة الحساب إلى دليل سداد.',
    schema: { periodKey: month, automaticAdvanceDeduction: z.boolean().optional() },
    run: a => callAppServer('payrollPreview', a, { write: false }).then(text) },
];
export const workflowWriteTools = [
  { name: 'sweater_save_payroll_draft', title: 'حفظ مسودة الرواتب',
    description: 'يحفظ مسودة شهر طلب المستخدم إعدادها باستخدام محرك الرواتب الحالي؛ يعيد الحساب من سجلات العمال والعمولات والسلف. لا يعتمد المسير ولا يدفعه ولا يغير مسيراً مصروفاً أو معتمداً. استخدم الحساب للمعاينة أولاً وراجع النتيجة المحفوظة؛ لا تفرض أرقام رواتب من عندك.',
    schema: { periodKey: month, automaticAdvanceDeduction: z.boolean(), confirm: z.literal(true) },
    run: a => {
      if (a.confirm !== true) throw new SweaterMcpError('يلزم طلب صريح لحفظ مسودة الرواتب.');
      return callAppServer('payrollSaveDraft', { periodKey: a.periodKey, automaticAdvanceDeduction: a.automaticAdvanceDeduction }).then(text);
    } },
  { name: 'sweater_save_expense_correction', title: 'حفظ تصحيح المصروف',
    description: 'يحفظ التصحيح الذي طلبه المستخدم بعد معاينته: بصمة حديثة وسبب وتأكيد مطلوبان. النقل ذري بلا نسخة مكررة، مع تحديث إجماليات البنود وسجل قبل/بعد. يرفض المرحّل وتغير السجل أو البند منذ المعاينة؛ لا يرحل إلى الدفاتر ولا يصرف مالاً.',
    schema: { ...correction, previewHash: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().min(3), confirm: z.literal(true) },
    run: a => callAppServer('expenseSaveCorrection', a).then(text) },
  { name: 'sweater_record_payroll_payment', title: 'إثبات رواتب دُفعت فعلاً',
    description: 'للمدير: يسجل فقط دفعة قال المستخدم صراحة إنها دُفعت، للعمال المحددين دون الباقي. يحتاج بصمة المعاينة والمبلغ والتاريخ والطريقة، ويتحقق من السلف والتكرار على الخادم. ينشئ الأثر المحاسبي الموجود في مسار الرواتب؛ لا ينفذ تحويلاً بنكياً ولا تعتمد أي دفعة بالنيابة عن المستخدم.',
    schema: { ...payment, previewHash: z.string().regex(/^[a-f0-9]{64}$/), recordedExternally: z.literal(true), confirm: z.literal(true) },
    run: a => {
      if (a.confirm !== true || a.recordedExternally !== true) throw new SweaterMcpError('يلزم تأكيد المستخدم أن الدفعة حدثت فعلاً.');
      const { confirm: _confirm, ...payload } = a;
      return callAppServer('payrollRecordPartialPayment', payload).then(text);
    } },
  { name: 'sweater_record_worker_advance', title: 'تسجيل سلفة عامل',
    description: 'للمدير: يعاين ثم يسجل سلفة أكد المستخدم أنه دفعها فعلاً، مع تاريخها الحقيقي وشهر الراتب الذي تخصمه منه. لا يفترض الشهر من يوم الدفع ولا يصرف مالاً أو يرحل قيداً. استخدم requestId ثابتاً عند إعادة المحاولة؛ يرفض السلفة المطابقة حتى لو اختلف المفتاح. لا تؤكد الدفع نيابة عن المستخدم.',
    schema: { bikerId: z.string().min(1), amount: z.number().positive(), spentDate: date, assignmentMonth: month, paymentMethod: z.enum(['cash', 'bank']), description: z.string().min(2), requestId: z.string().min(1), confirm: z.boolean().optional() },
    run: a => callAppServer('workerRecordAdvance', a, { write: a.confirm === true }).then(text) },
];
