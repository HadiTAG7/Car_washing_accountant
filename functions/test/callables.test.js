/**
 * الاستدعاءات الحقيقية — through the Functions emulator, with real tokens.
 *
 * Every other suite calls `postSource` / `issueDocument` through the Admin
 * SDK, which is how a Cloud Function reaches Firestore — but it walks
 * straight past `callerRole`, `requireAccountant` and `requirePostSource`.
 * The role model was therefore asserted, never exercised.
 *
 * These run the deployed callables in the Functions emulator and sign in as a
 * real operator / accountant / admin against the Auth emulator, so the token
 * the function verifies is a token a client could actually present.
 *
 * Run: npm run test:callables
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { initializeApp } from 'firebase/app';
import {
  getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

// `emulators:exec` exports a host for Firestore and Auth but NOT for
// Functions, so the port comes from firebase.test.json — where it is pinned
// precisely so this is not a guess. The Auth host is the reliable signal that
// the full trio is up; `npm run test:functions` starts Firestore alone and
// this suite skips there.
const FS_EMU = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_EMU = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FN_PORT = 5001;
const d = (FS_EMU && AUTH_EMU) ? describe : describe.skip;

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-sweater';
const PASSWORD = 'test-password-123';

let adminApp, adb, clientApp, auth, fns;
const uids = {};

const CHART = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '2000', nameArabic: 'الموردون', accountType: 'liability', normalBalance: 'credit', active: true },
  { code: '2100', nameArabic: 'ضريبة مخرجات', accountType: 'liability', normalBalance: 'credit', active: true },
  { code: '4000', nameArabic: 'إيرادات', accountType: 'revenue', normalBalance: 'credit', active: true },
  { code: '5200', nameArabic: 'مصروفات شهرية', accountType: 'expense', normalBalance: 'debit', active: true },
];

/** Signs in as one of the seeded users and returns a callable factory. */
async function as(role) {
  await signInWithEmailAndPassword(auth, `${role}@sweater.test`, PASSWORD);
  return (name) => httpsCallable(fns, name);
}

