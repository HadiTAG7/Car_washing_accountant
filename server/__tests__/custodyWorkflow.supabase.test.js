import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStore } from '../db/pgstore/index.js';
import { financeWorkbench } from '../financeWorkbench.js';
import { postSource, reverseEntry } from '../../functions/src/ledger.js';
import { FieldValue } from 'firebase-admin/firestore';
import pg from 'pg';
import { expensePatch } from './financeFixtures.js';

// Explicit opt-in against the disposable loopback database only.
const enabled = process.env.CUSTODY_PG_TESTS === '1';
const url = 'postgresql://postgres@127.0.0.1:55432/postgres';
const auth = { uid: '11111111-1111-4111-8111-111111111111' };
describe.skipIf(!enabled)('custody through real PgStore transactions and SQL migration', () => {
  let db, pool;
  const token = `custody-synthetic-${Date.now()}`;
  beforeAll(async () => {
    if (new URL(url).hostname !== '127.0.0.1' || new URL(url).port !== '55432') throw new Error('Disposable DB guard');
    db = createStore({ connectionString: url, role: 'ledger_server', max: 8 });
    pool = new pg.Pool({ connectionString: url });
    await pool.query("insert into auth.users(id,email) values ($1,$2) on conflict (id) do nothing",
      [auth.uid, 'custody-admin@isolated.test']);
    await db.doc(`users/${auth.uid}`).set({ role: 'admin' });
    await db.doc('app_settings/accounting').set({ value: { vatRegistered: false } });
    await db.doc(`variable_expense_categories/${token}`).set({ name: 'Synthetic category' });
    for (const code of ['1010', '1020', '1300', '2000', '5100']) await db.doc(`chart_of_accounts/${code}`).set({
      code, nameArabic: 'Synthetic account', active: true,
      accountType: code === '5100' ? 'expense' : code === '2000' ? 'liability' : 'asset',
    });
  });
  afterAll(async () => { if (db) await db.close(); if (pool) await pool.end(); });
  it('matches, posts once, shares balance with recovery, and reverses in order', async () => {
    const advanceId = `${token}-advance`;
    await db.doc(`temporary_expenses/${advanceId}`).set({ biker_id: `${token}-worker`, amount: 150,
      status: 'pending', spent_date: '2026-10-17', payment_method: 'bank' });
    const funding = await postSource(db, FieldValue, { kind: 'temporary_expense', sourceId: advanceId }, { userId: auth.uid });
    const patch = expensePatch({ description: 'Synthetic custody purchase', amount: 100, quantity: 1,
      categoryId: token, invoiceNumber: `${token}-invoice`, invoiceUrl: `https://example.org/${token}`,
      paymentStatus: 'paid', paymentMethod: 'card', paidDate: '2026-10-18',
      fundingType: 'employee', fundingReference: 'TEST supplier receipt',
      employeeAdvanceLink: { version: 1, advanceId, employeeId: `${token}-worker`,
        fundingJournalId: funding.entryId, allocatedAmount: 100 } });
    const input = { action: 'previewCapture', kind: 'variable', requestId: token, patch };
    const preview = await financeWorkbench(db, auth, input);
    expect(preview.postingPreview.ready).toBe(true);
    const captured = await financeWorkbench(db, auth, { ...input, action: 'capture',
      previewHash: preview.previewHash, reason: 'Synthetic isolated transaction', confirm: true });
    const common = { kind: 'variable', sourceId: captured.sourceId };
    const read = await financeWorkbench(db, auth, { ...common, action: 'read' });
    expect(read.approvalReady).toBe(true);
    const browse = (await financeWorkbench(db, auth, { action: 'browse' })).items.find(i => i.sourceId === captured.sourceId);
    expect(browse).toMatchObject({ approvalReady: true, workflowStage: read.workflowStage });
    await financeWorkbench(db, auth, { ...common, action: 'approve', sourceHash: read.sourceHash,
      postingHash: read.postingPreview.postingHash, reason: 'Synthetic matched advance', confirm: true });
    const posted = await financeWorkbench(db, auth, { ...common, action: 'post', sourceHash: read.sourceHash, confirm: true });
    expect((await db.doc(`temporary_expenses/${advanceId}`).get()).data().custody_expense_used_halala).toBe(10000);
    await expect(postSource(db, FieldValue, common, { userId: auth.uid })).rejects.toThrow(/سبق ترحيل/);
    await db.doc(`temporary_expenses/${advanceId}`).update({ status: 'recovered', recovered_date: '2026-10-19' });
    const recovery = await postSource(db, FieldValue, { kind: 'recovery', sourceId: advanceId }, { userId: auth.uid });
    expect((await db.doc(`journal_entries/${recovery.entryId}`).get()).data().lines)
      .toContainEqual(expect.objectContaining({ accountId: '1300', credit: 50 }));
    await expect(reverseEntry(db, FieldValue, posted.result.entryId,
      { entryDate: '2026-10-20', userId: auth.uid })).rejects.toThrow(/اعكس استرداد/);
    await reverseEntry(db, FieldValue, recovery.entryId, { entryDate: '2026-10-20', userId: auth.uid });
    await reverseEntry(db, FieldValue, posted.result.entryId, { entryDate: '2026-10-20', userId: auth.uid });
    expect((await db.doc(`temporary_expenses/${advanceId}`).get()).data().custody_expense_used_halala).toBe(0);
    await expect(reverseEntry(db, FieldValue, funding.entryId,
      { entryDate: '2026-10-20', userId: auth.uid })).rejects.toThrow(/مرتبط بمصروفات/);
  }, 120000);
  it('previews a legacy historical claim without creating a journal or opening balance', async () => {
    const advanceId = `${token}-legacy`;
    await db.doc(`temporary_expenses/${advanceId}`).set({ biker_id: `${token}-worker`, amount: 150,
      status: 'pending', spent_date: '2026-10-17', recovered_amount: 0 });
    await db.doc(`variable_expenses/${token}-legacy-invoice`).set({ amount: 100,
      payment_status: 'paid', paid_date: '2026-10-18', finance_metadata: { fundingType: 'employee' } });
    const before = (await db.collection('journal_entries').get()).size;
    const preview = await financeWorkbench(db, auth, { action: 'preview', kind: 'custody_reconciliation',
      advanceId, employeeId: `${token}-worker`, amount: 100,
      historicalFundingDate: '2026-10-17', correctionDate: '2026-10-29',
      ownerStatementRef: 'TEST owner statement', evidenceRefs: ['TEST archived receipt'],
      allocations: [{ kind: 'variable', sourceId: `${token}-legacy-invoice`, amount: 100 }] });
    expect(preview).toMatchObject({ readyForPosting: false, financialPosting: false,
      remainingHalala: 0, opensUnallocatedBalance: false,
      proposedCorrection: { entryDate: '2026-10-29', historicalFundingDate: '2026-10-17' } });
    expect(preview.issues.join(' ')).toMatch(/لا يوجد قيد تمويل تاريخي/);
    expect((await db.collection('journal_entries').get()).size).toBe(before);
    expect((await db.doc(`temporary_expenses/${advanceId}`).get()).data().custody_balance_opened_journal_id).toBeUndefined();
  }, 120000);
});
