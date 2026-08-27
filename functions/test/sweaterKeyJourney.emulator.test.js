/**
 * رحلة المفتاح و`dryRun` — التوقيع يمرّ، والمعاينة لا تكتب حرفاً
 * ═══════════════════════════════════════════════════════════════════════════
 * ما تثبته: الرحلة التي سيسلكها المالك فعلاً بعد إصلاح الزرّ —
 *   إنشاء مفتاح ⇒ السرّ يُعرض **مرة** ⇒ القائمة تُظهره فعّالاً **بلا سرّ**
 *   ⇒ توقيعٌ حسب `docs/SWEATER_BROWSER_AGENT.md` ⇒ `dryRun` ينجح
 *   ⇒ **صفر كتابة**: لا خام ولا حجوزات ولا سجل دفعة ولا قيد.
 *
 * والادعاء الأخير هو المحكّ: معاينةٌ تكتب شيئاً ليست معاينة، ومالكٌ جرّب
 * «فقط ليرى» يكون قد استورد.
 *
 * Run: npm run test:emulator
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'node:crypto';

import {
  createIntegrationKey, listIntegrationKeys, verifyIngestRequest, computeSignature,
  KEYS_COL,
} from '../src/sweater/integrationKeys.js';
import { ingestSweaterOperations, COL as SW } from '../src/sweater/ingest.js';
import { canonicalJson } from '../src/sweater/record.js';
import { COL as LEDGER } from '../src/ledger.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;
const PROJECT = 'demo-sweater-keyjourney';

let app, db;

/** بصمة الجسم كما يحسبها الوكيل في المواصفة — SHA256 عن canonicalJson. */
const bodyHashOf = (records) =>
  createHash('sha256').update(canonicalJson(records)).digest('hex');

const RECORDS = [
  {
    sspBookingId: 'DRY-1', serviceType: 'interior_exterior_wash',
    serviceDate: '2026-05-12', rawStatus: 'payment_collection',
    rawPaymentStatus: 'recorded', driverName: 'أحمد', region: 'الرياض',
    platformAmount: 23,
  },
  {
    sspBookingId: 'DRY-2', serviceType: 'polish',
    serviceDate: '2026-05-13', rawStatus: 'admin_cancelled',
    driverName: 'سالم', region: 'جدة', platformAmount: 0,
  },
];

const countAll = async (cols) => {
  const sizes = {};
  for (const c of cols) sizes[c] = (await db.collection(c).get()).size;
  return sizes;
};

d('رحلة المفتاح والمعاينة', () => {
  beforeAll(async () => {
    process.env.SWEATER_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    app = initializeApp({ projectId: PROJECT }, 'sweater-keyjourney');
    db = getFirestore(app);
    for (const c of [KEYS_COL, ...Object.values(SW), LEDGER.ENTRIES, LEDGER.LOCKS]) {
      const snap = await db.collection(c).get();
      await Promise.all(snap.docs.map((x) => x.ref.delete()));
    }
  }, 60_000);

  afterAll(async () => { if (app) await deleteApp(app); });

  it('الرحلة كاملةً — والمعاينة لا تكتب شيئاً', async () => {
    // ══ ١) المدير ينشئ مفتاحاً؛ السرّ يعود مرة واحدة ══
    const key = await createIntegrationKey(db, FieldValue, {
      label: 'وكيل المتصفح', actor: 'admin1',
    });
    expect(key.secret).toBeTruthy();
    expect(key.scope).toBe('integration_ingest');

    // ══ ٢) القائمة تُظهره فعّالاً بلا سرّ ══
    const listed = await listIntegrationKeys(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ keyId: key.keyId, status: 'active' });
    expect(JSON.stringify(listed)).not.toContain(key.secret);
    // ولا في المخزن صريحاً.
    const stored = JSON.stringify((await db.collection(KEYS_COL).doc(key.keyId).get()).data());
    expect(stored).not.toContain(key.secret);

    // ══ ٣) توقيعٌ حسب المواصفة ══
    const importRunId = 'dryrun-probe-2026-05';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const bodyHash = bodyHashOf(RECORDS);
    const signature = computeSignature(key.secret, timestamp, importRunId, bodyHash);

    const auth = await verifyIngestRequest(db, FieldValue, {
      keyId: key.keyId, timestamp, importRunId, bodyHash, signature,
    });
    expect(auth).toMatchObject({ keyId: key.keyId, scope: 'integration_ingest' });

    // ══ ٤) لقطةٌ قبل المعاينة ══
    const WATCHED = [SW.RAW, SW.BOOKINGS, SW.RUNS, SW.VARIANCES, LEDGER.ENTRIES, LEDGER.LOCKS];
    const before = await countAll(WATCHED);
    expect(Object.values(before).every((n) => n === 0)).toBe(true);

    // ══ ٥) dryRun ══
    const res = await ingestSweaterOperations(db, FieldValue, {
      importRunId,
      agentStatus: 'ok',
      coverage: {
        rangeFrom: '2026-05-01', rangeTo: '2026-05-31', extractedAt: '2026-06-01T20:30:00Z',
        pageCount: 1, pagesFetched: 1, recordCount: RECORDS.length, isComplete: true,
        sourceUrl: 'https://ssp-portal.sweater.sa/',
      },
      records: RECORDS,
    }, { actor: auth.principal, dryRun: true });

    expect(res.dryRun).toBe(true);
    expect(res.counts).toMatchObject({ new: 2, rejected: 0 });
    expect(res.rows.map((r) => r.sspBookingId)).toEqual(['DRY-1', 'DRY-2']);
    expect(res.coverageIssues).toEqual([]);
    // والمعاينة لا تُسرّب داخلياتها.
    expect(JSON.stringify(res)).not.toContain('_normalized');

    // ══ ٦) الادعاء الحامل: صفر كتابة ══
    expect(await countAll(WATCHED)).toEqual(before);

    // ══ ٧) وحال التكامل لم يُلمَس — المعاينة ليست «آخر استيراد ناجح» ══
    const stateDoc = await db.collection(SW.STATE).doc('current').get();
    expect(stateDoc.exists).toBe(false);
  }, 180_000);

  it('وتوقيعٌ لجسمٍ آخر يُرفض قبل أي معاينة', async () => {
    const key = (await listIntegrationKeys(db))[0];
    const timestamp = String(Math.floor(Date.now() / 1000));
    await expect(verifyIngestRequest(db, FieldValue, {
      keyId: key.keyId, timestamp, importRunId: 'x',
      bodyHash: bodyHashOf(RECORDS),
      signature: computeSignature('wrong-secret', timestamp, 'x', bodyHashOf(RECORDS)),
    })).rejects.toThrow(/توقيع غير صالح/);
  }, 60_000);

  it('و`canonicalJson` مستقرٌّ مهما اختلف ترتيب المفاتيح — عقد المواصفة', () => {
    // الوكيل يبني الجسم بترتيبٍ قد يخالف ترتيبنا؛ لو تغيّرت البصمة لصار كل
    // استيرادٍ «تعديلاً» ولفشل كل توقيع.
    const a = { b: 1, a: [{ y: 2, x: 1 }] };
    const bb = { a: [{ x: 1, y: 2 }], b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(bb));
    expect(bodyHashOf([a])).toBe(bodyHashOf([bb]));
  });
});
