// A source-bound implementation of an existing reviewed allocation, not a new
// tax eligibility decision. No claim, return, rate or registration is changed.
import { financeDocumentIdentity } from './financeDocumentIdentity.js';

const opinion = 'TAX-HOUSING39-PARTIAL-20261026';
const expected = Object.freeze([
  ['ملاعق', 1, 5, 5.75], ['ملابس', 2, 13.04, 30], ['أكواب', 2, 5, 11.5],
  ['مناديل', 1, 5, 5.75], ['ولاعة غاز', 1, 5, 5.75], ['طقم مفكات', 1, 5, 5.75], ['صحن تقديم', 3, 5, 17.25],
].map(Object.freeze));
export const hasPartialVatAllocation = row => {
  const tax = row.finance_metadata?.invoiceLines?.vatAllocation;
  return Number.isFinite(tax?.eligibleVat) && tax.eligibleVat > 0 && tax.eligibleVat < tax.printedVat;
};
export const requiresReviewedPartialVat = (kind, sourceId, row) => hasPartialVatAllocation(row)
  || (kind === 'startup' && sourceId === 'c790RQ8Dk5q8RoX3K3dO')
  || row.finance_metadata?.taxReviewRef === opinion || row.finance_metadata?.invoiceLines?.vatAllocation?.reviewRef === opinion;
export function reviewedPartialVatGrant(kind, sourceId, row) {
  const lines = row.finance_metadata?.invoiceLines, allocation = lines?.vatAllocation;
  if (kind !== 'startup' || sourceId !== 'c790RQ8Dk5q8RoX3K3dO' || row.amount !== 81.75
    || row.invoice_number !== '21110110175500' || row.invoice_date !== '2026-08-18' || row.spent_date !== '2026-08-18'
    || row.supplier !== 'شركة سلم التوفير للتجارة'
    || financeDocumentIdentity(row.invoice_url) !== 'drive:1cPMI-VUPp59F1hcq5GCb4zM6pzfT0psv'
    || row.is_tax_invoice !== true || row.vat_deductible !== true || row.vat_amount !== 10.66 || row.vat_rate !== 0.15
    || row.price_mode !== 'inclusive' || row.finance_metadata?.taxReviewRef !== opinion
    || lines?.version !== 1 || lines.sharedTotal != null || lines.printedDiscount != null || lines.items?.length !== expected.length
    || allocation?.reviewRef !== opinion || allocation.printedVat !== 10.66 || allocation.eligibleVat !== 6.75
    || !expected.every(([description, quantity, unitCost, amount], index) => {
      const line = lines.items[index];
      return line?.description === description && line.quantity === quantity && line.unitCost === unitCost && line.amount === amount
        && line.amountSource === 'printed' && line.unitPriceMode === 'exclusive';
    })) return null;
  return Object.freeze({ version: 1, ref: opinion, kind, sourceId, invoice: row.invoice_number,
    printedVat: 10.66, eligibleVat: 6.75, excludedVatInCost: 3.91, gross: 81.75, cost: 75,
    returnAction: 'none' });
}

/** Applied only AFTER the dated purchase-tax engine has allowed deduction.
 * Keep its gross, printed VAT, historical policy and account classification. */
export function applyReviewedPartialVat(kind, sourceId, row, tax) {
  if (!requiresReviewedPartialVat(kind, sourceId, row)) return tax;
  const grant = reviewedPartialVatGrant(kind, sourceId, row);
  if (!grant || !tax.deductible || tax.documentVat !== grant.printedVat || tax.gross !== grant.gross) {
    throw new Error('الخصم الجزئي يحتاج تطابق المصدر والرأي المحسوم وسياسة تاريخ الفاتورة؛ لا تخصم كامل الضريبة أو صفرًا.');
  }
  return { ...tax, vat: grant.eligibleVat, net: grant.cost,
    lineDescription: 'ضريبة مدخلات — الجزء المؤهل حسب المراجعة الموثقة',
    snapshot: { ...tax.snapshot, vat: grant.eligibleVat, net: grant.cost, reviewedAllocation: grant } };
}
