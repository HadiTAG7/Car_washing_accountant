import { round2 } from './invariants.js';
import { reviewedPartialVatGrant } from './financeReviewedVat.js';

export const MAX_FINANCE_INVOICE_LINES = 100;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const money = value => Number.isFinite(value) && value >= 0 && value <= 1e9 && round2(value) === value;
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => allowed.includes(key));

/** Shape validation also runs against stored data, including the legacy posting door.
 * Amounts are source amounts in the invoice's existing price mode, not a new tax calculation. */
export function invoiceLinesShapeIssues(value) {
  if (!keys(value, ['version', 'items', 'vatAllocation', 'sharedTotal']) || value.version !== 1 || !Array.isArray(value.items)
    || !value.items.length || value.items.length > MAX_FINANCE_INVOICE_LINES) return ['بنود الفاتورة غير مكتملة أو نسختها غير مدعومة.'];
  const seen = new Set(), issues = [];
  const shared = value.sharedTotal != null;
  if (shared && (!keys(value.sharedTotal, ['amount', 'description', 'sourceRef']) || !money(value.sharedTotal.amount)
    || value.sharedTotal.amount <= 0 || !text(value.sharedTotal.description, 500) || !text(value.sharedTotal.sourceRef, 300))) {
    issues.push('المبلغ المشترك يحتاج إجماليًا مثبتًا وبيان ما يشمله ومرجع المصدر، دون توزيع على الأصناف.');
  }
  for (const [index, line] of value.items.entries()) {
    if (!keys(line, ['id', 'description', 'quantity', 'unit', 'unitCost', 'amount', 'sourceRef', 'amountSource', 'unitPriceMode', 'amountNote'])
      || typeof line.id !== 'string' || !/^[\p{L}\p{N}_.:-]{1,80}$/u.test(line.id) || seen.has(line.id)
      || !text(line.description, 500) || !text(line.unit, 50) || !text(line.sourceRef, 300)
      || !Number.isFinite(line.quantity) || line.quantity <= 0 || line.quantity > 1e6
      || (shared ? line.unitCost !== null || line.amount !== null || ['amountSource', 'unitPriceMode', 'amountNote'].some(key => Object.hasOwn(line, key))
        : !Number.isFinite(line.unitCost) || line.unitCost < 0 || line.unitCost > 1e9 || !money(line.amount)
          || ![undefined, 'product', 'printed'].includes(line.amountSource)
          || (line.amountSource !== 'printed' && (Object.hasOwn(line, 'unitPriceMode') || Object.hasOwn(line, 'amountNote')))
          || (line.amountSource === 'printed' ? !['inclusive', 'exclusive'].includes(line.unitPriceMode) || !text(line.amountNote, 500)
            : round2(line.quantity * line.unitCost) !== line.amount))) {
      issues.push(shared ? `بند الفاتورة ${index + 1}: يلزم وصف ووحدة وكمية ومرجع، مع أسعار ومبالغ فردية فارغة للمبلغ المشترك.`
        : `بند الفاتورة ${index + 1}: يلزم وصف ووحدة وكمية وسعر ومبلغ متطابق ومرجع للمصدر، دون تكرار البند.`);
    }
    if (line?.id) seen.add(line.id);
  }
  const tax = value.vatAllocation;
  if (tax != null && (!keys(tax, ['printedVat', 'eligibleVat', 'reviewRef']) || !money(tax.printedVat)
    || !(tax.eligibleVat === null || money(tax.eligibleVat)) || (tax.eligibleVat !== null && tax.eligibleVat > tax.printedVat)
    || !(tax.reviewRef === null || text(tax.reviewRef, 500)))) issues.push('تفصيل الضريبة المطبوعة والمؤهلة ومرجعها غير صالح.');
  return issues;
}

export function invoiceLinesTotal(value) {
  if (value?.sharedTotal != null) return Number.isFinite(value.sharedTotal.amount) ? value.sharedTotal.amount : null;
  return Array.isArray(value?.items) ? round2(value.items.reduce((sum, line) => sum + (Number.isFinite(line?.amount) ? line.amount : 0), 0)) : null;
}

export function financeInvoiceLineProblems(row, total, { kind, sourceId } = {}) {
  const value = row.finance_metadata?.invoiceLines;
  const issues = invoiceLinesShapeIssues(value);
  if (issues.length) return issues;
  if (row.quantity != null || row.unit_cost != null) issues.push('المستند ذو البنود المختلفة لا يقبل كمية أو سعر وحدة إجماليًا؛ أعد معاينته من صندوق العمل المالي.');
  if (invoiceLinesTotal(value) !== total) issues.push('مجموع بنود الفاتورة لا يطابق إجمالي المستند؛ لا تستخدم متوسطًا لسعر الوحدة.');
  for (const line of value.items) {
    if (line.amountSource === 'printed' && (!['inclusive', 'exclusive'].includes(row.price_mode)
      || (line.unitPriceMode === row.price_mode && round2(line.quantity * line.unitCost) !== line.amount))) {
      issues.push('أساس سعر الوحدة والإجمالي المطبوع غير متسق؛ لا تستخدم إجماليًا مطبوعًا لتجاوز فرق على الأساس نفسه.');
    }
  }
  const tax = value.vatAllocation;
  if (row.is_tax_invoice === true && row.vat_deductible === true && !tax) {
    issues.push('الفاتورة متعددة البنود تحتاج الضريبة المطبوعة والمؤهلة صراحةً قبل خصم المدخلات.');
  }
  if (tax) {
    if (row.vat_amount !== tax.printedVat) issues.push('ضريبة البنود المطبوعة لا تطابق الضريبة المحفوظة على الفاتورة.');
    if (tax.eligibleVat > 0 && (!text(tax.reviewRef, 500) || tax.reviewRef !== row.finance_metadata?.taxReviewRef)) {
      issues.push('أهلية ضريبة البنود تحتاج مرجع المراجعة الضريبية نفسه، ولا تُستنتج من المبلغ.');
    }
    if (tax.eligibleVat > 0 && tax.eligibleVat < tax.printedVat) {
      if (!reviewedPartialVatGrant(kind, sourceId, row)) issues.push('الخصم الجزئي يحتاج مصدرًا مطابقًا للرأي الضريبي المحسوم؛ يبقى الاعتماد والترحيل موقوفين.');
    } else if (row.vat_deductible === true && tax.eligibleVat !== tax.printedVat) {
      issues.push('المبلغ المؤهل للضريبة لم يثبت مطابقته للخصم المطلوب؛ لا تخصم الضريبة المطبوعة تلقائيًا.');
    } else if (row.vat_deductible !== true && tax.eligibleVat > 0) {
      issues.push('أهلية ضريبة البنود تتعارض مع المعالجة المحفوظة؛ يلزم حسم المراجعة.');
    }
  }
  return issues;
}
