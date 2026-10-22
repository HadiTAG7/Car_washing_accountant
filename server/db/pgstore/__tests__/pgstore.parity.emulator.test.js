// نفس السيناريو على محاكي Firestore وعلى pgstore، والنتيجة يجب أن تتطابق حرفياً:
// الترتيب، المستندات المستبعدة، الأخطاء، الدمج، المعاملات المتزاحمة.
// التشغيل: npm run test:pgstore (يحتاج npx supabase start)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue as FsFieldValue, FieldPath as FsFieldPath, Timestamp as FsTimestamp } from 'firebase-admin/firestore';
import { createStore, FieldValue as PgFieldValue, FieldPath as PgFieldPath, Timestamp as PgTimestamp } from '../index.js';
import { toTagged } from '../../../../src/lib/data/schema/codec.js';
import { available, resetDb, closeDb } from '../../../../src/lib/data/__tests__/supabaseTestDb.js';

const ready = Boolean(process.env.FIRESTORE_EMULATOR_HOST) && await available();
const d = ready ? describe : describe.skip;

let app; let fs; let pgs;
const backends = () => [
  { name: 'firestore', db: fs, FieldValue: FsFieldValue, FieldPath: FsFieldPath, Timestamp: FsTimestamp },
  { name: 'pgstore', db: pgs, FieldValue: PgFieldValue, FieldPath: PgFieldPath, Timestamp: PgTimestamp },
];
const COLLECTIONS = ['washes', 'counters', 'journal_entries', 'chart_of_accounts', 'payroll_runs', 'app_settings', 'temporary_expenses', 'expense_vouchers'];

async function wipeFirestore() {
  for (const name of COLLECTIONS) {
    const snap = await fs.collection(name).get();
    await Promise.all(snap.docs.map(async (doc) => {
      if (name === 'payroll_runs') for (const it of (await doc.ref.collection('items').get()).docs) await it.ref.delete();
      await doc.ref.delete();
    }));
  }
}
// A comparable trace: timestamps assigned by the server (within a day of now) become a marker.
const nowS = Math.floor(Date.now() / 1000);
const norm = v => JSON.parse(JSON.stringify(toTagged(v), (k, x) => (x && typeof x === 'object' && x['$fs:ts'] && Math.abs(x['$fs:ts'].s - nowS) < 86400 ? 'SERVER_TS' : x)));
const snapTrace = snap => snap.docs.map(d => ({ id: d.id, data: norm(d.data()) }));
// Firestore errors compare by gRPC code (the emulator words them differently from production);
// any other error compares by its message.
async function outcome(fn) { try { return { ok: norm(await fn()) }; } catch (e) { return { error: typeof e.code === 'number' ? `code ${e.code}` : String(e.message) }; } }

async function both(scenario) {
  const out = {};
  for (const b of backends()) out[b.name] = await scenario(b);
  return out;
}

