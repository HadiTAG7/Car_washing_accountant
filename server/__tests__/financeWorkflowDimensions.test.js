import { expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench';
import { expensePatch, memoryFinanceDb } from './financeFixtures';

it('returns identical factual dimensions in browse/read while keeping the stored source, tax and blocked approval unchanged', async () => {
  const db = memoryFinanceDb({ 'users/test-admin': { role: 'admin' }, 'variable_expense_categories/test-category': {} });
  const auth = { uid: 'test-admin' }, request = { kind: 'variable', requestId: 'TEST-SAVED-PENDING', patch: expensePatch({
    description: 'TEST saved pending review', amount: 12, quantity: 2, date: '2026-10-03', invoiceDate: '2026-10-03', paymentStatus: 'paid', paymentMethod: 'card', paidDate: '2026-10-03',
    fundingType: 'employee', fundingReference: 'TEST owner-prefunded employee evidence', isTaxInvoice: true, invoiceNumber: null,
    vatDeductible: false, vatAmount: 1.57, vatRate: 0.15, taxReviewRef: 'TEST-TAX-OPINION' }) };
  const preview = await financeWorkbench(db, auth, { ...request, action: 'previewCapture' });
  const captured = await financeWorkbench(db, auth, { ...request, action: 'capture', previewHash: preview.previewHash, reason: 'TEST isolated capture', confirm: true });
  const storedBefore = structuredClone([...db.rows]), read = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: captured.sourceId });
  const browse = await financeWorkbench(db, auth, { action: 'browse' });
  expect(browse.items[0].workflowDimensions).toEqual(read.workflowDimensions);
  expect(read.workflowStage).toBe('incomplete'); expect(read.approvalReady).toBe(false); expect(read.postingReady).toBe(false);
  expect(read.workflowDimensions).toMatchObject({ registration: { status: 'recorded' }, details: { saved: true }, review: { status: 'saved_pending' }, approval: { current: false }, sourceGaps: [] });
  expect(read.workflowDimensions.postingBlockers.map(item => item.category)).toEqual(['funding', 'tax']);
  expect(read.row).toMatchObject({ is_tax_invoice: true, vat_deductible: false, invoice_number: null, finance_metadata: { fundingType: 'employee' } });
  expect([...db.rows]).toEqual(storedBefore);
  await expect(financeWorkbench(db, auth, { action: 'approve', kind: 'variable', sourceId: read.sourceId, sourceHash: read.sourceHash,
    postingHash: 'a'.repeat(64), reason: 'TEST refused approval', confirm: true })).rejects.toThrow();
  expect([...db.rows]).toEqual(storedBefore);
  const listed = await financeWorkbench(db, auth, { action: 'list', kind: 'variable' });
  expect(listed.items[0].registration.status).toBe('recorded');
});
