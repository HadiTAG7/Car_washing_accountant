/**
 * الباب الثاني، من طرفٍ إلى طرف — بتوكن حقيقي وأدوار حقيقية
 * ═══════════════════════════════════════════════════════════════════════════
 * `handlers.test.js` يفحص البنية. هذا يفحص **المعالج نفسه**: يُستدعى كما
 * يستدعيه المستضيف، بتوكن أصدرته المصادقة فعلاً لمستخدم له دور مكتوب في
 * Firestore، وينتهي بكتابةٍ حقيقية في الدفاتر.
 *
 * ولماذا هو ضروري وليس تكراراً: الـ٤٤ اختبار استدعاء تثبت أن المحاسبة والأدوار
 * صحيحة **خلف Cloud Functions**. وهذا المشروع لا يستطيع تشغيل Cloud Functions
 * — خطة Blaze مرفوضة — فمسار HTTP هو المسار الوحيد الذي سيسلكه كل ترحيل. أن
 * يكون الجزء الوحيد غير المُختبَر من طرفٍ إلى طرف هو الجزء الذي يمرّ منه كل
 * شيء، مقايضةٌ خاطئة.
 *
 * ما يفحصه هنا ولا يفحصه غيره: التحقق من التوكن، وأن التوكن المزوَّر يُرفض،
 * وأن الدور يُقرأ من Firestore لا من التوكن، وخريطة رموز الأخطاء إلى حالات
 * HTTP على أخطاءٍ وقعت فعلاً لا مُفتعَلة.
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

const FS_EMU = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_EMU = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const d = (FS_EMU && AUTH_EMU) ? describe : describe.skip;

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-sweater';
const PASSWORD = 'test-password-123';
const ROLES = ['admin', 'accountant', 'operator', 'partner'];

let adminApp; let db; let adminAuth; let clientAuth;
const uids = {};
const tokens = {};

/** A minimal Vercel-shaped response that records what the handler produced. */
function fakeRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const post = (name, data, token) => {
  const res = fakeRes();
  return handler({
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: { name, data },
  }, res).then(() => res);
};

async function wipe() {
  for (const c of ['chart_of_accounts', 'journal_entries', 'posting_locks',
    'counters', 'accounting_periods', 'audit_logs', 'startup_costs']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((s) => s.ref.delete()));
  }
}

