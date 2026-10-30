import { describe, it, expect } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { financeProblems, financeSourceHash, assertFinanceApproval } from '../../functions/src/financeReview.js';
import { ADAPTERS } from '../../functions/src/posting.js';
import { ADAPTERS as CLIENT } from '../../src/lib/accounting/sourceAdapters.js';
import { invoiceLinesShapeIssues, invoiceLinesSubtotal, invoiceLinesTotal } from '../../functions/src/financeInvoiceLines.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { identitySources, identityEvidence, identityRow, identitySeed, discountedSourceId, printedDiscountRow } from './financeReviewedIdentityFixtures.js';
const auth = { uid: 'test-admin' }, policyAt = () => ({ known: true, vatRegistered: true, vatRate: 0.15 });
const call = (db, input) => financeWorkbench(db, auth, input);

describe('bounded reviewed identities and printed invoice-level discount', () => {
  it.each(identitySources.map((source, index) => [source[0], index]))('offers but never auto-applies identity for %s; preserves funding blockers and raw tax facts', async (sourceId, index) => {
    const db = memoryFinanceDb(identitySeed()), common = { kind: 'variable', sourceId }, beforeRows = structuredClone([...db.rows]);
    const before = await call(db, { action: 'read', ...common });
    expect([...db.rows]).toEqual(beforeRows); expect(before.row.invoice_number).toBeNull(); expect(before.sourceContext.reviewedIdentityGrant).toBeTruthy();
    expect(before.row.finance_metadata.reviewedDocumentIdentity).toBeUndefined(); expect(before.approvalReady).toBe(false);
    const patch = { reviewedDocumentIdentity: identityEvidence(sourceId) }, preview = await call(db, { action: 'preview', ...common, sourceHash: before.sourceHash, patch });
    expect([...db.rows]).toEqual(beforeRows); // «دفع موظف» settles on that employee's custody, once he is named.
    expect(preview.issues.some(issue => issue.includes('الموظف الذي دفع غير محدد'))).toBe(true);
    expect(preview.issues.some(issue => issue.includes('حقول الفاتورة'))).toBe(false);
    await call(db, { action: 'save', ...common, sourceHash: before.sourceHash, patch, previewHash: preview.previewHash, reason: 'TEST link existing reviewed identity only', confirm: true });
    const after = await call(db, { action: 'read', ...common });
    expect(after.row).toMatchObject({ invoice_number: null, is_tax_invoice: true, vat_deductible: identitySources[index][5], vat_amount: identitySources[index][4] });
    expect(after.row.finance_metadata.fundingType).toBe('employee'); expect(after.approvalReady).toBe(false);
    expect(after.sourceContext.verifiedIdentity).toMatchObject({ sourceId, returnAction: 'none' });
    expect([...db.rows.keys()].some(key => key.startsWith('journal_entries/'))).toBe(false);
  });
  it.each(identitySources.map((source, index) => [source[0], index]))('uses %s only when other controls pass, matches client and does not create a claim', async (sourceId, index) => {
    const db = memoryFinanceDb(identitySeed('test-admin', { linked: true, funded: true })), value = await call(db, { action: 'read', kind: 'variable', sourceId });
    expect(value.approvalReady).toBe(true); expect(value.approved).toBe(false);
    const vat = index ? identitySources[index][4] : 0, amount = identitySources[index][1];
    expect(value.postingPreview.lines.find(line => line.accountId === '5100').debit).toBe(Math.round((amount - vat) * 100) / 100);
    expect(value.postingPreview.lines.find(line => line.accountId === '1200')?.debit || 0).toBe(vat);
    expect(value.postingPreview.purchaseTaxSnapshot.invoiceNumber).toBeNull();
    expect(CLIENT.variable.build({ ...identityRow(index, { linked: true, funded: true }), id: sourceId }, { policyAt }).lines)
      .toEqual(ADAPTERS.variable.build(identityRow(index, { linked: true, funded: true }), sourceId, { policyAt }).lines);
    expect([...db.rows.keys()].some(key => /journal_entries|vat_returns|tax_claim/.test(key))).toBe(false);
  });
  it.each(['source', 'amount', 'document', 'supplier', 'date', 'number', 'tax-flag', 'deduction-flag', 'vat', 'rate', 'review', 'evidence', 'grant'])('rejects wrong %s identity facts without bypassing approval', async changed => {
    const row = identityRow(1, { linked: true, funded: true }); let sourceId = identitySources[1][0];
    if (changed === 'source') sourceId = 'TEST-OTHER';
    if (changed === 'amount') row.total_variable_cost = 31;
    if (changed === 'document') row.invoice_url = 'https://example.org/other';
    if (changed === 'supplier') row.supplier = 'TEST OTHER';
    if (changed === 'date') row.invoice_date = '2026-09-20';
    if (changed === 'number') row.invoice_number = 'Invented';
    if (changed === 'tax-flag') row.is_tax_invoice = false;
    if (changed === 'deduction-flag') row.vat_deductible = false;
    if (changed === 'vat') row.vat_amount = 4;
    if (changed === 'rate') row.vat_rate = 0.05;
    if (changed === 'review') row.finance_metadata.taxReviewRef = 'fake-TAX-Q3-28-BASE-PARITY-20261015-other';
    if (changed === 'evidence') row.finance_metadata.reviewedDocumentIdentity.sourceRef = '';
    if (changed === 'grant') row.finance_metadata.reviewedDocumentIdentity.grantRef = 'OTHER';
    expect(financeProblems('variable', row, sourceId).length).toBeGreaterThan(0);
    expect(() => ADAPTERS.variable.build(row, sourceId, { policyAt })).toThrow();
  });
  it('blocks a duplicate Drive alias and leaves unknown historical registration unresolved', async () => {
    const db = memoryFinanceDb(identitySeed('test-admin', { linked: true, funded: true })), [sourceId, , driveId] = identitySources[1];
    db.rows.set('monthly_expenses/TEST-ALIAS', { invoice_url: `https://drive.google.com/open?id=${driveId}` });
    expect((await call(db, { action: 'read', kind: 'variable', sourceId })).approvalReady).toBe(false);
    expect(() => ADAPTERS.variable.build(identityRow(1, { linked: true, funded: true }), sourceId, { policyAt: () => ({ known: false }) })).toThrow();
  });
  it('binds identity evidence to approval, including changes that leave amounts unchanged', async () => {
    const db = memoryFinanceDb(identitySeed('test-admin', { linked: true, funded: true })), sourceId = identitySources[1][0];
    const before = await call(db, { action: 'read', kind: 'variable', sourceId });
    await call(db, { action: 'approve', kind: 'variable', sourceId, sourceHash: before.sourceHash, postingHash: before.postingPreview.postingHash, reason: 'TEST separate approval', confirm: true });
    const row = structuredClone(db.rows.get(`variable_expenses/${sourceId}`)); row.finance_metadata.reviewedDocumentIdentity.sourceRef = 'TEST changed reference';
    expect(financeSourceHash(row)).not.toBe(before.sourceHash);
    await expect(db.runTransaction(tx => assertFinanceApproval(db, tx, 'variable', sourceId, row))).rejects.toThrow(/اعتماد/);
  });
  it('deducts printed 0.10 once from 200.10, preserves all prices and VAT, and retains the existing adapter totals', async () => {
    const row = printedDiscountRow(), lines = row.finance_metadata.invoiceLines, before = structuredClone(lines);
    expect(invoiceLinesShapeIssues(lines)).toEqual([]); expect(invoiceLinesSubtotal(lines)).toBe(200.1); expect(invoiceLinesTotal(lines)).toBe(200);
    expect(lines.items.map(item => [item.quantity, item.unitCost, item.amount])).toEqual([[3, 30, 103.5], [3, 8, 27.6], [3, 15, 51.75], [1, 15, 17.25]]);
    const db = memoryFinanceDb({ ...identitySeed(), 'startup_costs/test-parent': { actual_amount: 200, budgeted_amount: 1000 }, [`startup_cost_entries/${discountedSourceId}`]: row });
    const read = await call(db, { action: 'read', kind: 'startup', sourceId: discountedSourceId });
    expect(read.issues.some(issue => issue.includes('الحساب المقابل'))).toBe(true); expect(read.issues.some(issue => issue.includes('مجموع بنود'))).toBe(false);
    const built = ADAPTERS.startup.build(row, discountedSourceId, { policyAt });
    expect(built.lines.find(line => line.accountId === '1500').debit).toBe(173.9);
    expect(built.lines.find(line => line.accountId === '1200').debit).toBe(26.1);
    expect(built.lines.find(line => line.credit)?.credit).toBe(200); expect(lines).toEqual(before);
    expect(CLIENT.startup.build({ ...row, id: discountedSourceId }, { policyAt }).lines).toEqual(built.lines);
  });
  it.each(['no-evidence', 'negative', 'zero', 'exceeds', 'shared', 'unknown-key', 'price-erased'])('refuses %s printed discounts without changing source amounts', failure => {
    const row = printedDiscountRow(), value = row.finance_metadata.invoiceLines;
    if (failure === 'no-evidence') value.printedDiscount.sourceRef = '';
    if (failure === 'negative') value.printedDiscount.amount = -0.1;
    if (failure === 'zero') value.printedDiscount.amount = 0;
    if (failure === 'exceeds') value.printedDiscount.amount = 200.1;
    if (failure === 'shared') value.sharedTotal = { amount: 200, description: 'TEST', sourceRef: 'TEST' };
    if (failure === 'unknown-key') value.printedDiscount.accountId = '1200';
    if (failure === 'price-erased') value.items[0].unitCost = null;
    expect(invoiceLinesShapeIssues(value).length).toBeGreaterThan(0); expect(financeProblems('startup', row, discountedSourceId).length).toBeGreaterThan(0);
    expect(row.amount).toBe(200); expect(row.vat_amount).toBe(26.1);
  });
});
