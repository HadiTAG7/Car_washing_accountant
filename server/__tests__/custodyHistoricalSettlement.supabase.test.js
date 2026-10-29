import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createStore } from '../db/pgstore/index.js';
import { financeWorkbench } from '../financeWorkbench.js';
import { custodySettlementManifestHash } from '../custodyHistoricalSettlement.js';
import { expensePatch } from './financeFixtures.js';

const enabled = process.env.CUSTODY_PG_TESTS === '1';
const url = 'postgresql://postgres@127.0.0.1:55432/postgres';
const auth = { uid: '11111111-1111-4111-8111-111111111111' };
const postingDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date());
describe.skipIf(!enabled)('historical settlement through disposable PgStore', () => {
  let db, pool;
  const token = `custody-h-${Date.now()}`;
  beforeAll(async () => {
    if (new URL(url).hostname !== '127.0.0.1' || new URL(url).port !== '55432') throw new Error('Disposable DB guard');
    process.env.ENABLE_CUSTODY_HISTORICAL_SETTLEMENT = '1';
    db = createStore({ connectionString: url, role: 'ledger_server', max: 8 });
    pool = new pg.Pool({ connectionString: url });
    // The disposable foundation has a null auth.uid stub; emulate the real
    // request claim so the authenticated RLS/trigger test reaches the row.
    await pool.query("create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$");
    await pool.query('insert into auth.users(id,email) values ($1,$2) on conflict (id) do nothing',
      [auth.uid, 'custody-admin@isolated.test']);
    await db.doc(`users/${auth.uid}`).set({ role: 'admin' });
    await db.doc('app_settings/accounting').set({ value: { vatRegistered: false } });
    await db.doc(`variable_expense_categories/${token}`).set({ name: 'Synthetic category' });
    await db.doc(`accounting_periods/${postingDay.slice(0, 7)}`).set({ status: 'open' });
    if (!(await db.doc('counters/journal').get()).exists) await db.doc('counters/journal').set({ nextNumber: 1 });
    for (const [code, accountType] of [['1020', 'asset'], ['1200', 'asset'], ['1300', 'asset'], ['2000', 'liability'], ['5100', 'expense']]) {
      await db.doc(`chart_of_accounts/${code}`).set({ code, nameArabic: 'Synthetic account', active: true, accountType });
    }
  });
  afterAll(async () => {
    delete process.env.ENABLE_CUSTODY_HISTORICAL_SETTLEMENT;
    delete process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH;
    if (db) await db.close();
    if (pool) await pool.end();
  });
  it('commits funding, consumption, locks, hold, and receipt together; replay creates no duplicate', async () => {
    const advanceId = `${token}-advance`;
    await db.doc(`temporary_expenses/${advanceId}`).set({ biker_id: `${token}-worker`, amount: 150,
      status: 'pending', recovered_amount: 0, spent_date: '2026-10-17' });
    const request = { action: 'previewCapture', kind: 'variable', requestId: token,
      patch: expensePatch({ amount: 100, quantity: 1, categoryId: token,
        invoiceNumber: `${token}-invoice`, invoiceUrl: `https://example.org/${token}`,
        paymentStatus: 'paid', paymentMethod: 'card', paidDate: '2026-10-18',
        fundingType: 'employee', fundingReference: 'TEST supplier receipt' }) };
    const draft = await financeWorkbench(db, auth, request);
    const captured = await financeWorkbench(db, auth, { ...request, action: 'capture',
      previewHash: draft.previewHash, reason: 'Synthetic capture', confirm: true });
    const core = { action: 'preview', kind: 'custody_reconciliation', advanceId,
      employeeId: `${token}-worker`, amount: 100, historicalFundingDate: '2026-10-17',
      correctionDate: postingDay, ownerStatementRef: 'TEST owner attestation',
      evidenceRefs: [`TEST transfer ${token}`], allocations: [{ kind: 'variable', sourceId: captured.sourceId, amount: 100 }] };
    const preview = await financeWorkbench(db, auth, core);
    expect(preview.blockingIssues).toEqual([]);
    const save = { ...core, action: 'save', previewHash: preview.snapshotHash,
      ownerApprovalRef: 'TEST reviewed manifest', evidenceReviewRef: 'TEST transfer review',
      ledgerReviewRef: 'TEST full ledger review', reviewedUnrelatedJournalIds: preview.unassignedAdvanceMovementIds,
      priorClaims: [], reason: 'Synthetic atomic correction', confirm: true };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(save);
    const journalCountBeforeFault = (await db.collection('journal_entries').get()).size;
    const faultDb = { collection: name => db.collection(name), runTransaction: callback => db.runTransaction(tx => {
      let creates = 0;
      return callback(new Proxy(tx, { get(target, property) {
        if (property === 'create') return (ref, value) => {
          if (++creates === 3) throw new Error('TEST forced mid-transaction failure');
          return target.create(ref, value);
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      } }));
    }) };
    await expect(financeWorkbench(faultDb, auth, save)).rejects.toThrow(/TEST forced/);
    expect((await db.collection('journal_entries').get()).size).toBe(journalCountBeforeFault);
    expect((await db.doc(`temporary_expenses/${advanceId}`).get()).data().custody_historical_partial_hold).toBeUndefined();
    const [first, second] = await Promise.all([financeWorkbench(db, auth, save), financeWorkbench(db, auth, save)]);
    expect([first.replay, second.replay].filter(Boolean)).toHaveLength(1);
    expect(first.groupId).toBe(second.groupId);
    const detail = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: captured.sourceId });
    expect(detail).toMatchObject({ workflowStage: 'complete', paymentProven: true });
    const browse = (await financeWorkbench(db, auth, { action: 'browse' })).items.find(item => item.sourceId === captured.sourceId);
    expect(browse.workflowStage).toBe('complete');
    expect((await db.doc(`temporary_expenses/${advanceId}`).get()).data().custody_historical_partial_hold).toBe(true);
    const guard = await pool.query("select pg_get_functiondef('app.trg_temporary_custody_guard()'::regprocedure) as definition");
    expect(guard.rows[0].definition).toContain('custody_historical_partial_hold');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [auth.uid]);
      await expect(client.query("update public.temporary_expenses set extra = jsonb_set(extra, '{custody_historical_partial_hold}', 'false'::jsonb) where id = $1", [advanceId]))
        .rejects.toThrow(/استهلاك العهدة يكتبه دفتر الأستاذ فقط/);
    } finally {
      await client.query('rollback');
      client.release();
    }
    const journalIds = first.journalIds;
    expect(journalIds).toHaveLength(2);
    const journals = await Promise.all(journalIds.map(id => db.doc(`journal_entries/${id}`).get()));
    expect(journals.every(j => j.exists && j.data().entryDate === postingDay)).toBe(true);
    await expect(financeWorkbench(db, auth, { ...save, reason: 'Changed approval' })).rejects.toThrow(/طلب مختلف/);
  }, 120000);
  it('preserves a previously filed invoice-period claim in the isolated adapter', async () => {
    await db.doc('app_settings/accounting').set({ value: { vatRegistered: true } });
    const advanceId = `${token}-tax-advance`;
    await db.doc(`temporary_expenses/${advanceId}`).set({ biker_id: `${token}-worker`, amount: 100,
      status: 'pending', recovered_amount: 0, spent_date: '2026-09-17' });
    const request = { action: 'previewCapture', kind: 'variable', requestId: `${token}-tax`,
      patch: expensePatch({ amount: 100, quantity: 1, date: '2026-09-18',
        invoiceDate: '2026-09-18', categoryId: token, invoiceNumber: `${token}-tax-invoice`,
        invoiceUrl: `https://example.org/${token}-tax`, paymentStatus: 'paid', paymentMethod: 'card',
        paidDate: '2026-09-18', fundingType: 'employee', fundingReference: 'TEST tax receipt',
        isTaxInvoice: true, vatDeductible: true, vatAmount: 13.04, vatRate: 0.15,
        taxReviewRef: 'TEST submitted-period review' }) };
    const draft = await financeWorkbench(db, auth, request);
    const captured = await financeWorkbench(db, auth, { ...request, action: 'capture',
      previewHash: draft.previewHash, reason: 'Synthetic tax capture', confirm: true });
    const core = { action: 'preview', kind: 'custody_reconciliation', advanceId,
      employeeId: `${token}-worker`, amount: 100, historicalFundingDate: '2026-09-17',
      correctionDate: postingDay, ownerStatementRef: 'TEST owner attestation',
      evidenceRefs: [`TEST tax transfer ${token}`], allocations: [{ kind: 'variable', sourceId: captured.sourceId, amount: 100 }] };
    const preview = await financeWorkbench(db, auth, core);
    expect(preview.blockingIssues).toEqual([]);
    const save = { ...core, action: 'save', previewHash: preview.snapshotHash,
      ownerApprovalRef: 'TEST tax manifest', evidenceReviewRef: 'TEST tax transfer review',
      ledgerReviewRef: 'TEST ledger review', reviewedUnrelatedJournalIds: preview.unassignedAdvanceMovementIds,
      priorClaims: [{ kind: 'variable', sourceId: captured.sourceId, submittedPeriod: '2026-Q3',
        sourceTaxReviewRef: 'TEST submitted-period review', evidenceRef: 'TEST filed return' }],
      reason: 'Synthetic prior claim correction', confirm: true };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(save);
    const result = await financeWorkbench(db, auth, save);
    const journal = (await db.doc(`journal_entries/${result.journalIds[1]}`).get()).data();
    expect(journal).toMatchObject({ entryDate: postingDay, originalInvoiceDate: '2026-09-18',
      purchaseTaxSnapshot: { claimDisposition: 'previously_claimed', submittedPeriod: '2026-Q3',
        invoiceDate: '2026-09-18', priorClaimEvidenceRef: 'TEST filed return' } });
    expect(journal.lines).toContainEqual(expect.objectContaining({ accountId: '1200', debit: 13.04 }));
  }, 120000);
  it('atomically posts an independent deposit tranche through PgStore without a legacy advance', async () => {
    await db.doc('app_settings/accounting').set({ value: { vatRegistered: false } });
    const request = { action: 'previewCapture', kind: 'variable', requestId: `${token}-independent`,
      patch: expensePatch({ amount: 100, quantity: 1, categoryId: token,
        invoiceNumber: `${token}-independent-invoice`, invoiceUrl: `https://example.org/${token}-independent`,
        paymentStatus: 'paid', paymentMethod: 'card', paidDate: '2026-10-18',
        fundingType: 'employee', fundingReference: 'TEST isolated receipt' }) };
    const draft = await financeWorkbench(db, auth, request);
    const captured = await financeWorkbench(db, auth, { ...request, action: 'capture',
      previewHash: draft.previewHash, reason: 'TEST isolated source', confirm: true });
    const core = { action: 'preview', kind: 'custody_reconciliation',
      beneficiary: { name: 'TEST beneficiary', sourceRef: 'TEST identity source' },
      amount: 100, correctionDate: postingDay, ownerStatementRef: 'TEST owner statement',
      evidenceRefs: [`TEST deposit ${token}`], fundingEvidence: [{ depositRowId: `${token}-row`,
        evidenceRef: `TEST deposit ${token}`, deliveryDate: '2026-10-17',
        depositAmount: 150, allocatedAmount: 100 }],
      allocations: [{ kind: 'variable', sourceId: captured.sourceId, amount: 100,
        allocationDecisionRef: 'TEST reviewed allocation',
        fundingParts: [{ depositRowId: `${token}-row`, amount: 100 }] }] };
    const preview = await financeWorkbench(db, auth, core);
    expect(preview.blockingIssues).toEqual([]);
    const save = { ...core, action: 'save', previewHash: preview.snapshotHash,
      ownerApprovalRef: 'TEST exact approval', evidenceReviewRef: 'TEST evidence review',
      ledgerReviewRef: 'TEST ledger review', reviewedUnrelatedJournalIds: preview.unassignedAdvanceMovementIds,
      priorClaims: [], reason: 'TEST isolated settlement', confirm: true };
    process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH = custodySettlementManifestHash(save);
    const [first, second] = await Promise.all([financeWorkbench(db, auth, save), financeWorkbench(db, auth, save)]);
    expect(first).toMatchObject({ advanceId: null, anchorMode: 'independent_historical_tranche',
      freeAdvanceBalanceHalala: 0 });
    expect(first.groupId).toBe(second.groupId);
    expect([first, second].filter(result => result.replay)).toHaveLength(1);
    expect((await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: captured.sourceId })))
      .toMatchObject({ workflowStage: 'complete', historicalSettlementProof: { receiptVerified: true } });
    const funding = (await db.doc(`journal_entries/${first.fundingJournalId}`).get()).data();
    expect(funding).toMatchObject({ entryDate: postingDay, sourceId: first.anchorId,
      custodyAnchorMode: 'independent_historical_tranche' });
    expect(funding.lines.filter(line => line.accountId === '1300')).toContainEqual(expect.objectContaining({ debit: 100 }));
  }, 120000);
});
