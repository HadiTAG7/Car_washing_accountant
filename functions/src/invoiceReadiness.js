// Shared presentation/server guards. These validate inputs, never infer registration.
export const SWEATER_BUYER_NAME = 'شركة اللمسة العصرية التقنية';
export const INVOICE_KINDS = ['standard', 'simplified'];
const text = value => String(value ?? '').trim();
export const validVatNumber = value => /^3\d{13}3$/.test(text(value));

export function sellerIssuanceProblems(seller, policy, { pending = false, error = false, configured = true } = {}) {
  const problems = [];
  if (pending) problems.push('انتظر اكتمال قراءة بيانات المنشأة والسياسة الضريبية.');
  if (error) problems.push('تعذرت قراءة بيانات المنشأة أو السياسة الضريبية؛ الإصدار متوقف.');
  if (!text(seller?.name)) problems.push('اسم المنشأة غير مكتمل.');
  if (!validVatNumber(seller?.vatNumber)) problems.push('الرقم الضريبي للمنشأة مطلوب: 15 رقمًا تبدأ وتنتهي بـ 3.');
  if (!text(seller?.address)) problems.push('عنوان المنشأة غير مكتمل.');
  if (seller?.vatRegistered !== true) problems.push('تأكيد تسجيل المنشأة في ضريبة القيمة المضافة مطلوب.');
  if (!configured || !policy?.known) problems.push('السياسة الضريبية المؤرخة غير متاحة لتاريخ الإصدار.');
  if (policy?.known && typeof seller?.vatRegistered === 'boolean'
    && seller.vatRegistered !== Boolean(policy.vatRegistered)) {
    problems.push('يوجد تعارض بين تسجيل المنشأة وسياسة الدفتر؛ راجع المصدرين قبل الإصدار.');
  }
  return [...new Set(problems)];
}

export function invoiceCustomerProblems(kind, customer) {
  if (!INVOICE_KINDS.includes(kind)) return ['اختر نوع الفاتورة: ضريبية لمنشأة أو مبسطة لفرد.'];
  if (kind !== 'standard') return [];
  return [
    !text(customer?.name) && 'اسم العميل مطلوب للفاتورة الضريبية.',
    !text(customer?.address) && 'عنوان العميل مطلوب للفاتورة الضريبية.',
    !validVatNumber(customer?.vatNumber) && 'الرقم الضريبي للعميل مطلوب وصيغته غير مكتملة.',
  ].filter(Boolean);
}

export function isSweaterBuyer(customer) {
  const name = text(customer?.name).normalize('NFKC').toLowerCase()
    .replace(/[\u064B-\u065F\u0670ـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return /سويتر|sweater|اللمسهالعصريه/.test(name);
}

export function standaloneBuyerProblems(customer, sourceType = '') {
  return isSweaterBuyer(customer) || String(sourceType).toLowerCase().startsWith('sweater')
    ? ['فاتورة سويتر الشهرية تُصدر من تسويات سويتر بعد اعتماد الشهر، وليست فاتورة مستقلة.'] : [];
}

export function settlementInvoiceProblems(settlement) {
  if (settlement?.invoiceDocumentId || settlement?.invoiceNumber) return ['سبق إصدار فاتورة لهذا الشهر؛ افتح المستند المسجل.'];
  if (settlement?.status !== 'approved') return ['اعتمد ورحّل الشهر قبل إصدار فاتورة سويتر.'];
  if (!settlement.journalEntryId) return ['قيد اعتماد الشهر غير متاح؛ لا يمكن إصدار الفاتورة.'];
  const money = settlement.figures?.services;
  if (!money || ![money.net, money.vat, money.gross].every(v => v != null && Number.isFinite(Number(v)))
    || !(Number(money.gross) > 0)) return ['مبالغ الخدمات المعتمدة غير مكتملة.'];
  return [];
}
