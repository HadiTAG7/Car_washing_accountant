/**
 * «ذمة رأس مال غير مسددة» — a partner receipt settles the open 1100 receivable
 * first, then capital. On a real Firestore (emulator) or Postgres (pgstore).
 *
 * Run: npm run test:functions  /  npm run test:functions:pg
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { postEntry, postSource, reverseEntry, seedChartOfAccounts, COL } from '../src/ledger.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;
let app, db;

const CHART = [
  { code: '1020', nameArabic: 'البنك', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1100', nameArabic: 'العملاء / الذمم المدينة', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '2300', nameArabic: 'حساب هادي الجاري', accountType: 'liability', normalBalance: 'credit', active: true },
  { code: '3000-p1', nameArabic: 'رأس مال رباب', accountType: 'equity', normalBalance: 'credit', active: true },
  { code: '3000-p2', nameArabic: 'رأس مال حسين', accountType: 'equity', normalBalance: 'credit', active: true },
];
const WIPE = [...Object.values(COL), 'partners', 'partner_payments', 'app_settings', 'audit_logs'];
const lines = async entryId => (await db.collection(COL.ENTRIES).doc(entryId).get()).data().lines
  .map(l => [l.accountId, l.debit, l.credit, l.description, l.partnerId ?? null]);
const receipt = async (id, partnerId, amount, method = 'bank_transfer', date = '2026-11-02') => {
  await db.collection('partner_payments').doc(id).set({ partner_id: partnerId, amount, payment_date: date, payment_method: method });
  return (await postSource(db, FieldValue, { kind: 'partner_payment', sourceId: id }, { userId: 'u1' })).entryId;
};

d('«ذمة رأس مال» — سند القبض يقفل الذمة قبل رأس المال', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-sweater-functions' }, 'capital-receivable-test');
    db = getFirestore(app);
  }, 60_000);
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => {
    for (const c of WIPE) { const snap = await db.collection(c).get(); await Promise.all(snap.docs.map(s => s.ref.delete())); }
    await seedChartOfAccounts(db, FieldValue, CHART, { userId: 'u1' });
    await db.collection('partners').doc('p1').set({ partner_name: 'رباب', workers_count: 1 });
    await db.collection('partners').doc('p2').set({ partner_name: 'حسين', workers_count: 1 });
    // The receivable as it was recorded by hand: 1100 named by the partner, against her capital.
    await postEntry(db, FieldValue, { entry: { entryDate: '2026-10-31', sourceType: 'manual', description: 'رأس مال غير مسدد' },
      lines: [{ accountId: '1100', debit: 1000, credit: 0, description: 'ذمة رأس مال — رباب' },
        { accountId: '3000-p1', debit: 0, credit: 1000, description: 'رأس مال غير مسدد — رباب' }] }, { userId: 'u1' });
  }, 60_000);

  it('credits 1100 until the receivable is settled, then capital; a reversal reopens it', async () => {
    expect(await lines(await receipt('r1', 'p1', 600))).toEqual([
      ['1020', 600, 0, 'استلام دفعة', null], ['1100', 0, 600, 'ذمة رأس مال — رباب', 'p1']]);
    const second = await receipt('r2', 'p1', 700);
    expect(await lines(second)).toEqual([
      ['1020', 700, 0, 'استلام دفعة', null], ['1100', 0, 400, 'ذمة رأس مال — رباب', 'p1'], ['3000-p1', 0, 300, 'رأس مال شريك', null]]);
    // Settled: exactly the capital line a receipt always had.
    expect(await lines(await receipt('r3', 'p1', 100))).toEqual([['1020', 100, 0, 'استلام دفعة', null], ['3000-p1', 0, 100, 'رأس مال شريك', null]]);
    // Reversing the second receipt reopens 400 of the receivable; the next receipt (to Hadi, 2300) settles it.
    const mirror = await reverseEntry(db, FieldValue, second, { entryDate: '2026-11-03', userId: 'u1' });
    expect((await lines(mirror.entryId)).find(l => l[0] === '1100')).toEqual(['1100', 400, 0, 'ذمة رأس مال — رباب', 'p1']);
    expect(await lines(await receipt('r4', 'p1', 500, 'owner_current', '2026-11-04'))).toEqual([
      ['2300', 500, 0, 'استلام دفعة', null], ['1100', 0, 400, 'ذمة رأس مال — رباب', 'p1'], ['3000-p1', 0, 100, 'رأس مال شريك', null]]);
  });

  it('leaves a partner without a receivable exactly as before', async () => {
    expect(await lines(await receipt('h1', 'p2', 250))).toEqual([['1020', 250, 0, 'استلام دفعة', null], ['3000-p2', 0, 250, 'رأس مال شريك', null]]);
  });
});
