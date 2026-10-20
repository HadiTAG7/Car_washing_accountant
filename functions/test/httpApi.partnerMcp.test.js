/**
 * إنشاء رابط الشريك وإلغاؤه — عبر الباب الثاني، بتوكن حقيقي
 * ═══════════════════════════════════════════════════════════════════════════
 * الحارسان الجديدان لا يشبهان بقية الحرّاس: `partnerSelf` يقرّر أيَّ شريك
 * من الربط لا من الحمولة، و`partnerKeyActor` يقرّر الملكية من المستند. هذا
 * ما يُثبَت هنا من طرفٍ إلى طرف.
 *
 * Run: npm run test:callables
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

import handler, { __resetAdmin } from '../../api/ledger.js';
import { KEYS_COL, HASHES_COL, TOKEN_RE } from '../src/partnerMcpKeys.js';

const FS_EMU = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_EMU = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const d = (FS_EMU && AUTH_EMU) ? describe : describe.skip;

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-sweater';
const PASSWORD = 'test-password-123';
// linked: شريكٌ مربوط بصفّ؛ unlinked: شريكٌ بلا صفّ؛ other: شريكٌ آخر مربوط.
const ACCOUNTS = ['admin', 'linked', 'unlinked', 'other', 'operator'];

let adminApp; let db; let adminAuth; let clientAuth;
const uids = {};
const tokens = {};

function fakeRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const post = (name, data, token) => {
  const res = fakeRes();
  return handler({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: { name, data } }, res)
    .then(() => res);
};

d('روابط المساعد الذكي عبر HTTP', () => {
  beforeAll(async () => {
    __resetAdmin();
    adminApp = initAdmin({ projectId: PROJECT }, 'partner-mcp-http-test');
    db = getFirestore(adminApp);
    adminAuth = getAdminAuth(adminApp);
    const client = initializeApp({ apiKey: 'fake-api-key', projectId: PROJECT }, 'partner-mcp-http-client');
    clientAuth = getAuth(client);
    connectAuthEmulator(clientAuth, `http://${AUTH_EMU}`, { disableWarnings: true });

    for (const who of ACCOUNTS) {
      const email = `pmcp-${who}@sweater.test`;
      const rec = await adminAuth.createUser({ email, password: PASSWORD }).catch(() => adminAuth.getUserByEmail(email));
      uids[who] = rec.uid;
      const role = who === 'admin' ? 'admin' : (who === 'operator' ? 'operator' : 'partner');
      await db.collection('users').doc(rec.uid).set({ email, role });
      const cred = await signInWithEmailAndPassword(clientAuth, email, PASSWORD);
      tokens[who] = await cred.user.getIdToken();
    }
  }, 120_000);

  afterAll(async () => { if (adminApp) await deleteAdmin(adminApp); });

  beforeEach(async () => {
    for (const c of [KEYS_COL, HASHES_COL, 'partners']) {
      const snap = await db.collection(c).get();
      await Promise.all(snap.docs.map((s) => s.ref.delete()));
    }
    await db.collection('partners').doc('pl').set({ partner_name: 'مربوط', workers_count: 2, user_id: uids.linked });
    await db.collection('partners').doc('po').set({ partner_name: 'آخر', workers_count: 3, user_id: uids.other });
  }, 60_000);

  it('الشريك المربوط ينشئ رابطه — والرمز في الردّ وحده', async () => {
    const res = await post('partnerMcpCreateKey', { label: 'جهازي' }, tokens.linked);
    expect(res.statusCode).toBe(200);
    expect(res.body.result.token).toMatch(TOKEN_RE);
    const stored = await db.collection(KEYS_COL).doc(res.body.result.keyId).get();
    expect(stored.data()).toMatchObject({ partnerId: 'pl', ownerUid: uids.linked, status: 'active', label: 'جهازي' });
    expect(JSON.stringify(stored.data())).not.toContain(res.body.result.token);
  }, 60_000);

  it('ولا يختار شريكاً من الحمولة — الربط يقرّر', async () => {
    const res = await post('partnerMcpCreateKey', { partnerId: 'po' }, tokens.linked);
    expect(res.statusCode).toBe(200);
    expect((await db.collection(KEYS_COL).doc(res.body.result.keyId).get()).data().partnerId).toBe('pl');
  }, 60_000);

  it('شريكٌ بلا ربط: 412 برسالةٍ تسمّي الإجراء', async () => {
    const res = await post('partnerMcpCreateKey', {}, tokens.unlinked);
    expect(res.statusCode).toBe(412);
    expect(res.body.error.message).toMatch(/غير مربوط/);
  }, 60_000);

  it('والمشغّل والمدير بلا صفّ: 412 كذلك — الرابط لمن له حصّة', async () => {
    expect((await post('partnerMcpCreateKey', {}, tokens.operator)).statusCode).toBe(412);
    expect((await post('partnerMcpCreateKey', {}, tokens.admin)).statusCode).toBe(412);
  }, 60_000);

  it('الإلغاء: صاحبه نعم، وشريكٌ آخر 403، والمدير نعم', async () => {
    const mint = await post('partnerMcpCreateKey', {}, tokens.linked);
    const { keyId } = mint.body.result;

    const foreign = await post('partnerMcpRevokeKey', { keyId }, tokens.other);
    expect(foreign.statusCode).toBe(403);
    expect((await db.collection(KEYS_COL).doc(keyId).get()).data().status).toBe('active');

    const own = await post('partnerMcpRevokeKey', { keyId, reason: 'بدّلت جهازي' }, tokens.linked);
    expect(own.statusCode).toBe(200);
    expect(own.body.result.status).toBe('revoked');

    const again = await post('partnerMcpCreateKey', {}, tokens.linked);
    const byAdmin = await post('partnerMcpRevokeKey', { keyId: again.body.result.keyId }, tokens.admin);
    expect(byAdmin.statusCode).toBe(200);
  }, 60_000);

  it('المؤشرات: الشريك عن نفسه ولو سمّى غيره، والمدير عن من يسمّيه، وغير المربوط 412', async () => {
    await db.collection('washes').add({ biker_name: 'خالد', quantity: 100, status: 'مكتملة', wash_date: new Date().toISOString().slice(0, 10), price: 10 });
    // الشريك المربوط بـ pl (عمالة 2 من 5 = 40%) يطلب po — يُتجاهَل ويحصل على حصّته هو.
    const mine = await post('partnerInsights', { partnerId: 'po', months: 1 }, tokens.linked);
    expect(mine.statusCode).toBe(200);
    expect(mine.body.result.partnerId).toBe('pl');
    // 40% of 100 washes — but neither the 40% nor the 100 reaches the partner.
    expect(mine.body.result.months[0]).toEqual({ month: mine.body.result.months[0].month, shareCount: 40 });
    for (const key of ['sharePercent', 'factor', 'totalWorkers', 'companyCount']) {
      expect(JSON.stringify(mine.body)).not.toContain(`"${key}"`);
    }
    expect(JSON.stringify(mine.body)).not.toContain('خالد');

    const asAdmin = await post('partnerInsights', { partnerId: 'po', months: 1 }, tokens.admin);
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.body.result.partnerId).toBe('po');
    expect(asAdmin.body.result.sharePercent).toBe(60);

    expect((await post('partnerInsights', { partnerId: 'nope' }, tokens.admin)).statusCode).toBe(404);
    expect((await post('partnerInsights', {}, tokens.unlinked)).statusCode).toBe(412);
    const snap = await db.collection('washes').get();
    await Promise.all(snap.docs.map((x) => x.ref.delete()));
  }, 60_000);

  it('ملف الشريك: صفّه هو وحده ولو سمّى غيره، بلا ربطٍ ولا جوال، وغير المربوط 412', async () => {
    await db.collection('partners').doc('pl').update({ contact_number: '0500000000', paid_amount: 999 });
    const mine = await post('partnerProfile', { partnerId: 'po' }, tokens.linked);
    expect(mine.statusCode).toBe(200);
    expect(mine.body.result).toEqual({ id: 'pl', partnerName: 'مربوط', workersCount: 2, status: 'active' });
    expect((await post('partnerProfile', {}, tokens.unlinked)).statusCode).toBe(412);
    expect((await post('partnerProfile', {}, null)).statusCode).toBe(401);
  }, 60_000);

  it('جلسةٌ أُلغيت: 401 فوراً لا بعد انتهاء التوكن', async () => {
    const email = 'pmcp-revoked@sweater.test';
    const rec = await adminAuth.createUser({ email, password: PASSWORD }).catch(() => adminAuth.getUserByEmail(email));
    await db.collection('users').doc(rec.uid).set({ email, role: 'partner' });
    await db.collection('partners').doc('pr').set({ partner_name: 'ملغى', workers_count: 1, user_id: rec.uid });
    const token = await (await signInWithEmailAndPassword(clientAuth, email, PASSWORD)).user.getIdToken();
    expect((await post('partnerProfile', {}, token)).statusCode).toBe(200);
    // Revocation is recorded to the second; the token above must predate it.
    await new Promise((r) => setTimeout(r, 1100));
    await adminAuth.revokeRefreshTokens(rec.uid);
    expect((await post('partnerProfile', {}, token)).statusCode).toBe(401);
  }, 60_000);

  it('ومعرّفٌ لا وجود له: 404، وبلا توكن: 401', async () => {
    expect((await post('partnerMcpRevokeKey', { keyId: 'pmk_nope' }, tokens.admin)).statusCode).toBe(404);
    expect((await post('partnerMcpCreateKey', {}, null)).statusCode).toBe(401);
  }, 60_000);
});
