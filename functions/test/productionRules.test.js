/**
 * رحلة كاملة تحت قواعد الإنتاج الفعلية.
 *
 * The other suites prove the two halves separately: `rules.emulator.test.js`
 * drives the rules with client credentials, and the server suites drive the
 * functions with admin credentials. Neither shows the two working TOGETHER,
 * and the gap between them is exactly where the invoicing bug lived — a
 * client transaction that the rules had quietly started denying.
 *
 * So this one runs both against ONE database loaded with the real
 * `firestore.rules` — never `firestore.test.rules`, which is permissive and
 * proves nothing about production:
 *
 *   1. a callable issues an invoice and it succeeds;
 *   2. the audit record it wrote is really there;
 *   3. the same client, with the same credentials, cannot write any of it
 *      directly.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { issueDocument, voidDocument, DOC_COL } from '../src/invoicing.js';
import { postSource, reverseEntry, seedChartOfAccounts, COL } from '../src/ledger.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

const PROJECT = 'demo-sweater-prodrules';

let env, adminApp, adb;
const ctx = {};

const COMPANY = {
  name: 'شركة هادي الغانم', vatNumber: '300000000000003',
  address: 'الرياض', vatRegistered: true,
};
const LINES = [{ description: 'غسلة خارجية', quantity: 2, unitPrice: 57.5 }];

const CHART = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '2100', nameArabic: 'ضريبة مخرجات', accountType: 'liability', normalBalance: 'credit', active: true },
  { code: '4000', nameArabic: 'إيرادات', accountType: 'revenue', normalBalance: 'credit', active: true },
];

d('رحلة الإنتاج تحت firestore.rules الفعلية', () => {
  beforeAll(async () => {
    const [host, port] = EMU.split(':');
    env = await initializeTestEnvironment({
      projectId: PROJECT,
      firestore: {
        host, port: Number(port),
        // The REAL rules. A permissive test ruleset here would prove nothing.
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
    // The Admin SDK bypasses rules, exactly as a Cloud Function does.
    adminApp = initializeApp({ projectId: PROJECT }, 'prod-rules-admin');
    adb = getFirestore(adminApp);
  }, 60_000);

  afterAll(async () => {
    if (env) await env.cleanup();
    if (adminApp) await deleteApp(adminApp);
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, 'users', 'admin1'), { email: 'a@x.com', role: 'admin' });
      await setDoc(doc(db, 'users', 'acct1'), { email: 'c@x.com', role: 'accountant' });
      await setDoc(doc(db, 'users', 'op1'), { email: 'o@x.com', role: 'operator' });
      await setDoc(doc(db, 'app_admins', 'admin1'), { note: 'admin' });
    });
    await adb.collection(DOC_COL.SETTINGS).doc('company').set({ value: COMPANY });
    await seedChartOfAccounts(adb, FieldValue, CHART, { userId: 'acct1' });
    ctx.admin = env.authenticatedContext('admin1').firestore();
    ctx.acct  = env.authenticatedContext('acct1').firestore();
    ctx.op    = env.authenticatedContext('op1').firestore();
  }, 60_000);

  // ═══ الرحلة الكاملة ═════════════════════════════════════════════════
  it('إصدار عبر الدالة ينجح، والأثر موجود، والكتابة المباشرة تفشل', async () => {
    // 1 — the callable path succeeds under the production rules.
    const res = await issueDocument(adb, FieldValue, {
      type: 'invoice', issueDate: '2026-08-11', issueTime: '14:30:00', lines: LINES,
    }, { userId: 'acct1' });
    expect(res.documentNumber).toBe('INV-2026-000001');
    expect(res.gross).toBe(115);

    // 2 — the document and its audit record are really there, and a member
    //     can read them.
    const readBack = await getDoc(doc(ctx.acct, DOC_COL.DOCUMENTS, res.id));
    expect(readBack.exists()).toBe(true);
    expect(readBack.data().vat).toBe(15);
    const audit = await getDocs(collection(ctx.acct, 'audit_logs'));
    expect(audit.docs.filter((a) => a.data().action === 'issue')).toHaveLength(1);

    // 3 — the SAME client cannot write any of it directly.
    await assertFails(setDoc(doc(ctx.acct, DOC_COL.DOCUMENTS, 'forged'), {
      type: 'invoice', status: 'issued', documentNumber: 'INV-2026-000002', gross: 1,
    }));
    await assertFails(updateDoc(doc(ctx.acct, DOC_COL.DOCUMENTS, res.id), { gross: 1 }));
    await assertFails(deleteDoc(doc(ctx.admin, DOC_COL.DOCUMENTS, res.id)));
    await assertFails(setDoc(doc(ctx.acct, 'audit_logs', 'forged'), { action: 'issue' }));
    await assertFails(setDoc(doc(ctx.acct, DOC_COL.SOURCES, 'wash__w1'), { documentId: res.id }));
  }, 120_000);

  it('عدّاد المستندات لا يُغيَّر من محاسب ولا من مدير', async () => {
    await issueDocument(adb, FieldValue, {
      type: 'invoice', issueDate: '2026-08-11', lines: LINES,
    }, { userId: 'acct1' });

    // The counter now sits at 2. Neither role may touch it — a client that
    // could set it back could reissue a number already on a filed document.
    await assertFails(setDoc(doc(ctx.acct, 'counters', 'documents-invoice-2026'), { nextNumber: 1 }));
    await assertFails(setDoc(doc(ctx.admin, 'counters', 'documents-invoice-2026'), { nextNumber: 1 }));
    await assertFails(updateDoc(doc(ctx.admin, 'counters', 'documents-invoice-2026'), { nextNumber: 99 }));
    await assertFails(setDoc(doc(ctx.admin, 'counters', 'journal'), { nextNumber: 1 }));

    const counter = await adb.collection('counters').doc('documents-invoice-2026').get();
    expect(counter.data().nextNumber).toBe(2);
  }, 90_000);

  it('الإلغاء عبر الدالة ينجح، وإلغاء العميل المباشر يفشل', async () => {
    const res = await issueDocument(adb, FieldValue, {
      type: 'invoice', issueDate: '2026-08-11', lines: LINES,
    }, { userId: 'acct1' });

    // A client trying to cancel it directly is denied...
    await assertFails(updateDoc(doc(ctx.acct, DOC_COL.DOCUMENTS, res.id), {
      status: 'cancelled', voidReason: 'من العميل',
    }));
    expect((await adb.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data().status).toBe('issued');

    // ...and the callable does it properly, with an audit record.
    await voidDocument(adb, FieldValue, { documentId: res.id, reason: 'صدرت بالخطأ' }, { userId: 'acct1' });
    const after = (await adb.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
    expect(after.status).toBe('cancelled');
    expect(after.voidReason).toBe('صدرت بالخطأ');
    expect((await adb.collection('audit_logs').where('action', '==', 'void').get()).size).toBe(1);
  }, 90_000);

  it('ترحيل غسلة عبر الدالة يقفل السجل، والقواعد تحمي المصدر بعدها', async () => {
    await adb.collection('washes').doc('w1').set({
      quantity: 1, price: 115, status: 'مكتملة', wash_date: '2026-08-11', payment_method: 'cash',
    });
    // Editable while it is not in the books.
    await updateDoc(doc(ctx.op, 'washes', 'w1'), { price: 115 });

    const posted = await postSource(adb, FieldValue, { kind: 'wash', sourceId: 'w1' }, { userId: 'acct1' });
    expect(posted.debit).toBe(115);

    // Now the lock exists and the production rules refuse an edit or a delete.
    await assertFails(updateDoc(doc(ctx.op, 'washes', 'w1'), { price: 1 }));
    await assertFails(deleteDoc(doc(ctx.admin, 'washes', 'w1')));
    // And nobody may remove the lock to get around that.
    await assertFails(deleteDoc(doc(ctx.admin, 'posting_locks', 'wash__w1')));
    await assertFails(setDoc(doc(ctx.acct, 'journal_entries', 'forged'), {
      entryDate: '2026-08-11', periodKey: '2026-08', status: 'posted',
      lines: [{ accountId: '1010', debit: 1, credit: 0 }, { accountId: '4000', debit: 0, credit: 1 }],
    }));

    // Reversing through the function releases it, and the record is editable
    // again — reverse, fix, re-post.
    await reverseEntry(adb, FieldValue, posted.entryId, { entryDate: '2026-08-20', userId: 'acct1' });
    expect((await adb.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(false);
    await updateDoc(doc(ctx.op, 'washes', 'w1'), { price: 230 });
  }, 120_000);
});
