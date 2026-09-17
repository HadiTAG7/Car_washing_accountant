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

  it('ومعرّفٌ لا وجود له: 404، وبلا توكن: 401', async () => {
    expect((await post('partnerMcpRevokeKey', { keyId: 'pmk_nope' }, tokens.admin)).statusCode).toBe(404);
    expect((await post('partnerMcpCreateKey', {}, null)).statusCode).toBe(401);
  }, 60_000);
});
