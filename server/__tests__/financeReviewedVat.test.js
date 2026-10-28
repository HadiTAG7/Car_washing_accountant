import { describe, it, expect } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { financeProblems, financeSourceHash, financeReviewId, assertFinanceApproval } from '../../functions/src/financeReview.js';
import { ADAPTERS } from '../../functions/src/posting.js';
import { ADAPTERS as CLIENT } from '../../src/lib/accounting/sourceAdapters.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { reviewedPartialRow, reviewedPartialSeed, partialSourceId, partialReviewRef } from './financeReviewedVatFixtures.js';
const auth = { uid: 'test-admin' }, kind = 'startup';
const read = db => financeWorkbench(db, auth, { action: 'read', kind, sourceId: partialSourceId });
const policyAt = () => ({ known: true, vatRegistered: true, vatRate: 0.15, effectiveFrom: '2026-05-01' });

describe('reviewed partial VAT source contract', () => {
  it('prices only reviewed eligible 6.75, keeps printed 10.66 and existing 1500 classification; read never writes', async () => {
    const db = memoryFinanceDb(reviewedPartialSeed()), before = structuredClone([...db.rows]);
    const value = await read(db);
    expect([...db.rows]).toEqual(before); expect(value.approvalReady).toBe(true); expect(value.approved).toBe(false);
    expect(value.postingPreview.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: '1500', debit: 75, credit: 0 }),
      expect.objectContaining({ accountId: '1200', debit: 6.75, credit: 0 }),
      expect.objectContaining({ accountId: '1020', debit: 0, credit: 81.75 }),
    ]));
    expect(value.postingPreview.purchaseTaxSnapshot).toMatchObject({ vatAmount: 10.66, documentVat: 10.66, vat: 6.75, net: 75,
      reviewedAllocation: { ref: partialReviewRef, excludedVatInCost: 3.91, returnAction: 'none' } });
    const row = reviewedPartialRow();
    expect(CLIENT.startup.build({ ...row, id: partialSourceId }, { policyAt }).lines)
      .toEqual(ADAPTERS.startup.build(row, partialSourceId, { policyAt }).lines);
  });
  it.each(['source', 'document', 'invoice', 'supplier', 'date', 'amount', 'printed-vat', 'rate', 'mode', 'flag', 'reference', 'allocation-reference', 'unknown', 'full', 'zero', 'excess', 'quantity', 'unit-price', 'line-amount', 'description', 'shared', 'discount'])('blocks changed %s facts on read, approval and direct adapter without journals', async change => {
    const row = reviewedPartialRow(), a = row.finance_metadata.invoiceLines.vatAllocation;
    let id = partialSourceId;
    if (change === 'source') id = 'TEST-OTHER';
    if (change === 'document') row.invoice_url = 'https://example.org/other';
    if (change === 'invoice') row.invoice_number = 'OTHER';
    if (change === 'supplier') row.supplier = 'OTHER';
    if (change === 'date') row.invoice_date = '2026-08-19';
    if (change === 'amount') row.amount = 82;
    if (change === 'printed-vat') row.vat_amount = 11;
    if (change === 'rate') row.vat_rate = 0.05;
    if (change === 'mode') row.price_mode = 'exclusive';
    if (change === 'flag') row.vat_deductible = false;
    if (change === 'reference') row.finance_metadata.taxReviewRef = null;
    if (change === 'allocation-reference') a.reviewRef = 'TEST-UNREVIEWED';
    if (change === 'unknown') a.eligibleVat = null;
    if (change === 'full') a.eligibleVat = 10.66;
    if (change === 'zero') a.eligibleVat = 0;
    if (change === 'excess') a.eligibleVat = 11;
    if (change === 'quantity') row.finance_metadata.invoiceLines.items[1].quantity = 1;
    if (change === 'unit-price') row.finance_metadata.invoiceLines.items[1].unitCost = 15;
    if (change === 'line-amount') row.finance_metadata.invoiceLines.items[1].amount = 29.99;
    if (change === 'description') row.finance_metadata.invoiceLines.items[5].description = 'OTHER';
    if (change === 'shared') row.finance_metadata.invoiceLines.sharedTotal = { amount: 81.75, sourceRef: 'TEST', description: 'TEST' };
    if (change === 'discount') row.finance_metadata.invoiceLines.printedDiscount = { amount: 0.1, sourceRef: 'TEST', description: 'TEST' };
    const db = memoryFinanceDb(reviewedPartialSeed()); db.rows.set(`startup_cost_entries/${id}`, row);
    expect(financeProblems(kind, row, id).length).toBeGreaterThan(0);
    const value = await financeWorkbench(db, auth, { action: 'read', kind, sourceId: id });
    expect(value.approvalReady).toBe(false);
    await expect(financeWorkbench(db, auth, { action: 'approve', kind, sourceId: id, sourceHash: value.sourceHash, postingHash: 'a'.repeat(64), reason: 'TEST reject', confirm: true })).rejects.toThrow();
    expect(() => ADAPTERS.startup.build(row, id, { policyAt })).toThrow();
    expect([...db.rows.keys()].some(key => key.startsWith('journal_entries/'))).toBe(false);
  });
  it('does not use the source grant to bypass dated registration or unknown policy', async () => {
    const row = reviewedPartialRow();
    expect(() => ADAPTERS.startup.build(row, partialSourceId, { policyAt: () => ({ known: true, vatRegistered: false }) })).toThrow(/الخصم الجزئي/);
    expect(() => ADAPTERS.startup.build(row, partialSourceId, { policyAt: () => ({ known: false }) })).toThrow();
  });
  it('binds approval and audit to source/evidence revisions and the server reviewed grant', async () => {
    const db = memoryFinanceDb(reviewedPartialSeed()), value = await read(db);
    const common = { kind, sourceId: partialSourceId, sourceHash: value.sourceHash };
    await financeWorkbench(db, auth, { action: 'approve', ...common, postingHash: value.postingPreview.postingHash, reason: 'TEST separate approval', confirm: true });
    const audit = [...db.rows].find(([key]) => key.startsWith('audit_logs/'))[1];
    expect(audit.sourceEvidence.reviewedPartialVat).toMatchObject({ ref: partialReviewRef, eligibleVat: 6.75 });
    const changed = structuredClone(db.rows.get(`startup_cost_entries/${partialSourceId}`));
    changed.finance_metadata.invoiceLines.items[0].sourceRef = 'TEST changed evidence';
    db.rows.set(`startup_cost_entries/${partialSourceId}`, changed);
    await expect(db.runTransaction(tx => assertFinanceApproval(db, tx, kind, partialSourceId, changed))).rejects.toThrow(/اعتماد/);
    expect(financeSourceHash(changed)).not.toBe(value.sourceHash);
    expect(db.rows.get(`finance_reviews/${financeReviewId(kind, partialSourceId)}`).sourceContextHash).toBeTruthy();
  });
  it('fails closed on a duplicate original under a Drive URL alias', async () => {
    const db = memoryFinanceDb(reviewedPartialSeed());
    db.rows.set('variable_expenses/TEST-DUPLICATE', { invoice_url: 'https://drive.google.com/open?id=1cPMI-VUPp59F1hcq5GCb4zM6pzfT0psv' });
    expect((await read(db)).approvalReady).toBe(false);
  });
});