d('واجهة HTTP للخادم الموثوق', () => {
  beforeAll(async () => {
    __resetAdmin();
    adminApp = initAdmin({ projectId: PROJECT }, 'http-api-test');
    db = getFirestore(adminApp);
    adminAuth = getAdminAuth(adminApp);
    const client = initializeApp({ apiKey: 'fake-api-key', projectId: PROJECT }, 'http-api-client');
    clientAuth = getAuth(client);
    connectAuthEmulator(clientAuth, `http://${AUTH_EMU}`, { disableWarnings: true });

    // مستخدمون حقيقيون بأدوار حقيقية — التوكن الذي يتحقق منه المعالج هو توكن
    // يستطيع عميلٌ فعلي أن يقدّمه.
    for (const role of ROLES) {
      const email = `http-${role}@sweater.test`;
      const rec = await adminAuth.createUser({ email, password: PASSWORD })
        .catch(() => adminAuth.getUserByEmail(email));
      uids[role] = rec.uid;
      await db.collection('users').doc(rec.uid).set({ email, role });
      const cred = await signInWithEmailAndPassword(clientAuth, email, PASSWORD);
      tokens[role] = await cred.user.getIdToken();
    }
    // وحسابٌ يسجّل الدخول ولا يملك مستند عضوية.
    const stranger = await adminAuth.createUser({ email: 'http-stranger@sweater.test', password: PASSWORD })
      .catch(() => adminAuth.getUserByEmail('http-stranger@sweater.test'));
    uids.stranger = stranger.uid;
    const c = await signInWithEmailAndPassword(clientAuth, 'http-stranger@sweater.test', PASSWORD);
    tokens.stranger = await c.user.getIdToken();
  }, 120_000);

  afterAll(async () => { if (adminApp) await deleteAdmin(adminApp); });
  beforeEach(async () => { await wipe(); }, 60_000);

  describe('الهوية', () => {
    it('بلا ترويسة: 401', async () => {
      const res = await post('ledgerSeedChart', {}, null);
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('unauthenticated');
    });

    it('وبتوكن مزوَّر: 401 — لا 500 ولا تنفيذ', async () => {
      const res = await post('ledgerSeedChart', {}, 'not.a.real.token');
      expect(res.statusCode).toBe(401);
      expect(res.body.error.message).toMatch(/الجلسة|صالح/);
      // ولم يُكتب شيء.
      expect((await db.collection('chart_of_accounts').get()).size).toBe(0);
    });

    it('وبطريقة غير POST: 405 مع ترويسة Allow', async () => {
      const res = fakeRes();
      await handler({ method: 'GET', headers: {}, body: null }, res);
      expect(res.statusCode).toBe(405);
      expect(res.headers.Allow).toBe('POST');
    });

    it('والتوكن في الجسم لا يُقبل بديلاً عن الترويسة', async () => {
      // توكن في الجسم أو في الرابط تسجّله كل وسيطة بين المتصفح والخادم.
      const res = await post('ledgerSeedChart', { token: tokens.admin }, null);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('الدور يُقرأ من Firestore لا من التوكن', () => {
    it('حساب مسجَّل الدخول بلا مستند عضوية يُرفض', async () => {
      const res = await post('ledgerSeedChart', { accounts: [] }, tokens.stranger);
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('permission-denied');
    });

    it('والشريك للاطلاع فقط', async () => {
      const res = await post('ledgerClosePeriod', { periodKey: '2026-08' }, tokens.partner);
      expect(res.statusCode).toBe(403);
    });

    it('والمشغّل لا يقفل فترة ولا يعكس قيداً', async () => {
      expect((await post('ledgerClosePeriod', { periodKey: '2026-08' }, tokens.operator)).statusCode).toBe(403);
      expect((await post('ledgerReverseEntry', { entryId: 'x' }, tokens.operator)).statusCode).toBe(403);
    });

    it('وإعادة فتح فترة للمدير وحده — المحاسب مرفوض', async () => {
      const res = await post('ledgerReopenPeriod', { periodKey: '2026-08', reason: 'تصحيح' }, tokens.accountant);
      expect(res.statusCode).toBe(403);
    });

    it('وتغيير الدور في Firestore يسري فوراً على نفس التوكن', async () => {
      // الجوهر: الدور ليس في التوكن. حساب رُقِّي — أو خُفِّض — يتغيّر أثره
      // في الطلب التالي، لا بعد انتهاء صلاحية توكنٍ قد يبقى ساعة.
      const before = await post('ledgerSeedChart', { accounts: [] }, tokens.partner);
      expect(before.statusCode).toBe(403);

      await db.collection('users').doc(uids.partner).set(
        { email: 'http-partner@sweater.test', role: 'accountant' },
      );
      const after = await post('ledgerSeedChart', {
        accounts: [{ code: '1000', name: 'النقدية', type: 'asset' }],
      }, tokens.partner);
      expect(after.statusCode).toBe(200);

      await db.collection('users').doc(uids.partner).set(
        { email: 'http-partner@sweater.test', role: 'partner' },
      );
      expect((await post('ledgerSeedChart', { accounts: [] }, tokens.partner)).statusCode).toBe(403);
    }, 60_000);
  });

  describe('التنفيذ الحقيقي', () => {
    it('المحاسب يهيّئ دليل الحسابات، ويُكتب فعلاً', async () => {
      const res = await post('ledgerSeedChart', {
        accounts: [
          { code: '1000', name: 'النقدية', type: 'asset' },
          { code: '4100', name: 'إيرادات الغسيل', type: 'revenue' },
        ],
      }, tokens.accountant);

      expect(res.statusCode).toBe(200);
      expect(res.body.result).toBeTruthy();
      expect((await db.collection('chart_of_accounts').get()).size).toBe(2);
    }, 60_000);

    it('وحالة التهيئة تُقرأ بأي حساب مسجَّل — حتى بلا عضوية', async () => {
      const res = await post('authBootstrapStatus', {}, tokens.stranger);
      expect(res.statusCode).toBe(200);
      expect(res.body.result).toHaveProperty('unclaimed');
    });

    it('واسم عملية مجهول: 404 لا 500', async () => {
      const res = await post('ledgerDropEverything', {}, tokens.admin);
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('not-found');
    });

    it('ورفض محاسبي حقيقي يصل برسالته كاملةً لا بـ«خطأ داخلي»', async () => {
      // فترة غير موجودة: رفضٌ مفهوم يجب أن يقرأه المستخدم ويتصرّف بناءً عليه.
      const res = await post('ledgerReverseEntry', { entryId: 'لا-وجود-له' }, tokens.accountant);
      expect(res.statusCode).not.toBe(500);
      expect(res.body.error.code).not.toBe('internal');
      expect(res.body.error.message.length).toBeGreaterThan(5);
    }, 60_000);
  });
});
