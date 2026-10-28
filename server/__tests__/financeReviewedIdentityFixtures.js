export const identitySources = [
  ['ABdYfrGUUZ0ywAsy2UQg', 12, '1qbMWbCxmHir7ayPoF2FnHO2HX312zoyo', '2026-10-03', 1.57, false, 'شركة عربة التجارية — TROLLEY، فرع Tahlia - Elite Hosp - SA', 'TAX-Q3-EXTRA6-20261014'],
  ['LKKDvPXXwkUB2LhGiv6h', 30, '1YkzCTIYShBeSHA_fSlqTdKnqPQ2Rmmhr', '2026-09-19', 3.91, true, "King Khaled Int'l Airport — مواقف مطار الملك خالد", 'TAX-Q3-28-BASE-PARITY-20261015'],
  ['var_inv85_2026-09-14', 10, '1W04PB4SfN5WLELqax6drEmj7XZjiiwjK', '2026-09-14', 1.3, true, 'مواقف مطار الملك خالد الدولي', 'TAX-Q3-28-BASE-PARITY-20261015'],
  ['z071wqebTaGVyoueH9FO', 20, '1rjeGOpaKJjRqlTb8jGFdDGT_Pg-I5D5K', '2026-09-29', 2.61, true, "King Khaled Int'l Airport", 'TAX-Q3-28-BASE-PARITY-20261015'],
];
export const identityEvidence = id => ({ version: 1, grantRef: `TAX-53-SOURCE-OPINION-20261026:${id}`, sourceRef: 'TEST reviewed existing document evidence' });
export function identityRow(index, { linked = false, funded = false } = {}) {
  const [id, amount, document, date, vat, deductible, supplier, reference] = identitySources[index];
  return { expense_name: 'TEST isolated identity', total_variable_cost: amount, logged_date: date, quantity: index ? 1 : 2, unit_cost: index ? amount : 6,
    category_id: 'test-category', supplier, invoice_url: `https://drive.google.com/file/d/${document}/view`, invoice_number: null, invoice_date: date,
    is_tax_invoice: true, vat_deductible: deductible, vat_amount: vat, vat_rate: 0.15, price_mode: 'inclusive',
    payment_status: 'paid', payment_method: 'card', paid_date: date, approval_status: 'pending',
    finance_metadata: { fundingType: funded ? 'company_bank' : 'employee', fundingReference: 'TEST confirmed evidence', purpose: 'TEST isolated source only',
      evidenceRefs: ['TEST original'], taxReviewRef: `TEST;${reference}`, ...(linked ? { reviewedDocumentIdentity: identityEvidence(id) } : {}) } };
}
export function identitySeed(uid = 'test-admin', options) {
  return { [`users/${uid}`]: { role: 'admin' }, 'variable_expense_categories/test-category': {},
    'app_settings/accounting': { value: { vatRegistered: true } },
    ...Object.fromEntries(['5100', '1200', '1020', '2000', '1500'].map(code => [`chart_of_accounts/${code}`, { code, active: true, accountType: code === '2000' ? 'liability' : code === '5100' ? 'expense' : 'asset' }])),
    ...Object.fromEntries(identitySources.map(([id], index) => [`variable_expenses/${id}`, identityRow(index, options)])) };
}
export const discountedSourceId = '8YAyIItUAuqW0XEY4hV7';
export function printedDiscountRow({ funded = false } = {}) {
  const reviewRef = 'TEST;TAX-Q3-28-BASE-PARITY-20261015';
  return { description: 'TEST isolated printed discount', amount: 200, spent_date: '2026-09-15', startup_cost_id: 'test-parent',
    quantity: null, unit_cost: null, supplier: 'شركة كنز الشتاء للمفارش', invoice_number: '61355', invoice_date: '2026-09-15',
    invoice_url: 'https://drive.google.com/file/d/1nv-6KBnKbSMvObwtfdjTD9k5jnKrdkqb/view', is_tax_invoice: true, vat_deductible: true,
    vat_amount: 26.1, vat_rate: 0.15, price_mode: 'inclusive', payment_status: 'paid', payment_method: 'cash', paid_date: '2026-09-15', approval_status: 'pending',
    finance_metadata: { fundingType: funded ? 'company_cash' : 'unknown', fundingReference: 'TEST isolated source evidence', purpose: 'TEST isolated only', evidenceRefs: ['TEST original'], taxReviewRef: reviewRef,
      invoiceLines: { version: 1, items: [[3, 30, 103.5], [3, 8, 27.6], [3, 15, 51.75], [1, 15, 17.25]].map(([quantity, unitCost, amount], index) => ({
        id: `printed-${index + 1}`, description: `TEST printed item ${index + 1}`, quantity, unitCost, amount, unit: 'TEST unit', sourceRef: `TEST printed row ${index + 1}`,
        amountSource: 'printed', unitPriceMode: 'exclusive', amountNote: 'TEST net unit / gross line, unchanged source rounding' })),
      vatAllocation: { printedVat: 26.1, eligibleVat: 26.1, reviewRef },
      printedDiscount: { amount: 0.1, description: 'TEST printed Extra Dis', sourceRef: 'TEST invoice-level discount' } } } };
}
