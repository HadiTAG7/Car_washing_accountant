import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { financeWorkbench } from '../financeWorkbench.js';
import { custodySettlementManifestHash } from '../custodyHistoricalSettlement.js';
import { expensePatch } from './financeFixtures.js';

const projectId = 'demo-sweater-finance';
const enabled = /^(127\.0\.0\.1|localhost):19080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '');
const auth = { uid: 'synthetic-admin' };
describe.skipIf(!enabled)('historical custody settlement on isolated Firestore', () => {
  let app, db;
  beforeAll(() => {
    process.env.ENABLE_CUSTODY_HISTORICAL_SETTLEMENT = '1';
    app = initializeApp({ projectId }, 'custody-historical-isolated');
    db = getFirestore(app);
  });
  beforeEach(async () => {
    const response = await fetch(`http://127.0.0.1:19080/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Isolated emulator reset failed');
    const batch = db.batch();
    for (const [path, value] of Object.entries({
      'users/synthetic-admin': { role: 'admin' },
      'temporary_expenses/synthetic-advance': { biker_id: 'synthetic-worker', amount: 150,
        status: 'pending', recovered_amount: 0, spent_date: '2026-10-17' },
      'app_settings/accounting': { value: { vatRegistered: false } },
      'variable_expense_categories/synthetic-category': { name: 'Synthetic category' },
      'accounting_periods/2026-10': { status: 'open' },
      'counters/journal': { nextNumber: 1 },
      'chart_of_accounts/1020': { active: true, accountType: 'asset' },
      'chart_of_accounts/1300': { active: true, accountType: 'asset' },
      'chart_of_accounts/2000': { active: true, accountType: 'liability' },
      'chart_of_accounts/5100': { active: true, accountType: 'expense' },
    })) batch.set(db.doc(path), value);
    await batch.commit();
  }, 120000);
  afterAll(async () => {
    delete process.env.ENABLE_CUSTODY_HISTORICAL_SETTLEMENT;
    delete process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH;
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  async function request(independent = false) {
    const capture = { action: 'previewCapture', kind: 'variable', requestId: 'synthetic-source',
      patch: expensePatch({ amount: 100, quantity: 1, categoryId: 'synthetic-category',
        invoiceNumber: 'TEST-CUSTODY-1', invoiceUrl: 'https://example.org/synthetic-firestore',
        paymentStatus: 'paid', paymentMethod: 'card', paidDate: '2026-10-18',
        fundingType: 'employee', fundingReference: 'TEST supplier receipt' }) };
    const draft = await financeWorkbench(db, auth, capture);
    const source = await financeWorkbench(db, auth, { ...capture, action: 'capture',
      previewHash: draft.previewHash, reason: 'Synthetic invoice', confirm: true });
    const anchor = independent ? { beneficiary: { name: 'TEST beneficiary', sourceRef: 'TEST identity source' },
      fundingEvidence: [{ depositRowId: 'test-row', evidenceRef: 'TEST deposit', deliveryDate: '2026-10-17',
        depositAmount: 150, allocatedAmount: 100 }] }
      : { advanceId: 'synthetic-advance', employeeId: 'synthetic-worker', historicalFundingDate: '2026-10-17' };
    const core = { action: 'preview', kind: 'custody_reconciliation', ...anchor, amount: 100,
      correctionDate: '2026-10-29', ownerStatementRef: 'TEST owner statement',
      evidenceRefs: ['TEST deposit'], allocations: [{ kind: 'variable', sourceId: source.sourceId, amount: 100,
        ...(independent ? { allocationDecisionRef: 'TEST allocation decision',
          fundingParts: [{ depositRowId: 'test-row', amount: 100 }] } : {}) }] };
    const preview = await financeWorkbench(db, auth, core);
    const save = { ...core, action: 'save', previewHash: preview.snapshotHash,
      ownerApprovalRef: 'TEST exact approval', evidenceReviewRef: 'TEST deposit review',
      ledgerReviewRef: 'TEST ledger review', reviewedUnrelatedJournalIds: preview.unassignedAdvanceMovementIds,
      priorClaims: [], reason: 'Synthetic atomic settlement', confirm: true };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(save);
    return { sourceId: source.sourceId, preview, save };
  }
  it('commits once under concurrent requests and verifies Browse/Read', async () => {
    const { sourceId, preview, save } = await request();
    expect(preview.blockingIssues).toEqual([]);
    const [first, replay] = await Promise.all([financeWorkbench(db, auth, save), financeWorkbench(db, auth, save)]);
    expect(first.groupId).toBe(replay.groupId);
    expect([first, replay].filter(result => result.replay)).toHaveLength(1);
    expect((await db.collection('journal_entries').get()).size).toBe(2);
    const read = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId });
    expect(read).toMatchObject({ workflowStage: 'complete', paymentProven: true });
    const browse = (await financeWorkbench(db, auth, { action: 'browse' })).items.find(item => item.sourceId === sourceId);
    expect(browse.workflowStage).toBe('complete');
    expect((await db.doc('temporary_expenses/synthetic-advance').get()).data().custody_historical_partial_hold).toBe(true);
  }, 180000);
  it('rejects a changed source without any financial entry', async () => {
    const { sourceId, save } = await request();
    await db.doc(`variable_expenses/${sourceId}`).update({ total_variable_cost: 99 });
    await expect(financeWorkbench(db, auth, save)).rejects.toThrow(/تغيرت مصادر/);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
    expect((await db.doc('temporary_expenses/synthetic-advance').get()).data().custody_historical_partial_hold).toBeUndefined();
  }, 180000);
  it('atomically seals a deposit-funded tranche without a legacy advance', async () => {
    const { sourceId, preview, save } = await request(true);
    expect(preview.blockingIssues).toEqual([]);
    const [first, replay] = await Promise.all([financeWorkbench(db, auth, save), financeWorkbench(db, auth, save)]);
    expect(first).toMatchObject({ saved: true, advanceId: null,
      anchorMode: 'independent_historical_tranche', freeAdvanceBalanceHalala: 0 });
    expect(replay.groupId).toBe(first.groupId);
    expect([first, replay].filter(result => result.replay)).toHaveLength(1);
    const read = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId });
    const browse = (await financeWorkbench(db, auth, { action: 'browse' })).items.find(item => item.sourceId === sourceId);
    expect(read).toMatchObject({ workflowStage: 'complete', historicalSettlementProof: { receiptVerified: true } });
    expect(browse.workflowStage).toBe('complete');
    expect((await db.doc('temporary_expenses/synthetic-advance').get()).data().custody_historical_partial_hold).toBeUndefined();
  }, 180000);
});
