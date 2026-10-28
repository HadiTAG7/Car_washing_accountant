import { financeHash, financeSourceHash } from './financeHash.js';
import { financeSourceEvidence, quantityExceptionProblems, allowedAllocationSibling } from './financeSourceEvidence.js';
export { financeHash, financeSourceHash } from './financeHash.js';
import { financeInvoiceLineProblems } from './financeInvoiceLines.js';
import { requiresReviewedPartialVat, reviewedPartialVatGrant } from './financeReviewedVat.js';

export const FINANCE_KINDS = Object.freeze({
  variable: { collection: 'variable_expenses', amount: 'total_variable_cost', date: 'logged_date', title: 'expense_name', category: 'variable_expense_categories' },
  monthly: { collection: 'monthly_expenses', amount: 'total_monthly_cost', date: 'logged_date', title: 'expense_name', category: 'monthly_expense_categories' },
  annual: { collection: 'annual_expense_entries', amount: 'amount', date: 'spent_date', title: 'description', parent: 'annual_expenses', fk: 'annual_expense_id' },
  startup: { collection: 'startup_cost_entries', amount: 'amount', date: 'spent_date', title: 'description', parent: 'startup_costs', fk: 'startup_cost_id' },
});
export const financeReviewId = (kind, id) => financeHash({ kind, sourceId: id });
export const journalMatchesFinanceSource = (kind, entry) => entry.sourceKind
  ? entry.sourceKind === kind : !entry.sourceType || entry.sourceType === 'expense';
const realDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export function financeProblems(kind, row, sourceId = null) {
  const spec = FINANCE_KINDS[kind], issues = [];
  if (!spec) return ['نوع السجل ليس مصروفًا مؤهلًا لهذا المسار.'];
  if (requiresReviewedPartialVat(kind, sourceId, row) && !reviewedPartialVatGrant(kind, sourceId, row)) issues.push('الخصم الجزئي لا يطابق مصدر الرأي المحسوم ومبالغه؛ أعد المراجعة.');
  if (typeof row[spec.title] !== 'string' || !row[spec.title].trim()) issues.push('وصف المصروف غير مكتمل.');
  if (!Number.isFinite(row[spec.amount]) || row[spec.amount] <= 0) issues.push('المبلغ غير مثبت.');
  if (!realDate(row[spec.date])) issues.push('تاريخ المصروف غير مكتمل.');
  if (Object.hasOwn(row.finance_metadata || {}, 'quantityException')) issues.push(...quantityExceptionProblems(kind, sourceId, row));
  else if (Object.hasOwn(row.finance_metadata || {}, 'invoiceLines')) issues.push(...financeInvoiceLineProblems(row, row[spec.amount], { kind, sourceId }));
  else if (!Number.isFinite(row.quantity) || row.quantity <= 0 || !Number.isFinite(row.unit_cost)
    || Math.round(row.quantity * row.unit_cost * 100) !== Math.round(row[spec.amount] * 100)) issues.push('الكمية وسعر الوحدة لا يطابقان الإجمالي.');
  if (typeof row.supplier !== 'string' || !row.supplier.trim()) issues.push('المورد غير محدد.');
  if (!row.invoice_url || !/^https:\/\//.test(row.invoice_url)) issues.push('رابط المستند غير مكتمل.');
  if (spec.fk ? !row[spec.fk] : !row.category_id) issues.push('التصنيف غير محدد.');
  if (kind === 'monthly' && (row.recurrence === 'monthly' || row.biker_id || row.payrollSnapshot)) issues.push('القالب المتكرر أو الراتب ليس مصروفًا مفردًا في هذا المسار.');
  if (!['paid', 'unpaid'].includes(row.payment_status)) issues.push('حالة السداد غير مثبتة.');
  if (row.payment_status === 'paid' && !realDate(row.paid_date)) issues.push('تاريخ السداد الفعلي غير مثبت.');
  if (!['cash', 'transfer', 'card', 'credit'].includes(row.payment_method)) issues.push('طريقة الدفع أو الذمة غير مثبتة.');
  const meta = row.finance_metadata;
  if (typeof meta?.purpose !== 'string' || !meta.purpose.trim() || !meta?.evidenceRefs?.length) issues.push('الغرض ودليل المراجعة غير مكتملين.');
  if (typeof meta?.fundingReference !== 'string' || !meta.fundingReference.trim()) issues.push('دليل التمويل أو ذمة المورد غير مكتمل.');
  const types = { company_cash: ['cash'], company_bank: ['card', 'transfer'], vendor_liability: ['credit'] };
  if (!types[meta?.fundingType]) issues.push('الحساب المقابل لهذا التمويل غير محسوم؛ لا يفترض الصندوق أو البنك.');
  else if (!types[meta.fundingType].includes(row.payment_method)) issues.push('طريقة الدفع تتعارض مع التمويل المثبت.');
  if ((meta?.fundingType === 'vendor_liability') !== (row.payment_status === 'unpaid')) issues.push('حالة السداد لا تطابق الذمة أو التمويل.');
  if (typeof row.is_tax_invoice !== 'boolean' || typeof row.vat_deductible !== 'boolean') issues.push('المعالجة الضريبية غير محسومة.');
  if (!row.is_tax_invoice && row.vat_deductible !== false) issues.push('المستند غير الضريبي لا يثبت مطالبة مدخلات.');
  if (row.is_tax_invoice && row.vat_deductible === true && !meta?.taxReviewRef) issues.push('أهلية المدخلات تحتاج مرجع مراجعة ضريبية؛ العلامة القديمة ليست إثباتًا.');
  const taxAmountKnown = Number.isFinite(row.vat_amount) && row.vat_amount >= 0;
  const taxRateKnown = Number.isFinite(row.vat_rate) && row.vat_rate >= 0 && row.vat_rate <= 1;
  const reviewedDatedPolicy = meta?.taxBasis === 'verified_historical_policy' && typeof meta.taxReviewRef === 'string' && meta.taxReviewRef.trim();
  if (row.is_tax_invoice && (typeof row.invoice_number !== 'string' || !row.invoice_number.trim() || !realDate(row.invoice_date)
    || (!taxAmountKnown && !taxRateKnown && !reviewedDatedPolicy) || !['inclusive', 'exclusive'].includes(row.price_mode))) issues.push('حقول الفاتورة الضريبية غير مكتملة.');
  return issues;
}
export class FinanceReviewError extends Error {
  constructor(message, code = 'failed-precondition') { super(message); this.code = code; }
}
export async function assertFinanceDocumentUniqueness(db, tx, kind, sourceId, row, { allowIncompleteAllocation = false } = {}) {
  const context = await financeSourceEvidence(db, tx, kind, sourceId, row);
  const blocking = context.issues.filter(issue => !allowIncompleteAllocation || !issue.startsWith('ربط التوزيع غير مكتمل'));
  if (blocking.length) throw new FinanceReviewError(blocking.join(' '));
  for (const [matchKind, spec] of Object.entries(FINANCE_KINDS)) {
    const queries = [];
    if (row.invoice_url) queries.push(['invoice_url', row.invoice_url]);
    if (row.invoice_number && row.supplier) queries.push(['invoice_number', row.invoice_number]);
    for (const [key, value] of queries) {
      const matches = await tx.get(db.collection(spec.collection).where(key, '==', value).limit(101));
      if (matches.size > 100) throw new FinanceReviewError('نتائج كشف التكرار محدودة؛ يلزم حسمها قبل الاعتماد.');
      if (matches.docs.some(d => !(spec.collection === FINANCE_KINDS[kind].collection && d.id === sourceId)
        && (key === 'invoice_url' || d.data().supplier === row.supplier)
        && !(row.finance_metadata?.documentAllocation && allowedAllocationSibling(context.allocationGrant, matchKind, d.id)))) throw new FinanceReviewError('يوجد مستند مرتبط بمصروف آخر؛ راجع احتمال التكرار أو تجزئة المستند.');
    }
  }
  return context;
}
/** Called inside the SAME posting transaction, including the old MCP/callable
 * door. No source-date shortcut or client-side checkbox can substitute it. */
export async function assertFinanceApproval(db, tx, kind, id, row, expectedHash = null) {
  if (!FINANCE_KINDS[kind]) return;
  if (expectedHash && financeSourceHash(row) !== expectedHash) throw new FinanceReviewError('تغيرت النسخة المطلوبة قبل الترحيل.');
  const review = await tx.get(db.collection('finance_reviews').doc(financeReviewId(kind, id)));
  if (row.approval_status !== 'approved' || !review.exists || review.data().status !== 'approved' || review.data().sourceHash !== financeSourceHash(row)) {
    throw new FinanceReviewError('يلزم اعتماد موثق للنسخة الحالية من المصروف عبر المالية.');
  }
  const issues = financeProblems(kind, row, id);
  if (issues.length) throw new FinanceReviewError(issues.join(' '));
  const spec = FINANCE_KINDS[kind];
  const classification = await tx.get(db.collection(spec.parent || spec.category).doc(row[spec.fk || 'category_id']));
  if (!classification.exists) throw new FinanceReviewError('رابط تصنيف المصروف لم يعد موجودًا؛ أعد المراجعة.');
  const context = await assertFinanceDocumentUniqueness(db, tx, kind, id, row);
  if ((review.data().sourceContextHash || null) !== context.contextHash) throw new FinanceReviewError('تغيرت نسخة أحد سجلي توزيع الأصل بعد الاعتماد؛ أعد المراجعة.');
  const journals = await tx.get(db.collection('journal_entries').where('sourceId', '==', id));
  if (journals.docs.some(d => journalMatchesFinanceSource(kind, d.data()))) throw new FinanceReviewError('لهذا المصدر قيد سابق أو معكوس؛ لا يعاد ترحيله.');
  return review.data();
}
