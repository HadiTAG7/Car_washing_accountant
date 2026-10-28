import { financeWorkbench } from '../financeWorkbench.js';

// All rows are synthetic. Fixed IDs/receipt identities exercise the deliberately
// bounded released grants; these values never write to a remote database.
export const exceptionSources = [
  ['I8tWV7ElQXRMW3AFMqBI', 20, '1WH9-Z520CqraEKyRnh7zJ1iEYLwhGDVN'],
  ['kowTpQdTgaLUCfhtzRQ4', 150, '1rDK0CUU83cIE5YW4N7XDaYRIt47Iwp55'],
];
export const allocationSources = ['xm8IA2ypXnQvQ7LFLPTy', 'zk0wmq8nHTbsgs9CteWd'];
export const originalUrl = 'https://drive.google.com/file/d/1kXBQUqAPostNYJ6c9myt3CqBwKKFRM_k/view';
export function evidenceRow(amount, invoiceUrl, overrides = {}) {
  return { description: 'TEST synthetic source, not a reconstructed invoice', amount, spent_date: '2026-10-18', quantity: 2, unit_cost: amount / 2,
    supplier: 'TEST supplier', invoice_url: invoiceUrl, startup_cost_id: 'test-parent', price_mode: 'inclusive', is_tax_invoice: false, vat_deductible: false,
    payment_status: 'unpaid', payment_method: 'credit', finance_metadata: { fundingType: 'vendor_liability', fundingReference: 'TEST debt', purpose: 'TEST isolated only', evidenceRefs: ['TEST evidence'] }, ...overrides };
}
export function evidenceSeed() {
  return { 'users/test-admin': { role: 'admin' }, 'startup_costs/test-parent': { budgeted_amount: 1000, actual_amount: 280 },
    'chart_of_accounts/1500': {}, 'chart_of_accounts/2000': {}, 'app_settings/accounting': { value: { vatRegistered: false } },
    ...Object.fromEntries(exceptionSources.map(([id, amount, document]) => [`startup_cost_entries/${id}`, evidenceRow(amount, `https://drive.google.com/file/d/${document}/view`)])),
    ...Object.fromEntries(allocationSources.map((id, index) => [`startup_cost_entries/${id}`, evidenceRow(index ? 80 : 200, originalUrl)])) };
}
const auth = { uid: 'test-admin' }, kind = 'startup';
export const evidenceCall = (db, input) => financeWorkbench(db, auth, { kind, ...input });
export async function saveEvidence(db, sourceId, patch) {
  const read = await evidenceCall(db, { action: 'read', sourceId });
  const request = { sourceId, sourceHash: read.sourceHash, patch };
  const preview = await evidenceCall(db, { action: 'preview', ...request });
  await evidenceCall(db, { action: 'save', ...request, previewHash: preview.previewHash, reason: 'TEST isolated evidence review', confirm: true });
  return { preview, read: await evidenceCall(db, { action: 'read', sourceId }) };
}
export async function linkAllocation(db) {
  for (const sourceId of allocationSources) {
    const read = await evidenceCall(db, { action: 'read', sourceId });
    await saveEvidence(db, sourceId, { documentAllocation: { version: 1, grantRef: read.sourceContext.allocationGrant.ref, sourceRef: 'TEST reviewed printed rows' } });
  }
}
export async function approveEvidence(db, sourceId) {
  const read = await evidenceCall(db, { action: 'read', sourceId });
  return evidenceCall(db, { action: 'approve', sourceId, sourceHash: read.sourceHash, postingHash: read.postingPreview.postingHash, reason: 'TEST separate approval', confirm: true });
}
