/**
 * سباق تهيئة السياسة الضريبية — the check and the write on ONE snapshot
 * ═══════════════════════════════════════════════════════════════════════════
 * `seedTaxPolicy` must refuse a baseline later than the oldest entry in the
 * books: a month sitting in the ledger that the policy record cannot explain
 * is a month nobody can file, and the next posting into it is refused for a
 * reason two steps removed from its cause.
 *
 * The check was right and its PLACEMENT was wrong. It ran before
 * `runTransaction` opened:
 *
 *     const earliest = await earliestEntryDate(db);   // ← photograph
 *     if (earliest && baselineFrom > earliest) throw …
 *     return db.runTransaction(…)                     // ← write
 *
 * Between the two, a 2024 entry could be posted. The seed had already decided
 * the books were empty, and it committed a 2026 baseline over a ledger that
 * now started in 2024. Nothing afterwards noticed.
 *
 * Now the read, the judgement, the write and the audit are one transaction.
 * `onBeforeCommit` is the seam these tests use to post an entry after the
 * reads and before the writes — Firestore then aborts the transaction, and
 * the retry reads what the posting wrote.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { postEntry, seedChartOfAccounts, COL } from '../src/ledger.js';
import { seedTaxPolicy, earliestEntryDateIn } from '../src/accountingSettings.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let app, db;

const CHART = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '4000', nameArabic: 'إيرادات', accountType: 'revenue', normalBalance: 'credit', active: true },
];

const WIPE = [...Object.values(COL), 'app_settings'];
async function wipe() {
  for (const c of WIPE) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((s) => s.ref.delete()));
  }
}

/** A balanced manual entry on a given date, through the real poster. */
const postOn = (date, n = 0) => postEntry(db, FieldValue, {
  entry: { entryDate: date, sourceType: 'manual', description: `قيد ${date}` },
  lines: [
    { accountId: '1010', debit: 100 + n, credit: 0, description: 'نقد' },
    { accountId: '4000', debit: 0, credit: 100 + n, description: 'إيراد' },
  ],
}, { userId: 'u1' });

/**
 * The same arrival, written WITHOUT a transaction.
 *
 * ── لماذا كتابة مباشرة في اختبار السباق ──
 * The Firestore emulator will abort the seed's transaction either way — the
 * conflict is detected, and `postOn` as the racer proves that below. But when
 * the racer is itself a transaction, the emulator retries the seed at a read
 * time that still predates the racer's commit, so the retry keeps seeing an
 * empty ledger and the test can never reach the refusal it exists to check.
 *
 * That is an emulator scheduling artifact, not a property of the code. So the
 * arrival is written plainly here: same two documents, same values, visible to
 * the retry. It is also the more honest shape of the hazard, since an entry
 * can reach the collection through an import or an Admin-SDK script that never
 * went near `postEntry`.
 */
async function arriveOn(date) {
  await db.collection(COL.ENTRIES).doc(`raced-${date}`).set({
    entryDate: date, periodKey: date.slice(0, 7), status: 'posted',
    sourceType: 'manual', sourceId: null, description: `قيد ${date}`,
    entryNumber: 999, totalDebit: 100, totalCredit: 100,
    lines: [
      { accountId: '1010', debit: 100, credit: 0, description: 'نقد' },
      { accountId: '4000', debit: 0, credit: 100, description: 'إيراد' },
    ],
  });
  await db.collection(COL.COUNTERS).doc('journal')
    .set({ nextNumber: 1000, earliestEntryDate: date }, { merge: true });
}

const settings = async () => {
  const s = await db.collection('app_settings').doc('accounting').get();
  return s.exists ? (s.data().value || {}) : {};
};
const audits = async () => (await db.collection(COL.AUDIT)
  .where('action', '==', 'tax-policy').get()).docs.map((x) => x.data());

/** Fires its body exactly once, however many times the transaction retries. */
function once(fn) {
  let done = false;
  let runs = 0;
  const wrapped = async () => {
    runs += 1;
    if (done) return;
    done = true;
    await fn();
  };
  wrapped.runs = () => runs;
  return wrapped;
}

