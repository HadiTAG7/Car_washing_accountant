/**
 * روابط الشركاء — الرمز في الرابط، وبصمته وحدها في المخزن
 * ═══════════════════════════════════════════════════════════════════════════
 * ستة ادعاءات حاملة:
 *   ١) الرمز لا يظهر في المخزن — ولا بصمته في مستندٍ يقرؤه عميل.
 *   ٢) الإنشاء تدويرٌ: الفعّال السابق يموت في نفس المعاملة.
 *   ٣) المُلغى لا يُحَلّ.
 *   ٤) إعادةُ ربط الشريك بحسابٍ آخر تُميت رابط الحساب القديم فوراً.
 *   ٥) شريكٌ محذوف = لا هوية.
 *   ٦) «آخر استعمال» لا يُكتب أكثر من مرةٍ في النافذة.
 *
 * Run: npm run test:functions   (يحتاج المحاكي)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  createPartnerMcpKey, revokePartnerMcpKey, resolvePartnerMcpToken, touchPartnerMcpKey,
  hashToken, isWellFormedToken, TOKEN_RE, KEYS_COL, HASHES_COL, TOUCH_INTERVAL_MS, PartnerMcpKeyError,
} from '../src/partnerMcpKeys.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;
const PROJECT = 'demo-sweater-partner-mcp';

let app, db;

describe('شكل الرمز — بلا محاكي', () => {
  it('البادئة وطول base64url لاثنين وثلاثين بايتاً', () => {
    expect(isWellFormedToken(`pmk_${'a'.repeat(43)}`)).toBe(true);
    expect(isWellFormedToken(`pmk_${'a'.repeat(42)}`)).toBe(false);
    expect(isWellFormedToken(`sk_${'a'.repeat(43)}`)).toBe(false);
    expect(isWellFormedToken('')).toBe(false);
    expect(isWellFormedToken(null)).toBe(false);
    expect(hashToken('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

d('روابط المساعد الذكي للشركاء', () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT }, 'partner-mcp-keys');
    db = getFirestore(app);
  }, 60_000);
  afterAll(async () => { if (app) await deleteApp(app); });

  beforeEach(async () => {
    for (const c of [KEYS_COL, HASHES_COL, 'partners']) {
      const snap = await db.collection(c).get();
      await Promise.all(snap.docs.map((x) => x.ref.delete()));
    }
    await db.collection('partners').doc('p1').set({ partner_name: 'أحمد', workers_count: 2, user_id: 'uid-1', status: 'active' });
  }, 30_000);

  const mint = (over = {}) => createPartnerMcpKey(db, FieldValue, { partnerId: 'p1', ownerUid: 'uid-1', actor: 'uid-1', ...over });

  it('الإنشاء يعطي رمزاً بالشكل المتّفق، ويُحَلّ إلى صاحبه', async () => {
    const k = await mint();
    expect(k.token).toMatch(TOKEN_RE);
    expect(k.keyId).toMatch(/^pmk_[0-9a-f]{16}$/);
    const who = await resolvePartnerMcpToken(db, k.token);
    expect(who).toMatchObject({ keyId: k.keyId, partnerId: 'p1', ownerUid: 'uid-1', partner: { partnerName: 'أحمد', workersCount: 2 } });
  }, 60_000);

  it('والرمز لا يظهر في المخزن — ولا بصمته في مستند المفتاح', async () => {
    const k = await mint();
    const keyDoc = JSON.stringify((await db.collection(KEYS_COL).doc(k.keyId).get()).data());
    expect(keyDoc).not.toContain(k.token);
    expect(keyDoc).not.toContain(hashToken(k.token));
    // البصمة في مجموعتها وحدها، بمعرّفها.
    const hashDoc = await db.collection(HASHES_COL).doc(hashToken(k.token)).get();
    expect(hashDoc.exists).toBe(true);
    expect(hashDoc.data()).toMatchObject({ keyId: k.keyId, partnerId: 'p1', ownerUid: 'uid-1' });
    expect(JSON.stringify(hashDoc.data())).not.toContain(k.token);
  }, 60_000);

  it('الإنشاء الثاني يُلغي الأول في نفس المعاملة — رابطٌ فعّال واحد', async () => {
    const first = await mint();
    const second = await mint();
    expect(second.rotatedKeyIds).toEqual([first.keyId]);
    expect(await resolvePartnerMcpToken(db, first.token)).toBeNull();
    expect((await resolvePartnerMcpToken(db, second.token))?.keyId).toBe(second.keyId);
    const old = (await db.collection(KEYS_COL).doc(first.keyId).get()).data();
    expect(old.status).toBe('revoked');
    expect(old.revokedReason).toBe('تدوير');
    expect((await db.collection(KEYS_COL).doc(second.keyId).get()).data().rotatedFrom).toBe(first.keyId);
  }, 60_000);

  it('المُلغى لا يُحَلّ، وإلغاؤه ثانيةً لا يخطئ', async () => {
    const k = await mint();
    const r = await revokePartnerMcpKey(db, FieldValue, { keyId: k.keyId, actor: 'admin1', reason: 'اختبار' });
    expect(r.status).toBe('revoked');
    expect(await resolvePartnerMcpToken(db, k.token)).toBeNull();
    expect((await revokePartnerMcpKey(db, FieldValue, { keyId: k.keyId })).status).toBe('revoked');
    await expect(revokePartnerMcpKey(db, FieldValue, { keyId: 'pmk_nope' })).rejects.toBeInstanceOf(PartnerMcpKeyError);
  }, 60_000);

  it('إعادة ربط الشريك بحسابٍ آخر تُميت الرابط القديم فوراً', async () => {
    const k = await mint();
    await db.collection('partners').doc('p1').update({ user_id: 'uid-9' });
    expect(await resolvePartnerMcpToken(db, k.token)).toBeNull();
  }, 60_000);

  it('وشريكٌ محذوف = لا هوية', async () => {
    const k = await mint();
    await db.collection('partners').doc('p1').delete();
    expect(await resolvePartnerMcpToken(db, k.token)).toBeNull();
  }, 60_000);

  it('رمزٌ مشوّه أو مجهول: null بلا رمي', async () => {
    expect(await resolvePartnerMcpToken(db, 'x')).toBeNull();
    expect(await resolvePartnerMcpToken(db, `pmk_${'z'.repeat(43)}`)).toBeNull();
  }, 60_000);

  it('«آخر استعمال» يُكتب مرةً في النافذة لا مع كل طلب', async () => {
    const k = await mint();
    const t0 = Date.parse('2026-09-01T10:00:00.000Z');
    expect(await touchPartnerMcpKey(db, FieldValue, { keyId: k.keyId, lastUsedAtIso: null, nowMs: t0 })).toBe(true);
    const iso = (await db.collection(KEYS_COL).doc(k.keyId).get()).data().lastUsedAtIso;
    expect(iso).toBe(new Date(t0).toISOString());
    expect(await touchPartnerMcpKey(db, FieldValue, { keyId: k.keyId, lastUsedAtIso: iso, nowMs: t0 + 1000 })).toBe(false);
    expect(await touchPartnerMcpKey(db, FieldValue, { keyId: k.keyId, lastUsedAtIso: iso, nowMs: t0 + TOUCH_INTERVAL_MS + 1 })).toBe(true);
  }, 60_000);
});
