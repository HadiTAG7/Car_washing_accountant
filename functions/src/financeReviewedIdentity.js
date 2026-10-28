import { financeDocumentIdentity } from './financeDocumentIdentity.js';

// Existing documentary opinion, not a general exemption for missing invoice
// numbers or a new VAT claim. These source facts must remain unchanged.
const review = 'TAX-53-SOURCE-OPINION-20261026';
const grants = Object.freeze([
  ['ABdYfrGUUZ0ywAsy2UQg', 12, '1qbMWbCxmHir7ayPoF2FnHO2HX312zoyo', '2026-10-03', 1.57, false,
    'شركة عربة التجارية — TROLLEY، فرع Tahlia - Elite Hosp - SA', 'TAX-Q3-EXTRA6-20261014'],
  ['LKKDvPXXwkUB2LhGiv6h', 30, '1YkzCTIYShBeSHA_fSlqTdKnqPQ2Rmmhr', '2026-09-19', 3.91, true,
    "King Khaled Int'l Airport — مواقف مطار الملك خالد", 'TAX-Q3-28-BASE-PARITY-20261015'],
  ['var_inv85_2026-09-14', 10, '1W04PB4SfN5WLELqax6drEmj7XZjiiwjK', '2026-09-14', 1.3, true,
    'مواقف مطار الملك خالد الدولي', 'TAX-Q3-28-BASE-PARITY-20261015'],
  ['z071wqebTaGVyoueH9FO', 20, '1rjeGOpaKJjRqlTb8jGFdDGT_Pg-I5D5K', '2026-09-29', 2.61, true,
    "King Khaled Int'l Airport", 'TAX-Q3-28-BASE-PARITY-20261015'],
].map(([sourceId, amount, document, invoiceDate, printedVat, vatDeductible, supplier, priorReview]) => Object.freeze({
  version: 1, ref: `${review}:${sourceId}`, opinionRef: review, kind: 'variable', sourceId, amount,
  document: `drive:${document}`, invoiceDate, printedVat, vatDeductible, supplier, priorReview,
  vatRate: 0.15, priceMode: 'inclusive', returnAction: 'none',
})));
export function reviewedIdentityGrant(kind, sourceId, row) {
  return grants.find(grant => grant.kind === kind && grant.sourceId === sourceId
    && row.total_variable_cost === grant.amount && financeDocumentIdentity(row.invoice_url) === grant.document
    && row.invoice_date === grant.invoiceDate && row.supplier === grant.supplier && (row.invoice_number == null || row.invoice_number === '')
    && row.is_tax_invoice === true && row.vat_deductible === grant.vatDeductible && row.vat_amount === grant.printedVat
    && row.vat_rate === grant.vatRate && row.price_mode === grant.priceMode
    && typeof row.finance_metadata?.taxReviewRef === 'string'
    && row.finance_metadata.taxReviewRef.split(';').map(value => value.trim()).includes(grant.priorReview)) || null;
}
export function verifiedReviewedIdentity(kind, sourceId, row) {
  const evidence = row.finance_metadata?.reviewedDocumentIdentity, grant = reviewedIdentityGrant(kind, sourceId, row);
  return grant && evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    && Object.keys(evidence).every(key => ['version', 'grantRef', 'sourceRef'].includes(key)) && evidence.version === 1
    && evidence.grantRef === grant.ref && typeof evidence.sourceRef === 'string' && evidence.sourceRef.trim().length > 0 && evidence.sourceRef.length <= 300
    ? grant : null;
}
export function applyReviewedIdentity(kind, sourceId, row, tax, policyAt) {
  if (row.finance_metadata?.reviewedDocumentIdentity == null) return tax;
  const grant = verifiedReviewedIdentity(kind, sourceId, row);
  if (!grant) throw new Error('هوية المستند المراجعة لا تطابق المصدر والرأي والحقائق المثبتة.');
  const proof = { ...grant, invoiceNumber: null };
  if (!row.vat_deductible) return { ...tax, snapshot: { ...tax.snapshot, reviewedDocumentIdentity: proof } };
  // The old engine's only missing fact must be the absent printed number.
  // Registration is still resolved from its dated policy, never this grant.
  const policy = policyAt?.(row.invoice_date);
  if (!policy?.known || policy.vatRegistered !== true) throw new Error('يلزم حسم سياسة التسجيل بتاريخ المستند قبل خصم المدخلات.');
  if (tax.noInputVatReason !== 'incomplete-invoice' || tax.missing?.length !== 1 || tax.missing[0] !== 'رقم الفاتورة'
    || tax.documentVat !== grant.printedVat || tax.gross !== grant.amount) throw new Error('هوية المستند المراجعة لا تستثني نقصًا آخر أو تغيرًا في المبالغ.');
  const net = Math.round((tax.gross - grant.printedVat) * 100) / 100;
  return { ...tax, net, vat: grant.printedVat, deductible: true, noInputVatReason: null, missing: [],
    snapshot: { ...tax.snapshot, net, vat: grant.printedVat, deductible: true, noInputVatReason: null, reviewedDocumentIdentity: proof } };
}