d('سباق تهيئة السياسة الضريبية', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-sweater-seed-race' }, 'seed-race-test');
    db = getFirestore(app);
  }, 60_000);
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => {
    await wipe();
    await seedChartOfAccounts(db, FieldValue, CHART, { userId: 'u1' });
  }, 60_000);

  // ═══ ١) دفتر فارغ: البذرة تنجح ═══════════════════════════════════════
  it('دفتر فارغ — البذرة تُقبل وتُكتب مع سجل تدقيق واحد', async () => {
    const res = await seedTaxPolicy(db, FieldValue, { baselineFrom: '2026-01-01' }, { userId: 'u1' });
    expect(res.taxPolicyHistory).toHaveLength(1);
    expect(res.taxPolicyHistory[0]).toMatchObject({ effectiveFrom: '2026-01-01', baseline: true });
    expect((await settings()).taxPolicyHistory).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  }, 60_000);

  // ═══ ٢) قيد أقدم يصل قبل الكتابة: المعاملة تُعاد وتُرفض ══════════════
  it('قيد أقدم من الأساس يصل بين القراءة والكتابة — تُعاد المعاملة وتُرفض البذرة', async () => {
    const raceIn = once(() => arriveOn('2024-05-09'));

    await expect(seedTaxPolicy(
      db, FieldValue, { baselineFrom: '2026-01-01' },
      { userId: 'u1', onBeforeCommit: raceIn },
    )).rejects.toThrow(/بعد أقدم قيد مُرحّل \(2024-05-09\)/);

    // …وأنها أُعيدت فعلاً. مرة واحدة تعني أن الرفض جاء من اللقطة نفسها التي
    // كانت ستكتب — أي أن الفحص والكتابة لم يجتمعا على صورة واحدة.
    expect(raceIn.runs()).toBeGreaterThan(1);
  }, 90_000);

  it('وترحيل حقيقي عبر postEntry أثناء المعاملة يُجهضها ويعيدها', async () => {
    // The racer here is the REAL poster, so what is proven is the conflict
    // itself: the seed read `counters/journal` and the ordered scan, the
    // posting wrote both, and Firestore aborted the seed rather than letting
    // it commit on a snapshot that no longer described the books.
    const raceIn = once(() => postOn('2024-05-09'));
    await seedTaxPolicy(
      db, FieldValue, { baselineFrom: '2020-01-01' },
      { userId: 'u1', onBeforeCommit: raceIn },
    ).catch(() => {});
    expect(raceIn.runs()).toBeGreaterThan(1);
  }, 90_000);

  // ═══ ٣) المحاولة المرفوضة لا تترك أثراً ══════════════════════════════
  it('ولا يبقى من المحاولة المرفوضة سجل تاريخي ولا سطر تدقيق', async () => {
    await expect(seedTaxPolicy(
      db, FieldValue, { baselineFrom: '2026-01-01' },
      { userId: 'u1', onBeforeCommit: once(() => arriveOn('2024-05-09')) },
    )).rejects.toThrow();

    // The settings document must be untouched — not "written then reverted",
    // untouched: the refusal happens before the first `tx.set`.
    expect((await settings()).taxPolicyHistory ?? []).toHaveLength(0);
    // And an audit trail that records attempts nobody made is worse than
    // none: it would show a policy seeded from 2026-01-01 that never was.
    expect(await audits()).toHaveLength(0);
  }, 90_000);

  // ═══ ٤) أساس يسبق أقدم قيد ينجح ══════════════════════════════════════
  it('أساس يسبق أقدم قيد — يُقبل، وحتى لو رُحّل قيد أحدث أثناء المعاملة', async () => {
    await postOn('2026-03-01');
    const res = await seedTaxPolicy(
      db, FieldValue, { baselineFrom: '2020-01-01' },
      // A NEWER entry racing in changes nothing: the baseline still precedes
      // everything in the books, so the retry reaches the same answer.
      { userId: 'u1', onBeforeCommit: once(() => arriveOn('2026-04-01')) },
    );
    expect(res.taxPolicyHistory[0].effectiveFrom).toBe('2020-01-01');
    expect(await audits()).toHaveLength(1);
  }, 90_000);

  it('وأساس في يوم أقدم قيد بالضبط يُقبل — الشهر يبقى مفسَّراً', async () => {
    await postOn('2026-03-01');
    const res = await seedTaxPolicy(db, FieldValue, { baselineFrom: '2026-03-01' }, { userId: 'u1' });
    expect(res.taxPolicyHistory[0].effectiveFrom).toBe('2026-03-01');
  }, 60_000);

  // ═══ ٥) بذرتان متزامنتان: واحدة فقط ══════════════════════════════════
  it('بذرتان متزامنتان — واحدة تنجح والأخرى تُرفض، وسطر واحد في السجل', async () => {
    const results = await Promise.allSettled([
      seedTaxPolicy(db, FieldValue, { baselineFrom: '2026-01-01', note: 'أ' }, { userId: 'a' }),
      seedTaxPolicy(db, FieldValue, { baselineFrom: '2025-01-01', note: 'ب' }, { userId: 'b' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.message).toMatch(/مُهيّأ بالفعل/);

    const stored = (await settings()).taxPolicyHistory;
    expect(stored).toHaveLength(1);
    expect(stored[0].effectiveFrom).toBe(ok[0].value.taxPolicyHistory[0].effectiveFrom);
    // One winner, one audit line. The loser left nothing.
    expect(await audits()).toHaveLength(1);
  }, 90_000);

  // ═══ الحارس الذرّي نفسه ══════════════════════════════════════════════
  it('عدّاد القيود يحمل أقدم تاريخ، ويهبط ولا يصعد', async () => {
    await postOn('2026-03-01');
    const read = async () => (await db.collection(COL.COUNTERS).doc('journal').get()).data();
    expect((await read()).earliestEntryDate).toBe('2026-03-01');

    await postOn('2026-05-01', 1);                 // أحدث — لا يحرّك الحد
    expect((await read()).earliestEntryDate).toBe('2026-03-01');

    await postOn('2024-01-01', 2);                 // أقدم — يهبط به
    expect((await read()).earliestEntryDate).toBe('2024-01-01');
  }, 90_000);

  it('وقراءة أقدم قيد داخل المعاملة تجمع الحارس والمسح', async () => {
    await postOn('2026-03-01');
    // A ledger written before the guard existed: the counter carries no
    // bound, and the ordered scan is what answers.
    await db.collection(COL.COUNTERS).doc('journal').set(
      { earliestEntryDate: FieldValue.delete() }, { merge: true },
    );
    const viaScan = await db.runTransaction((tx) => earliestEntryDateIn(db, tx));
    expect(viaScan).toBe('2026-03-01');

    // …and a bound recorded on the counter that the scan cannot see (an entry
    // beyond the scan window) still counts, because the answer is the EARLIER
    // of the two.
    await db.collection(COL.COUNTERS).doc('journal').set(
      { earliestEntryDate: '2019-01-01' }, { merge: true },
    );
    expect(await db.runTransaction((tx) => earliestEntryDateIn(db, tx))).toBe('2019-01-01');
  }, 90_000);

  it('والقيد المعكوس يظل في الدفاتر — لا يُعامل كأنه مُحي', async () => {
    const posted = await postOn('2024-02-02');
    await db.collection(COL.ENTRIES).doc(posted.entryId).update({ status: 'reversed' });
    await db.collection(COL.COUNTERS).doc('journal').set(
      { earliestEntryDate: FieldValue.delete() }, { merge: true },
    );
    expect(await db.runTransaction((tx) => earliestEntryDateIn(db, tx))).toBe('2024-02-02');
    await expect(seedTaxPolicy(db, FieldValue, { baselineFrom: '2026-01-01' }, { userId: 'u1' }))
      .rejects.toThrow(/2024-02-02/);
  }, 90_000);
});
