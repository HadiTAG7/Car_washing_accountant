/**
 * The month-scoped loader against a real Firestore (the emulator): the same
 * single-field queries the browser sends — string ranges, `in`, `!= null`,
 * document-id lookups, count() — must return what the in-memory model in
 * incomeStatementScope.test.js assumes, so its equivalence proof holds for
 * the real database too.
 *
 * Run: npm run test:emulator
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { loadScopedIncomeSources, monthsBetween } from '../incomeStatementScope.js';
import { dataset, memoryFirestore, outputs, fullSources } from './fixtures/incomeStatementData.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;
const COLLECTIONS = ['washes', 'bikers', 'variable_expenses', 'monthly_expenses', 'annual_expense_entries', 'expense_vouchers',
  'sweater_bookings', 'sweater_settlements', 'journal_entries', 'journal_lines'];

let app; let db;
const rows = snap => snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
const adminExec = () => ({
  all: async name => rows(await db.collection(name).get()),
  range: async (name, field, from, to) => rows(await db.collection(name).where(field, '>=', from).where(field, '<', to).get()),
  equals: async (name, field, value) => rows(await db.collection(name).where(field, '==', value).get()),
  notNull: async (name, field) => rows(await db.collection(name).where(field, '!=', null).get()),
  inValues: async (name, field, values) => rows(await db.collection(name).where(field, 'in', values).get()),
  byIds: async (name, ids) => rows(await db.collection(name).where(FieldPath.documentId(), 'in', ids).get()),
  count: async (name, field, values) => (await db.collection(name).where(field, 'in', values).count().get()).data().count,
  probe: async name => !(await db.collection(name).limit(1).get()).empty,
});
async function load(data) {
  for (const name of COLLECTIONS) {
    const existing = await db.collection(name).get();
    await Promise.all(existing.docs.map(doc => doc.ref.delete()));
    const batch = db.batch();
    for (const [id, doc] of Object.entries(data[name] || {})) batch.set(db.collection(name).doc(id), doc);
    await batch.commit();
  }
}

d('مصادر قائمة الدخل بالأشهر — على Firestore حقيقي', () => {
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-sweater-income-scope' }, 'income-scope-test');
    db = getFirestore(app);
  });
  afterAll(async () => { if (app) await deleteApp(app); });

  it.each([3, 11, 29, 47, 83])('بذرة %i: الاستعلامات الحقيقية تطابق النموذج، والنواتج تطابق المجموعات كاملة', async seed => {
    const data = dataset(seed * 7919 + 7);
    await load(data);
    const statementMonths = ['2026-09', '2026-10'];
    const options = { statementMonths, washMonths: monthsBetween('2026-09', '2026-10'), withBikers: true };
    const real = await loadScopedIncomeSources(adminExec(), options);
    const modeled = await loadScopedIncomeSources(memoryFirestore(data).exec, options);
    expect(real).toStrictEqual(modeled);
    const args = { statementMonths, periodKey: '2026-10', today: '2026-10-21' };
    expect(outputs({ ...args, sources: real })).toStrictEqual(outputs({ ...args, sources: await fullSources(adminExec()) }));
  }, 120_000);
});
