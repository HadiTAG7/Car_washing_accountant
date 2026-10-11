import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { dispatch } from '../src/handlers.js';

const projectId = 'demo-sweater-partner-revenue';
const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
suite('partner revenue on isolated Firestore: real projections, scoped read-only report', () => {
  let app, db;
  const owned = [];
  const seed = async (collection, id, value) => {
    const ref = db.collection(collection).doc(id);
    owned.push(ref);
    await ref.set(value);
    return ref;
  };
  const user = { uid: 'revenue-partner' };
  const payload = { partnerId: 'other-partner', includeStatements: true, periodKey: '2026-10' };
  const run = () => dispatch(db, null, 'partnerInsights', payload, user);
  let washRef;
  beforeAll(async () => {
    if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)
      || process.env.GCLOUD_PROJECT !== projectId) throw new Error('Dedicated demo emulator required; no live data permitted.');
    app = initializeApp({ projectId }, 'partner-revenue-regression');
    db = getFirestore(app);
    await seed('users', user.uid, { role: 'partner' });
    await seed('partners', 'own-partner', { workers_count: 1, user_id: user.uid });
    await seed('partners', 'other-partner', { workers_count: 9, user_id: 'other-user' });
    await seed('chart_of_accounts', '4000', { code: '4000', accountType: 'revenue', normalBalance: 'credit' });
    await seed('fee_rules', 'none', { rate: 0, active: true });
    washRef = await seed('washes', 'private-wash', { wash_date: '2026-10-08', quantity: 1, price: 20,
      status: 'مكتملة', biker_name: 'Never expose this worker', ssp_booking_id: 'private-booking',
      revenue_origin: 'sweater', collection_status: 'confirmed_by_owner',
      owner_tax_snapshot: { source: 'owner_statement', clarificationId: 'private-evidence', currency: 'SAR',
        priceMode: 'exclusive', quantity: 1, net: 20, vat: 3, gross: 23 } });
  });
  afterAll(async () => {
    if (db) await Promise.all(owned.map(ref => ref.delete()));
    if (app) await deleteApp(app);
  });
  it('uses the financial fields from real select(), returns only the caller share, and changes no records', async () => {
    const before = await washRef.get();
    const result = await run();
    expect(result.partnerId).toBe('own-partner');
    expect(result.statements.at(-1).netRevenue).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/Never expose|private-booking|private-evidence|private-wash/);
    const after = await washRef.get();
    expect(after.data()).toEqual(before.data());
    expect(after.updateTime.isEqual(before.updateTime)).toBe(true);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
  });
  it('replaces recorded revenue on posting and respects reversal without reintroducing the raw wash', async () => {
    await seed('journal_entries', 'sale', { entryDate: '2026-10-08', sourceKind: 'wash', sourceId: washRef.id,
      status: 'posted', lines: [{ accountId: '4000', credit: 20 }] });
    expect((await run()).statements.at(-1).netRevenue).toBe(2);
    await db.collection('journal_entries').doc('sale').update({ status: 'reversed' });
    await seed('journal_entries', 'reversal', { entryDate: '2026-10-09', reversalOf: 'sale', status: 'posted',
      lines: [{ accountId: '4000', debit: 20 }] });
    expect((await run()).statements.at(-1).netRevenue).toBe(0);
  });
  it('still rejects an unauthenticated request', async () => {
    await expect(dispatch(db, null, 'partnerInsights', payload, null)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('actual partner gets earned wages once before, after partial and full posting, never company payroll records', async () => {
    const biker = await seed('bikers', 'private-payroll-worker', { name: 'Private employee salary', salary: 1000, start_date: '2026-10-01' });
    await seed('chart_of_accounts', '5010', { code: '5010', accountType: 'expense', normalBalance: 'debit' });
    const before = await biker.get();
    const unpaid = await run();
    expect(unpaid.statements.at(-1)).toMatchObject({ totalCosts: 100, salaryAccrual: { amount: 100, posted: 0, unposted: 100 } });
    const runId = '2026-10__r1';
    await seed('payroll_periods', '2026-10', { currentRunId: runId });
    await seed('payroll_runs', runId, { status: 'partially_paid', periodKey: '2026-10' });
    await seed(`payroll_runs/${runId}/items`, 'first', { bikerId: 'private-payroll-worker', basicDue: 400, status: 'paid' });
    const remaining = await seed(`payroll_runs/${runId}/items`, 'remaining', { bikerId: 'private-other-worker', basicDue: 600, status: 'draft' });
    const journal = amount => ({ status: 'posted', entryDate: '2026-11-01', sourceType: 'payroll', sourceId: runId,
      payrollSnapshot: { periodKey: '2026-10' }, lines: [{ accountId: '5010', debit: amount }, { accountId: '1020', credit: amount }] });
    await seed('journal_entries', 'partial-salary', journal(400));
    expect((await run()).statements.at(-1)).toMatchObject({ totalCosts: 100, salaryAccrual: { posted: 40, unposted: 60 } });
    await seed('journal_entries', 'rest-salary', journal(600));
    await remaining.update({ status: 'paid' });
    const paid = await run();
    expect(paid.statements.at(-1)).toMatchObject({ totalCosts: 100, salaryAccrual: { posted: 100, unposted: 0 } });
    expect(paid.partnerId).toBe('own-partner');
    expect(JSON.stringify(paid)).not.toMatch(/Private employee salary|private-payroll-worker|private-other-worker|basicDue/);
    const after = await biker.get();
    expect(after.data()).toEqual(before.data()); expect(after.updateTime.isEqual(before.updateTime)).toBe(true);
  });
});
