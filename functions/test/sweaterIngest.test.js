/**
 * استلام سويتر — الخام لا يُمحى، والإعادة بلا أثر، والمُرحَّل لا يُلمَس
 * ═══════════════════════════════════════════════════════════════════════════
 * أربعة ادعاءات حاملة، كلٌّ منها فشلٌ صامت لولا اختباره:
 *
 * ١) **إعادة إرسال الدفعة نفسها لا تفعل شيئاً.** وكيلٌ أعاد المحاولة بعد
 *    انقطاعٍ في الشبكة لا يجوز أن يضاعف حجوزات شهر.
 * ٢) **نفس المعرّف بحمولةٍ أخرى يُرفض.** قبولُه يجعل «الدفعة رقم كذا» تعني
 *    شيئين، ويفتح باب الإعادة المعدَّلة (replay).
 * ٣) **حجزٌ مُرحَّل لا يُعدَّل مصدره** — يُسجَّل فرقٌ ويُترك للقرار. تعديله
 *    يجعل الدفتر يصف صفّاً لم يعد موجوداً.
 * ٤) **الخام تراكمي**: نسختان لحجزٍ واحد ليستا تكراراً بل تاريخه.
 *
 * Run: npm run test:functions   (يحتاج المحاكي)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  ingestSweaterOperations, recordAgentHeartbeat, stalenessOf,
  classifyRecord, diffRecords, envelopeProblems, COL, MAX_RECORDS,
} from '../src/sweater/ingest.js';
import { normalizeRecord, hashRecord } from '../src/sweater/record.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;
const PROJECT = 'demo-sweater-ingest';

let app, db;

const rec = (id, over = {}) => ({
  sspBookingId: id,
  serviceType: 'interior_exterior_wash',
  serviceDate: '2026-05-20',
  rawStatus: 'payment_collection',
  rawPaymentStatus: 'recorded',
  driverName: 'أحمد',
  region: 'الرياض',
  platformAmount: 23,
  ...over,
});

const payload = (runId, records, over = {}) => ({
  importRunId: runId,
  agentStatus: 'ok',
  coverage: {
    rangeFrom: '2026-05-01', rangeTo: '2026-05-31', extractedAt: '2026-06-01T20:30:00Z',
    pageCount: 1, pagesFetched: 1, recordCount: records.length, isComplete: true,
    sourceUrl: 'https://ssp-portal.sweater.sa/',
  },
  records,
  ...over,
});

const countDocs = async (c) => (await db.collection(c).get()).size;

d('استلام عمليات سويتر', () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT }, 'sweater-ingest');
    db = getFirestore(app);
  }, 60_000);

  afterAll(async () => { if (app) await deleteApp(app); });

  beforeEach(async () => {
    for (const c of Object.values(COL)) {
      const snap = await db.collection(c).get();
      await Promise.all(snap.docs.map((x) => x.ref.delete()));
    }
  }, 30_000);

  it('الدفعة الأولى: كل السجلات جديدة، والخام والحجوزات تُكتب', async () => {
    const res = await ingestSweaterOperations(db, FieldValue, payload('run-1', [rec('B1'), rec('B2')]));
    expect(res.counts).toMatchObject({ new: 2, duplicate: 0, rejected: 0, needsReview: 0 });
    expect(await countDocs(COL.RAW)).toBe(2);
    expect(await countDocs(COL.BOOKINGS)).toBe(2);
  }, 60_000);

  it('وإعادة إرسال الدفعة نفسها لا تفعل شيئاً — والنتيجة المخزَّنة تُعاد', async () => {
    // الادعاء الأول: وكيلٌ أعاد المحاولة لا يضاعف شهراً.
    await ingestSweaterOperations(db, FieldValue, payload('run-1', [rec('B1'), rec('B2')]));
    const again = await ingestSweaterOperations(db, FieldValue, payload('run-1', [rec('B1'), rec('B2')]));

    expect(again.replay).toBe(true);
    expect(again.counts).toMatchObject({ new: 2 });
    expect(await countDocs(COL.RAW)).toBe(2);
    expect(await countDocs(COL.BOOKINGS)).toBe(2);
  }, 60_000);

  it('ونفس المعرّف بحمولةٍ مختلفة يُرفض — لا إعادة معدَّلة', async () => {
    // الادعاء الثاني: هذا هو شكل هجوم الإعادة المعدَّلة بالضبط.
    await ingestSweaterOperations(db, FieldValue, payload('run-1', [rec('B1')]));
    await expect(
      ingestSweaterOperations(db, FieldValue, payload('run-1', [rec('B1', { platformAmount: 999 })])),
    ).rejects.toThrow(/استُعمل بحمولة مختلفة/);
    // ولم يتغيّر شيء.
    const b = await db.collection(COL.BOOKINGS).doc('B1').get();
    expect(b.data().record.platformAmount).toBe(23);
  }, 60_000);

  it('ودفعتان متزامنتان بنفس المعرّف: واحدة تفوز والأخرى تُعاد أو تُرفض', async () => {
    const [a, bRes] = await Promise.allSettled([
      ingestSweaterOperations(db, FieldValue, payload('race', [rec('B1')])),
      ingestSweaterOperations(db, FieldValue, payload('race', [rec('B1')])),
    ]);
    const ok = [a, bRes].filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    // مهما كان الترتيب: حجزٌ واحد ومستند خامٍ واحد.
    expect(await countDocs(COL.BOOKINGS)).toBe(1);
    expect(await countDocs(COL.RAW)).toBe(1);
  }, 60_000);

  it('ونسخةٌ معدَّلة لحجزٍ غير مُرحَّل تُحدَّث، والخام يتراكم', async () => {
    // الادعاء الرابع: الخام تاريخٌ لا تكرار.
    await ingestSweaterOperations(db, FieldValue, payload('run-1', [rec('B1')]));
    const res = await ingestSweaterOperations(db, FieldValue,
      payload('run-2', [rec('B1', { rawStatus: 'admin_cancelled' })]));

    expect(res.counts).toMatchObject({ modified: 1, new: 0 });
    expect(await countDocs(COL.RAW)).toBe(2);              // نسختان
    expect(await countDocs(COL.BOOKINGS)).toBe(1);         // حجزٌ واحد
    const b = await db.collection(COL.BOOKINGS).doc('B1').get();
    expect(b.data().normalizedStatus).toBe('admin_cancelled');
  }, 60_000);

  it('وحجزٌ مُرحَّل لا يُعدَّل مصدره — يُسجَّل فرقٌ ويُترك للقرار', async () => {
    // الادعاء الثالث، وهو أخطرها: تعديل مصدرٍ مُرحَّل يجعل الدفتر يصف صفّاً
    // لم يعد موجوداً.
    await ingestSweaterOperations(db, FieldValue, payload('run-1', [rec('B1')]));
    await db.collection(COL.BOOKINGS).doc('B1').set(
      { processingStatus: 'posted', postedEntryId: 'JE-1' }, { merge: true },
    );
    const before = (await db.collection(COL.BOOKINGS).doc('B1').get()).data().record;

    const res = await ingestSweaterOperations(db, FieldValue,
      payload('run-2', [rec('B1', { platformAmount: 46, rawStatus: 'admin_cancelled' })]));

    expect(res.counts.needsReview).toBe(1);
    expect(res.rows[0]).toMatchObject({ outcome: 'needs_review', reasonCode: 'modified_after_posting' });

    // الحجز لم يُلمَس.
    const after = (await db.collection(COL.BOOKINGS).doc('B1').get()).data();
    expect(after.record.platformAmount).toBe(before.platformAmount);
    expect(after.processingStatus).toBe('posted');

    // والفرق سُجِّل بما تغيّر.
    expect(await countDocs(COL.VARIANCES)).toBe(1);
    const v = (await db.collection(COL.VARIANCES).get()).docs[0].data();
    expect(v.kind).toBe('booking_modified_after_posting');
    expect(v.resolution).toBe('unresolved');
    expect(v.changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['platformAmount', 'rawStatus', 'normalizedStatus']),
    );
    // والخام محفوظ رغم رفض التعديل — المصدر لا يُفقَد أبداً.
    expect(await countDocs(COL.RAW)).toBe(2);
  }, 60_000);

  it('و`dryRun` يقول ما سيحدث ولا يكتب حرفاً', async () => {
    const res = await ingestSweaterOperations(db, FieldValue,
      payload('dry-1', [rec('B1'), rec('B2')]), { dryRun: true });

    expect(res.dryRun).toBe(true);
    expect(res.counts.new).toBe(2);
    expect(await countDocs(COL.RAW)).toBe(0);
    expect(await countDocs(COL.BOOKINGS)).toBe(0);
    expect(await countDocs(COL.RUNS)).toBe(0);
  }, 60_000);

  it('وسجلٌّ بحقلٍ ممنوع يُرفض وحده، والبقية تمرّ', async () => {
    const res = await ingestSweaterOperations(db, FieldValue, payload('run-1', [
      rec('B1'),
      { ...rec('B2'), netAmount: 20 },
      { ...rec('B3'), customerPhone: '0500000000' },
    ]));
    expect(res.counts).toMatchObject({ new: 1, rejected: 2 });
    expect(res.rows.filter((r) => r.outcome === 'rejected').map((r) => r.reasonCode))
      .toEqual(['forbidden_field', 'forbidden_field']);
    expect(await countDocs(COL.BOOKINGS)).toBe(1);
  }, 60_000);

  it('وتكرارٌ داخل الدفعة ببيانات مختلفة يذهب للمراجعة لا يُختار أحدهما', async () => {
    const res = await ingestSweaterOperations(db, FieldValue, payload('run-1', [
      rec('B1'), rec('B1', { platformAmount: 46 }),
    ]));
    expect(res.counts.needsReview).toBe(1);
    expect(res.rows[1].reasonCode).toBe('duplicate_conflict');
  }, 60_000);

  it('وتغطيةٌ ناقصة تُوسم على الدفعة كلها', async () => {
    const res = await ingestSweaterOperations(db, FieldValue,
      payload('run-1', [rec('B1')], { coverage: { rangeFrom: '2026-05-01', rangeTo: '2026-05-31',
        pageCount: 5, pagesFetched: 2, isComplete: false } }));
    expect(res.coverageIssues.length).toBeGreaterThan(0);
    const run = (await db.collection(COL.RUNS).doc('run-1').get()).data();
    expect(run.status).toBe('completed_with_gaps');
  }, 60_000);

  it('ونبضة الوكيل ترفع العلم عند طلب رمز التحقق — بلا تخزين الرمز', async () => {
    const r = await recordAgentHeartbeat(db, FieldValue,
      { agentStatus: 'otp_required', note: 'المنصة تطلب رمزاً' });
    expect(r.alert).toBe(true);
    const st = (await db.collection(COL.STATE).doc('current').get()).data();
    expect(st.lastAgentStatus).toBe('otp_required');
    expect(st.alert).toBe(true);
    expect(JSON.stringify(st)).not.toMatch(/\b\d{4,6}\b(?!-)/); // لا رمز مخزَّن
  }, 60_000);

  it('وحال التكامل يُحدَّث بعد كل استيراد ناجح', async () => {
    await ingestSweaterOperations(db, FieldValue, payload('run-1', [rec('B1')]));
    const st = (await db.collection(COL.STATE).doc('current').get()).data();
    expect(st.lastRunId).toBe('run-1');
    expect(st.lastCounts.new).toBe(1);
  }, 60_000);
});

describe('دوالّ الاستلام الصافية', () => {
  it('classifyRecord: نفس البصمة تكرار، ومختلفةٌ على مُرحَّل مراجعة', () => {
    const n = normalizeRecord(rec('B1'));
    const h = hashRecord(n);
    expect(classifyRecord(n, h, null).outcome).toBe('new');
    expect(classifyRecord(n, h, { sourceHash: h }).outcome).toBe('duplicate');
    expect(classifyRecord(n, h, { sourceHash: 'other' }).outcome).toBe('modified');
    expect(classifyRecord(n, h, { sourceHash: 'other', processingStatus: 'posted' }))
      .toMatchObject({ outcome: 'needs_review', reasonCode: 'modified_after_posting', variance: true });
  });

  it('diffRecords يسمّي ما تحرّك فقط', () => {
    const a = { x: 1, y: 'ثابت' };
    const b = { x: 2, y: 'ثابت' };
    expect(diffRecords(a, b)).toEqual([{ field: 'x', before: 1, after: 2 }]);
  });

  it('envelopeProblems يرفض دفعةً بلا معرّف، وأخرى تتجاوز الحد بعددها', () => {
    expect(envelopeProblems({ records: [] })[0]).toContain('importRunId');
    const big = envelopeProblems({ importRunId: 'r', records: new Array(MAX_RECORDS + 1).fill({}) });
    expect(big[0]).toContain(String(MAX_RECORDS));
  });

  it('stalenessOf يُحسب لحظة القراءة — فلا يحتاج مجدولاً', () => {
    expect(stalenessOf({}, '2026-06-01T00:00:00Z').stale).toBe(true);
    expect(stalenessOf({ lastSuccessAtIso: '2026-05-31T20:00:00Z' }, '2026-06-01T00:00:00Z').stale)
      .toBe(false);
    const old = stalenessOf({ lastSuccessAtIso: '2026-05-28T00:00:00Z' }, '2026-06-01T00:00:00Z');
    expect(old.stale).toBe(true);
    expect(old.reasonAr).toContain('96');
  });
});
