import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { financeWorkbench } from '../financeWorkbench.js';
import { custodySettlementManifestHash } from '../custodyHistoricalSettlement.js';
import { postSource, reverseEntry } from '../../functions/src/ledger.js';
import { calculatePayrollPreview } from '../../functions/src/payroll.js';
import { expensePatch, memoryFinanceDb } from './financeFixtures.js';
import { financeHash } from '../../functions/src/financeReview.js';

const auth = { uid: 'synthetic-admin' };
const postingDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date());
const priorPostingDay = new Date(`${postingDay}T00:00:00Z`);
priorPostingDay.setUTCDate(priorPostingDay.getUTCDate() - 1);
const priorDay = priorPostingDay.toISOString().slice(0, 10);
const previewBase = { action: 'preview', kind: 'custody_reconciliation', advanceId: 'synthetic-advance',
  employeeId: 'synthetic-worker', amount: 100, historicalFundingDate: '2026-10-17',
  correctionDate: postingDay, ownerStatementRef: 'TEST owner statement',
  evidenceRefs: ['TEST transfer evidence'] };

async function setup({ tax = false } = {}) {
  const db = memoryFinanceDb({
    'users/synthetic-admin': { role: 'admin' },
    'temporary_expenses/synthetic-advance': { biker_id: 'synthetic-worker', amount: 150,
      status: 'pending', recovered_amount: 0, spent_date: '2026-10-17' },
    'app_settings/accounting': { value: { vatRegistered: tax } },
    'variable_expense_categories/synthetic-category': { name: 'Synthetic category' },
    [`accounting_periods/${postingDay.slice(0, 7)}`]: { status: 'open' },
    'counters/journal': { nextNumber: 1 },
    'chart_of_accounts/1020': { active: true, accountType: 'asset' },
    'chart_of_accounts/1300': { active: true, accountType: 'asset' },
    'chart_of_accounts/2000': { active: true, accountType: 'liability' },
    'chart_of_accounts/5100': { active: true, accountType: 'expense' },
    'chart_of_accounts/1200': { active: true, accountType: 'asset' },
  });
  const request = { action: 'previewCapture', kind: 'variable', requestId: 'synthetic-document',
    patch: expensePatch({ amount: 100, quantity: 1, categoryId: 'synthetic-category',
      ...(tax ? { date: '2026-09-18', invoiceDate: '2026-09-18', paidDate: '2026-09-18' } : {}),
      invoiceNumber: 'TEST-DOC-1', invoiceUrl: 'https://example.org/synthetic-custody',
      paymentStatus: 'paid', paymentMethod: 'card', ...(!tax ? { paidDate: '2026-10-18' } : {}),
      fundingType: 'employee', fundingReference: 'TEST supplier receipt',
      ...(tax ? { isTaxInvoice: true, vatDeductible: true, vatAmount: 13.04,
        vatRate: 0.15, taxReviewRef: 'TEST historical tax opinion' } : {}) }) };
  const draft = await financeWorkbench(db, auth, request);
  const captured = await financeWorkbench(db, auth, { ...request, action: 'capture',
    previewHash: draft.previewHash, reason: 'Synthetic document', confirm: true });
  const input = { ...previewBase, ...(tax ? { historicalFundingDate: '2026-09-17' } : {}),
    allocations: [{ kind: 'variable', sourceId: captured.sourceId, amount: 100 }] };
  const preview = await financeWorkbench(db, auth, input);
  const save = { ...input, action: 'save', previewHash: preview.snapshotHash,
    ownerApprovalRef: 'TEST approved manifest', evidenceReviewRef: 'TEST transfer review',
    ledgerReviewRef: 'TEST all journal review', reviewedUnrelatedJournalIds: preview.unassignedAdvanceMovementIds,
    priorClaims: tax ? [{ kind: 'variable', sourceId: captured.sourceId, submittedPeriod: '2026-Q3',
      sourceTaxReviewRef: 'TEST historical tax opinion', evidenceRef: 'TEST filed return' }] : [],
    reason: 'Synthetic isolated settlement', confirm: true };
  process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(save);
  return { db, input, preview, save, sourceId: captured.sourceId };
}
const financial = db => [...db.rows].filter(([key]) => /^(journal_entries|posting_locks|temporary_expenses|finance_workbench_receipts)\//.test(key));

describe('atomic historical custody settlement, synthetic only', () => {
  beforeEach(() => { process.env.ENABLE_CUSTODY_HISTORICAL_SETTLEMENT = '1'; });
  afterEach(() => {
    delete process.env.ENABLE_CUSTODY_HISTORICAL_SETTLEMENT;
    delete process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH;
  });

  it('posts an exactly consumed current-dated slice once and verifies read/browse', async () => {
    const { db, save, sourceId } = await setup();
    const [first, replay] = await Promise.all([financeWorkbench(db, auth, save), financeWorkbench(db, auth, save)]);
    expect(first).toMatchObject({ saved: true, fundedHalala: 10000, consumedHalala: 10000,
      freeAdvanceBalanceHalala: 0, entryDate: postingDay });
    expect(replay).toMatchObject({ groupId: first.groupId, replay: true });
    const entries = [...db.rows].filter(([key]) => key.startsWith('journal_entries/')).map(([, entry]) => entry);
    expect(entries).toHaveLength(2);
    expect(entries.every(entry => entry.entryDate === postingDay)).toBe(true);
    expect(entries.reduce((sum, entry) => sum + entry.lines.filter(line => line.accountId === '1300')
      .reduce((n, line) => n + line.debit - line.credit, 0), 0)).toBe(0);
    const read = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId });
    const browse = (await financeWorkbench(db, auth, { action: 'browse' })).items.find(item => item.sourceId === sourceId);
    expect(read).toMatchObject({ workflowStage: 'complete', paymentProven: true,
      historicalSettlementProof: { receiptVerified: true } });
    expect(browse).toMatchObject({ workflowStage: 'complete', paymentStatus: 'paid' });
    expect(read.workflowDimensions.funding.ledgerMatched).toBe(true);
    expect(db.rows.get('temporary_expenses/synthetic-advance')).toMatchObject({ custody_historical_partial_hold: true });
    await expect(reverseEntry(db, FieldValue, first.journalIds[0],
      { entryDate: postingDay, userId: auth.uid })).rejects.toThrow(/لا يُعكس منفردًا/);
    db.rows.get('temporary_expenses/synthetic-advance').status = 'recovered';
    db.rows.get('temporary_expenses/synthetic-advance').recovered_date = postingDay;
    await expect(postSource(db, FieldValue, { kind: 'recovery', sourceId: 'synthetic-advance' },
      { userId: auth.uid })).rejects.toThrow(/تسوية جزئية/);
    const payroll = calculatePayrollPreview({ periodKey: '2026-10',
      bikers: [{ id: 'synthetic-worker', name: 'TEST worker', salary: 500, start_date: '2026-10-01' }],
      advances: [{ id: 'synthetic-advance', ...db.rows.get('temporary_expenses/synthetic-advance') }] });
    expect(payroll.lines[0].advanceDeduction).toBe(0);
    expect(payroll.lines[0].custodyAdvanceHoldReason).toMatch(/لا تخصم تلقائيًا/);
    const unrelatedPayroll = calculatePayrollPreview({ periodKey: '2026-10',
      bikers: [{ id: 'TEST unrelated worker', name: 'TEST other worker', salary: 500, start_date: '2026-10-01' }],
      advances: [{ id: 'synthetic-advance', ...db.rows.get('temporary_expenses/synthetic-advance') }] });
    expect(unrelatedPayroll.lines[0].custodyAdvanceHeld).toBe(false);
  });

  it('requires an exact server-approved manifest before any financial write', async () => {
    const { db, save } = await setup();
    const before = financial(db);
    delete process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH;
    await expect(financeWorkbench(db, auth, save)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(financial(db)).toEqual(before);
  });

  it('rejects a new correction dated before the actual posting day even with an approved preview', async () => {
    const { db, input, save } = await setup();
    const backdated = { ...input, correctionDate: priorDay };
    const preview = await financeWorkbench(db, auth, backdated);
    const request = { ...save, correctionDate: backdated.correctionDate, previewHash: preview.snapshotHash };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(request);
    const before = financial(db);
    await expect(financeWorkbench(db, auth, request)).rejects.toThrow(/يوم الترحيل الحالي/);
    expect(financial(db)).toEqual(before);
  });

  it('seals an independent tranche for a documented beneficiary without inventing an advance or employee ID', async () => {
    const { db, sourceId } = await setup();
    const input = { action: 'preview', kind: 'custody_reconciliation',
      beneficiary: { name: 'TEST beneficiary', sourceRef: 'TEST identity record' },
      amount: 100, correctionDate: postingDay, ownerStatementRef: 'TEST owner statement',
      evidenceRefs: ['TEST deposit row A', 'TEST deposit row B'],
      fundingEvidence: [
        { depositRowId: 'test-row-a', evidenceRef: 'TEST deposit row A', deliveryDate: '2026-10-16',
          depositAmount: 150, allocatedAmount: 60 },
        { depositRowId: 'test-row-b', evidenceRef: 'TEST deposit row B', deliveryDate: '2026-10-17',
          depositAmount: 100, allocatedAmount: 40 },
      ],
      allocations: [{ kind: 'variable', sourceId, amount: 100,
        allocationDecisionRef: 'TEST reviewed allocation', fundingParts: [
          { depositRowId: 'test-row-a', amount: 60 }, { depositRowId: 'test-row-b', amount: 40 },
        ] }],
    };
    const preview = await financeWorkbench(db, auth, input);
    expect(preview.blockingIssues).toEqual([]);
    const save = { ...input, action: 'save', previewHash: preview.snapshotHash,
      ownerApprovalRef: 'TEST exact approval', evidenceReviewRef: 'TEST transfer review',
      ledgerReviewRef: 'TEST ledger review', reviewedUnrelatedJournalIds: [],
      priorClaims: [], reason: 'TEST isolated settlement', confirm: true };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(save);
    const result = await financeWorkbench(db, auth, save);
    expect(result).toMatchObject({ saved: true, advanceId: null, employeeId: null,
      anchorMode: 'independent_historical_tranche', freeAdvanceBalanceHalala: 0 });
    expect([...db.rows.keys()].filter(key => key.startsWith('temporary_expenses/'))).toEqual(['temporary_expenses/synthetic-advance']);
    expect((await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId })))
      .toMatchObject({ workflowStage: 'complete', historicalSettlementProof: { receiptVerified: true } });
    const second = await financeWorkbench(db, auth, save);
    expect(second).toMatchObject({ groupId: result.groupId, replay: true });
    db.rows.get(`posting_locks/custody_deposit__${financeHash('test-row-a').slice(0, 40)}`).consumedHalala = 0;
    expect((await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId })).workflowStage).not.toBe('complete');
  });

  it('rejects a deposit allocation exceeding the unconsumed row balance atomically', async () => {
    const { db, sourceId } = await setup();
    const core = { action: 'preview', kind: 'custody_reconciliation',
      beneficiary: { name: 'TEST beneficiary', sourceRef: 'TEST identity record' },
      amount: 100, correctionDate: postingDay, ownerStatementRef: 'TEST owner statement',
      evidenceRefs: ['TEST deposit row'], fundingEvidence: [{ depositRowId: 'test-deposit',
        evidenceRef: 'TEST deposit row', deliveryDate: '2026-10-17', depositAmount: 150, allocatedAmount: 100 }],
      allocations: [{ kind: 'variable', sourceId, amount: 100, allocationDecisionRef: 'TEST reviewed allocation',
        fundingParts: [{ depositRowId: 'test-deposit', amount: 100 }] }] };
    const preview = await financeWorkbench(db, auth, core);
    expect(preview.blockingIssues).toEqual([]);
    const save = { ...core, action: 'save', previewHash: preview.snapshotHash,
      ownerApprovalRef: 'TEST exact approval', evidenceReviewRef: 'TEST evidence review',
      ledgerReviewRef: 'TEST ledger review', reviewedUnrelatedJournalIds: [], priorClaims: [],
      reason: 'TEST isolated settlement', confirm: true };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(save);
    db.rows.set(`posting_locks/custody_deposit__${financeHash('test-deposit').slice(0, 40)}`, {
      depositRowId: 'test-deposit', evidenceRef: 'TEST deposit row', deliveryDate: '2026-10-17',
      depositAmountHalala: 15000, consumedHalala: 6000 });
    const before = financial(db);
    await expect(financeWorkbench(db, auth, save)).rejects.toThrow(/يتجاوز رصيده/);
    expect(financial(db)).toEqual(before);
  });

  it('posts a fully consumed thirty-document synthetic tranche as one atomic group', async () => {
    const { db, sourceId } = await setup();
    const ids = [sourceId];
    for (let index = 1; index < 30; index += 1) {
      const request = { action: 'previewCapture', kind: 'variable', requestId: `TEST-doc-${index}`,
        patch: expensePatch({ amount: 100, quantity: 1, categoryId: 'synthetic-category',
          invoiceNumber: `TEST-invoice-${index}`, invoiceUrl: `https://example.org/TEST-${index}`,
          paymentStatus: 'paid', paymentMethod: 'card', paidDate: '2026-10-18',
          fundingType: 'employee', fundingReference: `TEST receipt ${index}` }) };
      const draft = await financeWorkbench(db, auth, request);
      const captured = await financeWorkbench(db, auth, { ...request, action: 'capture',
        previewHash: draft.previewHash, reason: 'TEST synthetic source', confirm: true });
      ids.push(captured.sourceId);
    }
    const core = { action: 'preview', kind: 'custody_reconciliation',
      beneficiary: { name: 'TEST beneficiary', sourceRef: 'TEST identity source' },
      amount: 3000, correctionDate: postingDay, ownerStatementRef: 'TEST owner statement',
      evidenceRefs: ['TEST single deposit'], fundingEvidence: [{ depositRowId: 'test-row',
        evidenceRef: 'TEST single deposit', deliveryDate: '2026-10-17', depositAmount: 3000,
        allocatedAmount: 3000 }],
      allocations: ids.map(id => ({ kind: 'variable', sourceId: id, amount: 100,
        allocationDecisionRef: 'TEST reviewed allocation',
        fundingParts: [{ depositRowId: 'test-row', amount: 100 }] })) };
    const preview = await financeWorkbench(db, auth, core);
    expect(preview.blockingIssues).toEqual([]);
    const save = { ...core, action: 'save', previewHash: preview.snapshotHash,
      ownerApprovalRef: 'TEST exact approval', evidenceReviewRef: 'TEST deposit review',
      ledgerReviewRef: 'TEST ledger review', reviewedUnrelatedJournalIds: [], priorClaims: [],
      reason: 'TEST isolated group', confirm: true };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(save);
    const result = await financeWorkbench(db, auth, save);
    expect(result).toMatchObject({ sourceCount: 30, fundedHalala: 300000,
      consumedHalala: 300000, freeAdvanceBalanceHalala: 0 });
    expect(result.journalIds).toHaveLength(31);
    expect((await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: ids[0] })).workflowStage).toBe('complete');
    expect((await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: ids[29] })).workflowStage).toBe('complete');
  });

  it('rejects stale sources, changed requests, overlapping evidence and mismatched VAT evidence without writes', async () => {
    const { db, input, preview, save, sourceId } = await setup();
    const before = financial(db);
    await expect(financeWorkbench(db, auth, { ...save, previewHash: 'a'.repeat(64) })).rejects.toThrow(/لم يُعتمد/);
    expect(financial(db)).toEqual(before);
    db.rows.get(`variable_expenses/${sourceId}`).total_variable_cost = 99;
    await expect(financeWorkbench(db, auth, save)).rejects.toThrow(/تغيرت مصادر/);
    expect(financial(db)).toEqual(before);
    db.rows.get(`variable_expenses/${sourceId}`).total_variable_cost = 100;
    db.rows.get(`variable_expenses/${sourceId}`).description = 'TEST revised business fact';
    const fresh = await financeWorkbench(db, auth, input);
    const revised = { ...save, previewHash: fresh.snapshotHash };
    await expect(financeWorkbench(db, auth, revised)).rejects.toThrow(/لم يُعتمد/);
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(revised);
    const result = await financeWorkbench(db, auth, revised);
    await expect(financeWorkbench(db, auth, { ...revised,
      reason: 'Different reviewed decision' })).rejects.toThrow(/طلب مختلف/);
    expect(result.saved).toBe(true);
    const tax = await setup({ tax: true });
    const taxBefore = financial(tax.db);
    const missingClaim = { ...tax.save, priorClaims: [] };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(missingClaim);
    await expect(financeWorkbench(tax.db, auth, missingClaim)).rejects.toThrow(/مرجع مطالبة/);
    const wrongPeriod = { ...tax.save,
      priorClaims: [{ ...tax.save.priorClaims[0], submittedPeriod: '2026-Q4' }] };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(wrongPeriod);
    await expect(financeWorkbench(tax.db, auth, wrongPeriod)).rejects.toThrow(/مرجع مطالبة/);
    const wrongOpinion = { ...tax.save,
      priorClaims: [{ ...tax.save.priorClaims[0], sourceTaxReviewRef: 'TEST unrelated tax opinion' }] };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(wrongOpinion);
    await expect(financeWorkbench(tax.db, auth, wrongOpinion)).rejects.toThrow(/مرجع مطالبة/);
    expect(financial(tax.db)).toEqual(taxBefore);
    expect(preview.readyForPosting).toBe(false);
  });

  it('records a prior claim without changing the invoice date or creating a new return claim', async () => {
    const { db, save, sourceId } = await setup({ tax: true });
    const saved = await financeWorkbench(db, auth, save);
    const expense = db.rows.get(`journal_entries/${saved.journalIds[1]}`);
    expect(expense).toMatchObject({ entryDate: postingDay, originalInvoiceDate: '2026-09-18',
      purchaseTaxSnapshot: { claimDisposition: 'previously_claimed', submittedPeriod: '2026-Q3',
        priorClaimEvidenceRef: 'TEST filed return', invoiceDate: '2026-09-18' } });
    expect((await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId })).workflowStage).toBe('complete');
  });

  it.each([
    ['period', db => { db.rows.get(`accounting_periods/${postingDay.slice(0, 7)}`).status = 'closed'; }],
    ['account', db => { db.rows.get('chart_of_accounts/1020').active = false; }],
    ['role', db => { db.rows.get('users/synthetic-admin').role = 'operator'; }],
    ['advance', db => { db.rows.get('temporary_expenses/synthetic-advance').recovered_amount = 50; }],
  ])('rejects changed %s without a partial journal', async (_label, mutate) => {
    const { db, save } = await setup();
    mutate(db);
    const before = financial(db);
    await expect(financeWorkbench(db, auth, save)).rejects.toThrow();
    expect(financial(db)).toEqual(before);
  });

  it('holds a second slice on the same legacy advance after the first saves', async () => {
    const { db, save } = await setup();
    const request = { action: 'previewCapture', kind: 'variable', requestId: 'synthetic-second',
      patch: expensePatch({ amount: 50, quantity: 1, categoryId: 'synthetic-category',
        invoiceNumber: 'TEST-DOC-2', invoiceUrl: 'https://example.org/synthetic-second',
        paymentStatus: 'paid', paymentMethod: 'card', paidDate: '2026-10-18',
        fundingType: 'employee', fundingReference: 'TEST second supplier receipt' }) };
    const draft = await financeWorkbench(db, auth, request);
    const secondDoc = await financeWorkbench(db, auth, { ...request, action: 'capture',
      previewHash: draft.previewHash, reason: 'Synthetic second document', confirm: true });
    const secondCore = { ...previewBase, amount: 50, evidenceRefs: ['TEST other transfer'],
      allocations: [{ kind: 'variable', sourceId: secondDoc.sourceId, amount: 50 }] };
    const secondPreview = await financeWorkbench(db, auth, secondCore);
    expect(secondPreview.blockingIssues).toEqual([]);
    const first = await financeWorkbench(db, auth, save);
    const second = { ...secondCore, action: 'save', previewHash: secondPreview.snapshotHash,
      ownerApprovalRef: 'TEST second manifest', evidenceReviewRef: 'TEST second transfer review',
      ledgerReviewRef: 'TEST second full ledger review', reviewedUnrelatedJournalIds: [],
      priorClaims: [], reason: 'Synthetic second settlement', confirm: true };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(second);
    const before = financial(db);
    await expect(financeWorkbench(db, auth, second)).rejects.toThrow();
    expect(financial(db)).toEqual(before);
    expect(first.fundedHalala).toBe(10000);
    db.rows.set('temporary_expenses/synthetic-other-advance', { biker_id: 'synthetic-worker', amount: 50,
      status: 'pending', recovered_amount: 0, spent_date: '2026-10-17' });
    const sharedEvidenceCore = { ...secondCore, advanceId: 'synthetic-other-advance', evidenceRefs: save.evidenceRefs };
    const sharedPreview = await financeWorkbench(db, auth, sharedEvidenceCore);
    expect(sharedPreview.blockingIssues).toEqual([]);
    const sharedSave = { ...second, ...sharedEvidenceCore, action: 'save', previewHash: sharedPreview.snapshotHash,
      reviewedUnrelatedJournalIds: sharedPreview.unassignedAdvanceMovementIds };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(sharedSave);
    const beforeShared = financial(db);
    await expect(financeWorkbench(db, auth, sharedSave)).rejects.toThrow(/الشريحة أو دليل الإيداع/);
    expect(financial(db)).toEqual(beforeShared);
  });
});
