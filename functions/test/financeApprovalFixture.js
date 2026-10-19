// Synthetic review evidence for older ledger regression fixtures. Not an
// application helper, not a bypass: postSource still validates every field,
// source/version hash, dated policy and actual posting hash itself.
import { FINANCE_KINDS, financeHash, financeReviewId, financeSourceHash } from '../src/financeReview.js';
import { ADAPTERS } from '../src/posting.js';
import { taxPolicyAt } from '../src/taxPolicy.js';
export async function reviewedFinanceFixture(db, kind, sourceId) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
    || !db.projectId.startsWith('demo-')) throw new Error('Synthetic finance fixtures require a demo emulator.');
  const spec = FINANCE_KINDS[kind]; if (!spec) return;
  if ((await db.doc(`finance_reviews/${financeReviewId(kind, sourceId)}`).get()).exists) return;
  const source = db.collection(spec.collection).doc(sourceId), snap = await source.get(); if (!snap.exists) return;
  const original = snap.data(), amount = original[spec.amount], quantity = original.quantity || 1;
  const unpaid = ['unpaid', 'pending'].includes(original.payment_status);
  const method = unpaid ? 'credit' : original.payment_method || 'cash';
  const row = { is_tax_invoice: false, price_mode: 'inclusive', ...original, supplier: original.supplier ?? 'SYNTHETIC-SUPPLIER',
    quantity, unit_cost: original.unit_cost ?? Number((amount / quantity).toFixed(8)),
    invoice_url: `https://example.org/test-only/${kind}/${sourceId}`, approval_status: 'approved',
    payment_status: unpaid ? 'unpaid' : 'paid', payment_method: method,
    paid_date: unpaid ? null : original.paid_date || original[spec.date] || null,
    vat_deductible: original.is_tax_invoice === true ? original.vat_deductible !== false : false,
    finance_metadata: { purpose: 'SYNTHETIC-REGRESSION', evidenceRefs: ['SYNTHETIC-ORIGINAL'],
      fundingReference: 'SYNTHETIC-FUNDING', fundingType: unpaid ? 'vendor_liability' : method === 'cash' ? 'company_cash' : 'company_bank',
      taxBasis: 'verified_historical_policy', taxReviewRef: 'SYNTHETIC-DATED-POLICY-REVIEW' } };
  row[spec.fk || 'category_id'] ||= `synthetic-${kind}-classification`;
  const classification = db.collection(spec.parent || spec.category).doc(row[spec.fk || 'category_id']);
  if (!(await classification.get()).exists) await classification.set({ name: 'SYNTHETIC', actual_amount: 0 });
  await source.set(row);
  const settings = (await db.doc('app_settings/accounting').get()).data()?.value || {};
  const policyAt = day => taxPolicyAt(day, settings);
  let postingHash = null;
  try { postingHash = financeHash(ADAPTERS[kind].build(row, sourceId, { recordDate: ADAPTERS[kind].dateOf(row), policyAt })); } catch { /* invalid fixtures stay invalid */ }
  await db.doc(`finance_reviews/${financeReviewId(kind, sourceId)}`).set({ sourceId, kind, status: 'approved',
    sourceHash: financeSourceHash(row), postingHash, reviewedByUid: 'SYNTHETIC-REVIEWER', reason: 'SYNTHETIC-REGRESSION-ONLY' });
}
