/**
 * مفاتيح التكامل — سرٌّ لا يُخزَّن صريحاً ولا يُسترجَع، وتوقيعٌ يربط الجسم بزمنه
 * ═══════════════════════════════════════════════════════════════════════════
 * ستة ادعاءات حاملة:
 *   ١) السرّ **لا يظهر في المخزن** — نسخُ قاعدة البيانات لا يعطي مفتاحاً.
 *   ٢) ولا يُسترجَع بعد إنشائه — وإلا صار المخزن كافياً للانتحال.
 *   ٣) التوقيع يربط **الجسم** — طلبٌ التُقط لا يُعاد بجسمٍ آخر.
 *   ٤) ويربط **الزمن** — نافذةٌ تنتهي فيسقط الالتقاط القديم.
 *   ٥) ويربط **معرّف الدفعة** — لا يُنقل توقيعٌ إلى دفعةٍ أخرى.
 *   ٦) المفتاح المُلغى لا يعمل، وحدّ المعدل يقف.
 *
 * Run: npm run test:functions   (يحتاج المحاكي)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import {
  createIntegrationKey, revokeIntegrationKey, listIntegrationKeys,
  verifyIngestRequest, computeSignature, checkRateLimit,
  IntegrationAuthError, INTEGRATION_SCOPE, INTEGRATION_PRINCIPAL,
  KEYS_COL, RATE_MAX_PER_WINDOW, TIMESTAMP_SKEW_SECONDS,
} from '../src/sweater/integrationKeys.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;
const PROJECT = 'demo-sweater-keys';

let app, db;
const NOW = 1780000000000;          // زمنٌ ثابت — لا `Date.now()` في التأكيدات
const ts = () => String(Math.floor(NOW / 1000));

d('مفاتيح تكامل سويتر', () => {
  beforeAll(() => {
    process.env.SWEATER_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    app = initializeApp({ projectId: PROJECT }, 'sweater-keys');
    db = getFirestore(app);
  }, 60_000);

  afterAll(async () => { if (app) await deleteApp(app); });

  beforeEach(async () => {
    for (const c of [KEYS_COL, 'sweater_rate_limits']) {
      const snap = await db.collection(c).get();
      await Promise.all(snap.docs.map((x) => x.ref.delete()));
    }
  }, 30_000);

  const makeKey = () => createIntegrationKey(db, FieldValue, { label: 'وكيل المتصفح', actor: 'admin1' });
  const verify = (key, over = {}) => verifyIngestRequest(db, FieldValue, {
    keyId: key.keyId,
    timestamp: ts(),
    importRunId: 'run-1',
    bodyHash: 'HASH-A',
    signature: computeSignature(key.secret, ts(), 'run-1', 'HASH-A'),
    nowMs: NOW,
    ...over,
  });

  it('الإنشاء يعطي سرّاً مرة واحدة، وبصلاحية الاستلام وحدها', async () => {
    const k = await makeKey();
    expect(k.secret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(k.scope).toBe(INTEGRATION_SCOPE);
    expect(k.fingerprint).toHaveLength(16);
  }, 60_000);

  it('والسرّ لا يظهر في المخزن — نسخُ القاعدة لا يعطي مفتاحاً', async () => {
    // الادعاء الأول.
    const k = await makeKey();
    const stored = JSON.stringify((await db.collection(KEYS_COL).doc(k.keyId).get()).data());
    expect(stored).not.toContain(k.secret);
    expect(stored).toContain('aes-256-gcm');   // مُعمّى لا صريح
  }, 60_000);

  it('ولا يُسترجَع من القائمة مهما كان الطالب', async () => {
    // الادعاء الثاني.
    const k = await makeKey();
    const listed = await listIntegrationKeys(db);
    const body = JSON.stringify(listed);
    expect(body).not.toContain(k.secret);
    expect(body).not.toContain('secretBox');
    expect(listed[0]).toMatchObject({ keyId: k.keyId, status: 'active', fingerprint: k.fingerprint });
  }, 60_000);

  it('والتوقيع الصحيح يمرّ ويُعيد الحساب المستقل لا دوراً في المنظومة', async () => {
    const k = await makeKey();
    const auth = await verify(k);
    expect(auth).toMatchObject({ principal: INTEGRATION_PRINCIPAL, scope: INTEGRATION_SCOPE });
  }, 60_000);

  it('وجسمٌ مختلف بنفس التوقيع يُرفض — الالتقاط لا يُعاد بحمولةٍ أخرى', async () => {
    // الادعاء الثالث: هذا هو شكل هجوم الإعادة المعدَّلة.
    const k = await makeKey();
    await expect(verify(k, { bodyHash: 'HASH-TAMPERED' })).rejects.toThrow(/توقيع غير صالح/);
  }, 60_000);

  it('وتوقيعٌ خارج النافذة الزمنية يُرفض — الالتقاط القديم يسقط', async () => {
    // الادعاء الرابع.
    const old = String(Math.floor(NOW / 1000) - TIMESTAMP_SKEW_SECONDS - 60);
    const k = await makeKey();
    await expect(verify(k, {
      timestamp: old, signature: computeSignature(k.secret, old, 'run-1', 'HASH-A'),
    })).rejects.toThrow(/خارج النافذة/);
  }, 60_000);

  it('وتوقيعُ دفعةٍ لا يصلح لدفعةٍ أخرى', async () => {
    // الادعاء الخامس.
    const k = await makeKey();
    await expect(verify(k, { importRunId: 'run-2' })).rejects.toThrow(/توقيع غير صالح/);
  }, 60_000);

  it('ومفتاحٌ مجهول ومفتاحٌ مُلغى: كلاهما يُرفض', async () => {
    const k = await makeKey();
    await expect(verify(k, { keyId: 'sk_doesnotexist' })).rejects.toThrow(/توقيع غير صالح/);

    await revokeIntegrationKey(db, FieldValue, { keyId: k.keyId, actor: 'admin1', reason: 'تدوير' });
    await expect(verify(k)).rejects.toThrow(/مُلغى/);
    expect((await listIntegrationKeys(db))[0].status).toBe('revoked');
  }, 60_000);

  it('ورسالة الرفض لا تميّز «مفتاح مجهول» عن «توقيع خاطئ» — لا خريطة لمن يجرّب', async () => {
    const k = await makeKey();
    const a = await verify(k, { keyId: 'sk_nope' }).catch((e) => e.message);
    const b = await verify(k, { signature: 'deadbeef'.repeat(8) }).catch((e) => e.message);
    expect(a).toBe(b);
  }, 60_000);

  it('وطلبٌ بلا ترويسات يُرفض قبل أي عمل', async () => {
    await expect(verifyIngestRequest(db, FieldValue, {})).rejects.toThrow(/غير موثّق/);
  }, 60_000);

  it('وحدّ المعدل يقف عند تجاوزه ويقول رقمه', async () => {
    // الادعاء السادس.
    const k = await makeKey();
    for (let i = 0; i < RATE_MAX_PER_WINDOW; i += 1) {
      await checkRateLimit(db, FieldValue, k.keyId, NOW);
    }
    await expect(checkRateLimit(db, FieldValue, k.keyId, NOW))
      .rejects.toThrow(new RegExp(String(RATE_MAX_PER_WINDOW)));
  }, 120_000);

  it('ومفتاحٌ بصلاحيةٍ أخرى لا يدخل هذا الباب مهما كانت', async () => {
    const k = await makeKey();
    await db.collection(KEYS_COL).doc(k.keyId).set({ scope: 'admin' }, { merge: true });
    await expect(verify(k)).rejects.toThrow(/لا تسمح بالاستلام/);
  }, 60_000);

  it('وغياب مفتاح التعمية يُقال بوضوح لا كخطأٍ داخلي', async () => {
    const saved = process.env.SWEATER_KEY_ENCRYPTION_KEY;
    delete process.env.SWEATER_KEY_ENCRYPTION_KEY;
    try {
      await expect(makeKey()).rejects.toThrow(/SWEATER_KEY_ENCRYPTION_KEY/);
    } finally { process.env.SWEATER_KEY_ENCRYPTION_KEY = saved; }
  }, 60_000);
});

describe('computeSignature — صافية', () => {
  it('حتميّة، وتتغيّر بتغيّر أيٍّ من الثلاثة', () => {
    const s = 'secret';
    const base = computeSignature(s, '100', 'run-1', 'H');
    expect(computeSignature(s, '100', 'run-1', 'H')).toBe(base);
    expect(computeSignature(s, '101', 'run-1', 'H')).not.toBe(base);
    expect(computeSignature(s, '100', 'run-2', 'H')).not.toBe(base);
    expect(computeSignature(s, '100', 'run-1', 'H2')).not.toBe(base);
    expect(computeSignature('other', '100', 'run-1', 'H')).not.toBe(base);
  });
});
