import { financeDocumentIdentity } from './financeDocumentIdentity.js';
const sourceId = '8YAyIItUAuqW0XEY4hV7';
const expected = Object.freeze([[3, 30, 103.5], [3, 8, 27.6], [3, 15, 51.75], [1, 15, 17.25]].map(Object.freeze));
export function printedDiscountGrant(kind, id, row) {
  const value = row.finance_metadata?.invoiceLines;
  return kind === 'startup' && id === sourceId && row.amount === 200 && row.invoice_number === '61355'
    && row.invoice_date === '2026-09-15' && row.spent_date === '2026-09-15' && row.supplier === 'شركة كنز الشتاء للمفارش'
    && financeDocumentIdentity(row.invoice_url) === 'drive:1nv-6KBnKbSMvObwtfdjTD9k5jnKrdkqb'
    && row.is_tax_invoice === true && row.vat_deductible === true && row.vat_amount === 26.1 && row.vat_rate === 0.15 && row.price_mode === 'inclusive'
    && value?.version === 1 && value.sharedTotal == null && value.items?.length === 4 && value.printedDiscount?.amount === 0.1
    && value.vatAllocation?.printedVat === 26.1 && value.vatAllocation.eligibleVat === 26.1
    && value.vatAllocation.reviewRef === row.finance_metadata?.taxReviewRef
    && typeof row.finance_metadata?.taxReviewRef === 'string'
    && row.finance_metadata.taxReviewRef.split(';').map(v => v.trim()).includes('TAX-Q3-28-BASE-PARITY-20261015')
    && expected.every(([quantity, unitCost, amount], index) => {
      const line = value.items[index];
      return line?.quantity === quantity && line.unitCost === unitCost && line.amount === amount && line.amountSource === 'printed' && line.unitPriceMode === 'exclusive';
    }) ? Object.freeze({ version: 1, ref: 'PRINTED-61355-DISCOUNT-20261028', sourceId, printedNetSubtotal: 174,
      printedVat: 26.1, printedGrossSubtotal: 200.1, printedDiscount: 0.1, finalGross: 200 }) : null;
}
export function printedDiscountSourceProblems(kind, id, row) {
  return kind === 'startup' && id === sourceId && !printedDiscountGrant(kind, id, row)
    ? ['الفاتورة المراجعة تحتاج بنودها المطبوعة الأربعة وخصم الإجمالي المثبت؛ لا تستبدل أسعارها بمبلغ مشترك أو متوسط.'] : [];
}