/** The callable's error code, e.g. 'permission-denied'. */
const codeOf = (e) => String(e?.code || '').replace(/^functions\//, '');

async function expectDenied(promise) {
  await expect(promise).rejects.toSatisfy(
    (e) => codeOf(e) === 'permission-denied' || codeOf(e) === 'unauthenticated',
    'expected permission-denied or unauthenticated',
  );
}

d('الاستدعاءات الحقيقية عبر محاكي الدوال', () => {
  beforeAll(async () => {
    adminApp = initAdmin({ projectId: PROJECT }, 'callables-admin');
    adb = getFirestore(adminApp);
    const adminAuth = getAdminAuth(adminApp);

    for (const role of ['operator', 'accountant', 'admin', 'partner']) {
      const user = await adminAuth.createUser({
        email: `${role}@sweater.test`, password: PASSWORD,
      });
      uids[role] = user.uid;
    }

    clientApp = initializeApp({ projectId: PROJECT, apiKey: 'fake-api-key' }, 'callables-client');
    auth = getAuth(clientApp);
    connectAuthEmulator(auth, `http://${AUTH_EMU}`, { disableWarnings: true });
    fns = getFunctions(clientApp, 'us-central1');
    connectFunctionsEmulator(fns, '127.0.0.1', FN_PORT);
  }, 120_000);

  afterAll(async () => {
    if (auth) await signOut(auth).catch(() => {});
    if (adminApp) await deleteAdmin(adminApp);
  });

  beforeEach(async () => {
    for (const c of ['users', 'app_admins', 'chart_of_accounts', 'journal_entries',
      'posting_locks', 'counters', 'audit_logs', 'accounting_periods',
      'sales_documents', 'sales_document_sources', 'app_settings',
      'washes', 'monthly_expenses']) {
      const snap = await adb.collection(c).get();
      await Promise.all(snap.docs.map((s) => s.ref.delete()));
    }
    // Roles live in Firestore and the function reads them there, never from a
    // client-supplied claim.
    await adb.collection('users').doc(uids.operator).set({ email: 'o@x', role: 'operator' });
    await adb.collection('users').doc(uids.accountant).set({ email: 'c@x', role: 'accountant' });
    await adb.collection('users').doc(uids.admin).set({ email: 'a@x', role: 'admin' });
    await adb.collection('users').doc(uids.partner).set({ email: 'p@x', role: 'partner' });
    for (const a of CHART) await adb.collection('chart_of_accounts').doc(a.code).set(a);
    await adb.collection('app_settings').doc('company').set({
      value: { name: 'شركة هادي الغانم', vatNumber: '300000000000003', vatRegistered: true },
    });
    await adb.collection('washes').doc('w1').set({
      quantity: 1, price: 115, status: 'مكتملة', wash_date: '2026-08-11', payment_method: 'cash',
    });
    await adb.collection('monthly_expenses').doc('m1').set({
      expense_name: 'إيجار', total_monthly_cost: 1150, logged_date: '2026-08-05', payment_status: 'paid',
    });
    await signOut(auth).catch(() => {});
  }, 120_000);

  // ═══ المشغّل ════════════════════════════════════════════════════════
  describe('المشغّل', () => {
    it('يرحّل الغسلة — وهذا هو الاستثناء الوحيد الممنوح له', async () => {
      const call = await as('operator');
      const res = await call('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' });
      expect(res.data.entryNumber).toBe(1);
      expect(res.data.debit).toBe(115);
      // The author on the entry is HIS uid, taken from the verified token.
      const entry = (await adb.collection('journal_entries').doc(res.data.entryId).get()).data();
      expect(entry.createdBy).toBe(uids.operator);
    }, 60_000);

    it('ولا يرحّل مصروفاً', async () => {
      const call = await as('operator');
      await expectDenied(call('ledgerPostSource')({ kind: 'monthly', sourceId: 'm1' }));
      expect((await adb.collection('journal_entries').get()).size).toBe(0);
    }, 60_000);

    it('ولا يرحّل قيداً يدوياً', async () => {
      const call = await as('operator');
      await expectDenied(call('ledgerPostManual')({
        entry: { entryDate: '2026-08-11', sourceType: 'manual', description: 'قيد' },
        lines: [
          { accountId: '1010', debit: 100, credit: 0 },
          { accountId: '4000', debit: 0, credit: 100 },
        ],
      }));
    }, 60_000);

    it('ولا يصدر فاتورة', async () => {
      const call = await as('operator');
      await expectDenied(call('salesIssueDocument')({
        type: 'invoice', issueDate: '2026-08-11',
        lines: [{ description: 'غسلة', quantity: 1, unitPrice: 115 }],
      }));
      expect((await adb.collection('sales_documents').get()).size).toBe(0);
    }, 60_000);

    it('ولا يقفل فترة ولا يعيد فتحها ولا يعكس قيداً', async () => {
      const call = await as('operator');
      await expectDenied(call('ledgerClosePeriod')({ periodKey: '2026-08' }));
      await expectDenied(call('ledgerReopenPeriod')({ periodKey: '2026-08', reason: 'x' }));
      await expectDenied(call('ledgerReverseEntry')({ entryId: 'x', entryDate: '2026-08-12' }));
    }, 60_000);
  });

  // ═══ المحاسب ════════════════════════════════════════════════════════
  describe('المحاسب', () => {
    it('يصدر فاتورة مرقّمة، والمُصدِر هو هويته المُتحقَّق منها', async () => {
      const call = await as('accountant');
      const res = await call('salesIssueDocument')({
        type: 'invoice', issueDate: '2026-08-11', issueTime: '14:30:00',
        lines: [{ description: 'غسلة خارجية', quantity: 2, unitPrice: 57.5 }],
      });
      expect(res.data.documentNumber).toBe('INV-2026-000001');
      expect(res.data.gross).toBe(115);
      const saved = (await adb.collection('sales_documents').doc(res.data.id).get()).data();
      expect(saved.issuedBy).toBe(uids.accountant);
      // The audit record no client could write.
      expect((await adb.collection('audit_logs').where('action', '==', 'issue').get()).size).toBe(1);
    }, 60_000);

    it('ويرحّل المصروف والقيد اليدوي', async () => {
      const call = await as('accountant');
      const expense = await call('ledgerPostSource')({ kind: 'monthly', sourceId: 'm1' });
      expect(expense.data.kind).toBe('monthly');
      const manual = await call('ledgerPostManual')({
        entry: { entryDate: '2026-08-11', sourceType: 'adjustment', description: 'تسوية' },
        lines: [
          { accountId: '1010', debit: 100, credit: 0 },
          { accountId: '4000', debit: 0, credit: 100 },
        ],
      });
      expect(manual.data.entryNumber).toBeGreaterThan(0);
    }, 90_000);

    it('ولا يعيد فتح فترة — تلك للمدير', async () => {
      const call = await as('accountant');
      await expectDenied(call('ledgerReopenPeriod')({ periodKey: '2026-08', reason: 'تصحيح' }));
    }, 60_000);
  });

  // ═══ المدير وغير المصرّح ════════════════════════════════════════════
  describe('المدير وغير المصرّح له', () => {
    it('المدير يعيد فتح الفترة بسبب', async () => {
      const call = await as('accountant');
      await call('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' });
      await call('ledgerClosePeriod')({ periodKey: '2026-08' });

      const adminCall = await as('admin');
      const res = await adminCall('ledgerReopenPeriod')({
        periodKey: '2026-08', reason: 'فاتورة متأخرة',
      });
      expect(res.data.reason).toBe('فاتورة متأخرة');
      const period = (await adb.collection('accounting_periods').doc('2026-08').get()).data();
      expect(period.status).toBe('open');
      expect(period.reopenedBy).toBe(uids.admin);
    }, 120_000);

    it('الشريك لا يرحّل ولا يصدر', async () => {
      const call = await as('partner');
      await expectDenied(call('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' }));
      await expectDenied(call('salesIssueDocument')({
        type: 'invoice', issueDate: '2026-08-11',
        lines: [{ description: 'x', quantity: 1, unitPrice: 10 }],
      }));
    }, 60_000);

    it('من ليس له سجل مستخدم يُرفض', async () => {
      // The role document is what authorises, not merely holding a token.
      await adb.collection('users').doc(uids.accountant).delete();
      const call = await as('accountant');
      await expectDenied(call('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' }));
    }, 60_000);

    it('وغير المسجَّل أصلاً يُرفض بـ unauthenticated', async () => {
      await signOut(auth);
      await expect(httpsCallable(fns, 'ledgerPostSource')({ kind: 'wash', sourceId: 'w1' }))
        .rejects.toSatisfy((e) => codeOf(e) === 'unauthenticated');
    }, 60_000);
  });

  // ═══ قيود نهاية الفترة تحتاج معرّف مصدر ═════════════════════════════
  // Depreciation and disposal are the only manual kinds that carry a source
  // id, and that id is their entire idempotency: without it there is no lock,
  // so the same month could be charged again and again.
  describe('الإهلاك والاستبعاد يحتاجان معرّف مصدر', () => {
    const DEP = {
      entry: { entryDate: '2026-08-31', sourceType: 'depreciation', description: 'إهلاك أغسطس' },
      lines: [
        { accountId: '5200', debit: 200, credit: 0 },
        { accountId: '1010', debit: 0, credit: 200 },
      ],
    };

    it('يرفض إهلاكاً بلا معرّف مصدر ولا ينشئ قيداً ولا قفلاً', async () => {
      const call = await as('accountant');
      await expect(call('ledgerPostManual')(DEP))
        .rejects.toSatisfy((e) => codeOf(e) === 'invalid-argument');
      await expect(call('ledgerPostManual')({ ...DEP, entry: { ...DEP.entry, sourceId: '' } }))
        .rejects.toSatisfy((e) => codeOf(e) === 'invalid-argument');
      await expect(call('ledgerPostManual')({ ...DEP, entry: { ...DEP.entry, sourceId: '   ' } }))
        .rejects.toSatisfy((e) => codeOf(e) === 'invalid-argument');
      expect((await adb.collection('journal_entries').get()).size).toBe(0);
      expect((await adb.collection('posting_locks').get()).size).toBe(0);
    }, 90_000);

    it('ويرفض استبعاداً بلا معرّف أصل', async () => {
      const call = await as('accountant');
      await expect(call('ledgerPostManual')({
        ...DEP, entry: { ...DEP.entry, sourceType: 'disposal', description: 'استبعاد' },
      })).rejects.toSatisfy((e) => codeOf(e) === 'invalid-argument');
    }, 60_000);

    it('وبمعرّف صحيح يُرحَّل مرة واحدة ولا يتكرر', async () => {
      const call = await as('accountant');
      const first = await call('ledgerPostManual')({
        ...DEP, entry: { ...DEP.entry, sourceId: '2026-08' },
      });
      expect(first.data.entryNumber).toBe(1);
      expect((await adb.collection('posting_locks').doc('depreciation__2026-08').get()).exists).toBe(true);

      await expect(call('ledgerPostManual')({
        ...DEP, entry: { ...DEP.entry, sourceId: '2026-08' },
      })).rejects.toSatisfy((e) => codeOf(e) === 'already-exists');
      expect((await adb.collection('journal_entries').get()).size).toBe(1);
    }, 90_000);

    it('والقيد اليدوي العادي لا يحمل معرّفاً ولا قفلاً', async () => {
      const call = await as('accountant');
      const res = await call('ledgerPostManual')({
        entry: { entryDate: '2026-08-11', sourceType: 'manual', description: 'تسوية', sourceId: 'محاولة' },
        lines: [
          { accountId: '1010', debit: 100, credit: 0 },
          { accountId: '4000', debit: 0, credit: 100 },
        ],
      });
      const entry = (await adb.collection('journal_entries').doc(res.data.entryId).get()).data();
      expect(entry.sourceId).toBeNull();
      expect((await adb.collection('posting_locks').get()).size).toBe(0);
    }, 60_000);
  });
});