d('pgstore يطابق Firestore', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-pgstore' }, 'pgstore-parity');
    fs = getFirestore(app);
    pgs = createStore({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', role: 'ledger_server' });
  });
  afterAll(async () => { if (app) await deleteApp(app); if (pgs) await pgs.close(); await closeDb(); });

  async function seed(b) {
    const W = b.db.collection('washes');
    const rows = [
      ['w01', { wash_date: '2026-09-30', quantity: 1, price: 20, status: 'مكتملة', biker_id: 'b1' }],
      ['w02', { wash_date: '2026-10-01', quantity: 2, price: 23, status: 'مكتملة', biker_id: 'b2' }],
      ['w03', { wash_date: '2026-10-15', quantity: 1, price: 0.1 + 0.2, status: 'قيد التنفيذ', biker_id: null }],
      ['w04', { wash_date: '2026-10-31', quantity: 3, status: 'مكتملة' }],
      ['w05', { quantity: 1, price: 20, status: 'مكتملة', biker_id: 'b1' }],
      ['W06', { wash_date: '2026-11-01', quantity: 1, price: 20, status: 'مكتملة', notes: 'x' }],
      ['w07', { wash_date: '2026-10-20', quantity: '1', price: 20, status: 'مكتملة', biker_id: 7 }],
      ['ssp__SB%2F1', { wash_date: '2026-10-05', quantity: 1, price: 20, revenue_origin: 'sweater', ssp_booking_id: 'SB/1' }],
    ];
    for (const [id, data] of rows) await W.doc(id).set(data);
  }

  it('القراءة والكتابة والدمج والحذف والأخطاء', async () => {
    await resetDb(); await wipeFirestore();
    const r = await both(async (b) => {
      const ref = b.db.collection('app_settings').doc('company');
      const steps = [];
      steps.push(await outcome(async () => (await ref.get()).exists));
      steps.push(await outcome(() => ref.update({ value: 1 })));
      await ref.set({ value: { name: 'سويتر', vatNumber: '3', nested: { a: 1, b: 2 } }, updatedBy: 'u' });
      steps.push(await outcome(() => ref.create({ value: {} })));
      await ref.set({ value: { nested: { b: 3, c: 4 }, address: 'الرياض' }, extraField: true }, { merge: true });
      steps.push(await outcome(async () => (await ref.get()).data()));
      await ref.update({ updatedBy: b.FieldValue.delete(), updatedAt: b.FieldValue.serverTimestamp(), list: [1, 'a', null] });
      const after = (await ref.get()).data();
      steps.push(norm(after));
      steps.push(after.updatedAt instanceof b.Timestamp);
      steps.push(await outcome(async () => (await ref.get()).get('value.nested.c')));
      await ref.delete();
      steps.push(await outcome(async () => (await ref.get()).exists));
      steps.push(await outcome(() => ref.set({ a: undefined })));
      return steps;
    });
    expect(r.pgstore).toEqual(r.firestore);
  });

  it('الاستعلامات: نطاق البادئة، الترتيب، الحقول الناقصة، النوع، in، الصفحات، count، select', async () => {
    await resetDb(); await wipeFirestore();
    const r = await both(async (b) => {
      await seed(b);
      const W = b.db.collection('washes'); const out = {};
      out.all = snapTrace(await W.get());
      out.prefixMonth = snapTrace(await W.where('wash_date', '>=', '2026-10').where('wash_date', '<', '2026-11').get());
      out.desc = snapTrace(await W.orderBy('wash_date', 'desc').limit(3).get());
      out.byNull = snapTrace(await W.where('biker_id', '==', null).get());
      out.typeStrict = snapTrace(await W.where('quantity', '==', 1).get());
      out.typeStrictStr = snapTrace(await W.where('quantity', '==', '1').get());
      out.inValues = snapTrace(await W.where('biker_id', 'in', ['b1', 'b2', 'zz']).get());
      out.orderMissing = snapTrace(await W.orderBy('biker_id').get());
      out.noise = snapTrace(await W.where('price', '==', 0.3).get());
      out.noiseExact = snapTrace(await W.where('price', '==', 0.1 + 0.2).get());
      out.page1 = snapTrace(await W.orderBy(b.FieldPath.documentId()).limit(3).get());
      out.page2 = snapTrace(await W.orderBy(b.FieldPath.documentId()).startAfter('w02').limit(3).get());
      const first = await W.orderBy('wash_date').limit(2).get();
      out.afterSnap = snapTrace(await W.orderBy('wash_date').startAfter(first.docs[1]).limit(2).get());
      out.ids = snapTrace(await W.where(b.FieldPath.documentId(), 'in', ['w03', 'ssp__SB%2F1', 'nope']).get());
      out.count = (await W.where('status', '==', 'مكتملة').count().get()).data().count;
      out.select = snapTrace(await W.where('wash_date', '>=', '2026-10-30').select('quantity', 'missing').get());
      out.rangeOnNumber = snapTrace(await W.where('quantity', '>', 1).get());
      return out;
    });
    for (const k of Object.keys(r.firestore)) expect(r.pgstore[k], k).toEqual(r.firestore[k]);
  });

  it('المعاملات: قراءة قبل كتابة، وعدّاد القيود تحت التزاحم بلا تكرار', async () => {
    await resetDb(); await wipeFirestore();
    const r = await both(async (b) => {
      const counter = b.db.collection('counters').doc('journal');
      await counter.set({ nextNumber: 1 });
      const order = await outcome(() => b.db.runTransaction(async (tx) => {
        tx.set(b.db.collection('counters').doc('x'), { a: 1 });
        await tx.get(counter);
      }));
      const taken = await Promise.all(Array.from({ length: 12 }, () => b.db.runTransaction(async (tx) => {
        const snap = await tx.get(counter);
        const n = snap.data().nextNumber;
        tx.update(counter, { nextNumber: n + 1, updatedAt: b.FieldValue.serverTimestamp() });
        return n;
      })));
      const notFound = await outcome(() => b.db.runTransaction(async (tx) => { tx.update(b.db.collection('counters').doc('missing'), { a: 1 }); }));
      return { order, taken: taken.sort((x, y) => x - y), final: (await counter.get()).data().nextNumber, notFound };
    });
    expect(r.pgstore).toEqual(r.firestore);
    expect(r.pgstore.taken).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  }, 60_000);

  it('القيد بسطوره، وتعديل وصف السطور، والمجموعات الفرعية', async () => {
    await resetDb(); await wipeFirestore();
    const r = await both(async (b) => {
      for (const code of ['1000', '4000']) await b.db.collection('chart_of_accounts').doc(code).set({ code, active: true });
      const ref = b.db.collection('journal_entries').doc('e1');
      await b.db.runTransaction(async (tx) => {
        tx.set(ref, { entryDate: '2026-10-05', periodKey: '2026-10', status: 'posted', entryNumber: 1, totalDebit: 10, totalCredit: 10,
          lines: [{ accountId: '1000', debit: 10, credit: 0, description: 'أ' }, { accountId: '4000', debit: 0, credit: 10, description: 'ب' }], createdAt: b.FieldValue.serverTimestamp() });
      });
      const before = norm((await ref.get()).data());
      const lines = (await ref.get()).data().lines.map(l => ({ ...l, description: `${l.description} (معدّل)` }));
      await b.db.runTransaction(async (tx) => { await tx.get(ref); tx.update(ref, { description: 'جديد', lines }); });
      const after = norm((await ref.get()).data());
      const byPeriod = snapTrace(await b.db.collection('journal_entries').where('periodKey', '==', '2026-10').get());
      const run = b.db.collection('payroll_runs').doc('2026-10__r1');
      await run.set({ periodKey: '2026-10', status: 'draft' });
      await run.collection('items').doc('b2').set({ bikerId: 'b2', netDue: 1500.5 });
      await run.collection('items').doc('b1').set({ bikerId: 'b1', netDue: 999.99 });
      const items = snapTrace(await run.collection('items').orderBy('netDue').get());
      return { before, after, byPeriod, items };
    });
    expect(r.pgstore).toEqual(r.firestore);
  });
});
