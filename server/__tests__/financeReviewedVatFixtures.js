import { syntheticPrintedInvoiceLines } from './financeFixtures.js';
export const partialSourceId = 'c790RQ8Dk5q8RoX3K3dO';
export const partialReviewRef = 'TAX-HOUSING39-PARTIAL-20261026';
// Isolated fixture uses the bounded source facts to exercise the grant. It is
// never uploaded, reconstructed or saved to a production source.
export function reviewedPartialRow() {
  const invoiceLines = syntheticPrintedInvoiceLines(partialReviewRef);
  const descriptions = ['ملاعق', 'ملابس', 'أكواب', 'مناديل', 'ولاعة غاز', 'طقم مفكات', 'صحن تقديم'];
  invoiceLines.items.forEach((line, index) => { line.description = descriptions[index]; });
  return { description: 'TEST isolated reviewed allocation', amount: 81.75, spent_date: '2026-08-18',
    startup_cost_id: 'test-parent', quantity: null, unit_cost: null, supplier: 'شركة سلم التوفير للتجارة',
    invoice_number: '21110110175500', invoice_date: '2026-08-18', invoice_url: 'https://drive.google.com/file/d/1cPMI-VUPp59F1hcq5GCb4zM6pzfT0psv/view',
    is_tax_invoice: true, vat_deductible: true, vat_amount: 10.66, vat_rate: 0.15, price_mode: 'inclusive',
    payment_status: 'paid', payment_method: 'card', paid_date: '2026-08-18', approval_status: 'pending',
    finance_metadata: { invoiceLines, taxReviewRef: partialReviewRef, taxBasis: 'document', fundingType: 'company_bank',
      fundingReference: 'TEST confirmed bank', evidenceRefs: ['TEST reviewed original'], purpose: 'TEST isolated only' } };
}
export function reviewedPartialSeed(uid = 'test-admin') {
  return { [`users/${uid}`]: { role: 'admin' }, [`startup_cost_entries/${partialSourceId}`]: reviewedPartialRow(),
    'startup_costs/test-parent': { actual_amount: 81.75, budgeted_amount: 1000 },
    'app_settings/accounting': { value: { vatRegistered: true } },
    ...Object.fromEntries(['1500', '1200', '1020', '2000'].map(code => [`chart_of_accounts/${code}`, { code, active: true, accountType: code === '2000' ? 'liability' : 'asset' }])) };
}
