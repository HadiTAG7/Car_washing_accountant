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
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
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
  { code: '1020', nameArabic: 'البنك', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1200', nameArabic: 'ضريبة مدخلات', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1300', nameArabic: 'عهد', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1500', nameArabic: 'أصول ثابتة', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '2000', nameArabic: 'الموردون', accountType: 'liability', normalBalance: 'credit', active: true },
  { code: '2100', nameArabic: 'ضريبة مخرجات', accountType: 'liability', normalBalance: 'credit', active: true },
  { code: '4000', nameArabic: 'إيرادات', accountType: 'revenue', normalBalance: 'credit', active: true },
  { code: '5100', nameArabic: 'مصروفات متغيرة', accountType: 'expense', normalBalance: 'debit', active: true },
  { code: '5200', nameArabic: 'مصروفات شهرية', accountType: 'expense', normalBalance: 'debit', active: true },
  { code: '5300', nameArabic: 'مصروفات إدارية', accountType: 'expense', normalBalance: 'debit', active: true },
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
      paymentMethod: 'cash', paymentStatus: 'paid',
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
      paymentMethod: 'cash', paymentStatus: 'paid',
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
      paymentMethod: 'cash', paymentStatus: 'paid',
    }, { userId: 'acct1' });

    // A client trying to cancel it directly is denied...
    await assertFails(updateDoc(doc(ctx.acct, DOC_COL.DOCUMENTS, res.id), {
      status: 'cancelled', voidReason: 'من العميل',
    }));
    expect((await adb.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data().status).toBe('issued');

    // ...and the callable does it properly, with an audit record.
    await voidDocument(adb, FieldValue, {
      documentId: res.id, reason: 'صدرت بالخطأ', reversalDate: '2026-08-25',
    }, { userId: 'acct1' });
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

  // ═══ كل نوع مصروف على حدة — لا يكفي اختبار الغسلة ══════════════════
  // The server writes `monthly__x`, `variable__x`, … while the rules used to
  // check only `expense__x`. Every expense posted after that change was
  // editable. One case per collection, because a single passing case for
  // `wash` said nothing about the other five.
  describe('كل مجموعة مصروف محميّة بقفلها الجديد', () => {
    const CASES = [
      ['monthly_expenses', 'monthly', { expense_name: 'إيجار', total_monthly_cost: 1150, logged_date: '2026-08-05', payment_status: 'paid' }],
      ['variable_expenses', 'variable', { expense_name: 'مواد', total_variable_cost: 230, logged_date: '2026-08-06' }],
      ['annual_expense_entries', 'annual', { description: 'ترخيص', amount: 1150, spent_date: '2026-08-07' }],
      // `startup_cost_entries` is NOT here any more: it is denied to every
      // client outright, before posting as well as after, because its writes
      // need a roll-up onto the parent that a rule cannot compute. Its own
      // case is below.
    ];

    for (const [coll, kind, row] of CASES) {
      it(`${coll}: قابل للتعديل قبل الترحيل، محميّ بعده`, async () => {
        await adb.collection(coll).doc('x1').set(row);
        // Free while it is not in the books.
        await updateDoc(doc(ctx.op, coll, 'x1'), { note: 'قبل' });

        await postSource(adb, FieldValue, { kind, sourceId: 'x1' }, { userId: 'acct1' });
        expect((await adb.collection(COL.LOCKS).doc(`${kind}__x1`).get()).exists).toBe(true);

        // Now denied for every role — an entry is immutable, so its source
        // must be too.
        await assertFails(updateDoc(doc(ctx.op, coll, 'x1'), { note: 'بعد' }));
        await assertFails(updateDoc(doc(ctx.acct, coll, 'x1'), { note: 'بعد' }));
        await assertFails(updateDoc(doc(ctx.admin, coll, 'x1'), { note: 'بعد' }));
        await assertFails(deleteDoc(doc(ctx.op, coll, 'x1')));
        await assertFails(deleteDoc(doc(ctx.acct, coll, 'x1')));
        await assertFails(deleteDoc(doc(ctx.admin, coll, 'x1')));
      }, 120_000);
    }

    // ── سجل مصاريف التأسيس: مغلق تماماً، لا «حرّ ثم محميّ» ─────────────
    // The other four are free until their posting lock exists. This one is
    // never free: every write re-sums the siblings into the parent's
    // `actual_amount` and re-derives its status, and rules have no fold — so
    // a client write would leave the total as whatever it last claimed. It
    // goes through `startupAddEntry` / `startupDeleteEntry`.
    it('startup_cost_entries: مغلق أمام كل عميل قبل الترحيل وبعده', async () => {
      await adb.collection('startup_costs').doc('sp1').set({
        category: 'equipment', item_name: 'معدات', quantity: 1,
        budgeted_amount: 2000, actual_amount: 0, status: 'in_progress',
      });
      await adb.collection('startup_cost_entries').doc('x1').set({
        startup_cost_id: 'sp1', description: 'معدات', amount: 2300, spent_date: '2026-08-08',
      });
      for (const db of [ctx.op, ctx.acct, ctx.admin]) {
        await assertFails(updateDoc(doc(db, 'startup_cost_entries', 'x1'), { note: 'قبل' }));
        await assertFails(deleteDoc(doc(db, 'startup_cost_entries', 'x1')));
        await assertFails(setDoc(doc(db, 'startup_cost_entries', 'x2'), {
          startup_cost_id: 'sp1', description: 'أخرى', amount: 1, spent_date: '2026-08-09',
        }));
      }
      // …والقراءة سليمة، والترحيل يعمل كالمعتاد.
      await assertSucceeds(getDoc(doc(ctx.op, 'startup_cost_entries', 'x1')));
      await postSource(adb, FieldValue, { kind: 'startup', sourceId: 'x1' }, { userId: 'acct1' });
      expect((await adb.collection(COL.LOCKS).doc('startup__x1').get()).exists).toBe(true);

      // والبند نفسه مغلق للتعديل والحذف من العميل: تعديل الميزانية يجب أن
      // يعيد اشتقاق الحالة في المعاملة نفسها، وهو ما لا تفعله قاعدة.
      await assertFails(updateDoc(doc(ctx.op, 'startup_costs', 'sp1'), { item_name: 'معدات ثقيلة' }));
      await assertFails(updateDoc(doc(ctx.op, 'startup_costs', 'sp1'), { actual_amount: 9999 }));
      await assertFails(updateDoc(doc(ctx.admin, 'startup_costs', 'sp1'), { is_tax_invoice: true }));
      await assertFails(updateDoc(doc(ctx.admin, 'startup_costs', 'sp1'), { status: 'completed' }));
      await assertFails(deleteDoc(doc(ctx.admin, 'startup_costs', 'sp1')));
    }, 120_000);

    for (const [coll, kind, row] of CASES) {   // eslint-disable-line no-unused-vars
      it(`${coll}: القفل القديم expense__<id> ما زال يحمي`, async () => {
        await adb.collection(coll).doc('legacy1').set(row);
        // A lock written before locks were keyed on the kind.
        await adb.collection(COL.LOCKS).doc('expense__legacy1').set({
          sourceType: 'expense', sourceId: 'legacy1', entryId: 'old', entryNumber: 3,
        });
        await assertFails(updateDoc(doc(ctx.op, coll, 'legacy1'), { note: 'x' }));
        await assertFails(deleteDoc(doc(ctx.admin, coll, 'legacy1')));
      }, 90_000);
    }

    it('السند الدوري المُرحَّل مُجمَّد، ولا يُحذف أبداً', async () => {
      await adb.collection('expense_vouchers').doc('t1__2026-08').set({
        templateId: 't1', templateName: 'إيجار', periodKey: '2026-08',
        dueDate: '2026-08-05', amount: 1150, status: 'active', paymentStatus: 'pending',
      });
      // Editable before posting.
      await updateDoc(doc(ctx.acct, 'expense_vouchers', 't1__2026-08'), { paymentStatus: 'paid' });

      await postSource(adb, FieldValue, { kind: 'voucher', sourceId: 't1__2026-08' }, { userId: 'acct1' });

      // Frozen after: marking it paid or cancelling it would leave the entry
      // describing something the voucher no longer says.
      await assertFails(updateDoc(doc(ctx.acct, 'expense_vouchers', 't1__2026-08'), { paymentStatus: 'pending' }));
      await assertFails(updateDoc(doc(ctx.acct, 'expense_vouchers', 't1__2026-08'), {
        status: 'cancelled', cancelReason: 'تراجع',
      }));
      await assertFails(deleteDoc(doc(ctx.admin, 'expense_vouchers', 't1__2026-08')));
    }, 120_000);

    it('العهدة واستردادها قفلان مستقلان', async () => {
      await adb.collection('temporary_expenses').doc('t9').set({
        title: 'عهدة', amount: 500, spent_date: '2026-08-03',
        status: 'recovered', recovered_date: '2026-08-10', payment_method: 'cash',
      });
      await postSource(adb, FieldValue, { kind: 'temporary_expense', sourceId: 't9' }, { userId: 'acct1' });
      await assertFails(updateDoc(doc(ctx.op, 'temporary_expenses', 't9'), { amount: 1 }));
      // Both locks now exist and either alone is enough to protect the row.
      await postSource(adb, FieldValue, { kind: 'recovery', sourceId: 't9' }, { userId: 'acct1' });
      expect((await adb.collection(COL.LOCKS).doc('temporary_expense__t9').get()).exists).toBe(true);
      expect((await adb.collection(COL.LOCKS).doc('recovery__t9').get()).exists).toBe(true);
      await assertFails(deleteDoc(doc(ctx.admin, 'temporary_expenses', 't9')));
    }, 120_000);

    it('دفعة الشريك المُرحَّلة محميّة', async () => {
      await adb.collection('chart_of_accounts').doc('3000-p1').set({
        code: '3000-p1', nameArabic: 'رأس مال — شريك', accountType: 'equity',
        normalBalance: 'credit', active: true,
      });
      await adb.collection('partner_payments').doc('pp9').set({
        partner_id: 'p1', amount: 20000, payment_date: '2026-08-03', payment_method: 'transfer',
      });
      await postSource(adb, FieldValue, { kind: 'partner_payment', sourceId: 'pp9' }, { userId: 'acct1' });
      await assertFails(updateDoc(doc(ctx.op, 'partner_payments', 'pp9'), { amount: 1 }));
      await assertFails(deleteDoc(doc(ctx.admin, 'partner_payments', 'pp9')));
    }, 120_000);

    // ═══ تحويل الاسترداد الضيّق ═══════════════════════════════════════
    // Blocking every update once the outlay posted made recovery impossible
    // to record at all: close a month, and the advance is frozen forever —
    // exactly when salary-deduction needs to mark it recovered. The narrow
    // transition opens ONLY the status/recovered_date/recovery_method trio,
    // and only until the recovery itself posts.
    it('عهدة مُرحَّلة الصرف: المبلغ مجمَّد والاسترداد يُسجَّل', async () => {
      await adb.collection('temporary_expenses').doc('adv1').set({
        title: 'سلفة — أحمد', amount: 500, spent_date: '2026-08-03',
        status: 'pending', recovered_date: null, payment_method: 'cash',
        biker_id: 'b1',
      });
      await postSource(adb, FieldValue, { kind: 'temporary_expense', sourceId: 'adv1' }, { userId: 'acct1' });

      // المبلغ والتاريخ والعنوان مجمَّدون — الصرف في الدفاتر.
      await assertFails(updateDoc(doc(ctx.op, 'temporary_expenses', 'adv1'), { amount: 1 }));
      await assertFails(updateDoc(doc(ctx.op, 'temporary_expenses', 'adv1'), { spent_date: '2026-08-04' }));
      // وخلط التحويل بحقل مجمَّد يسقط الطلب كله.
      await assertFails(updateDoc(doc(ctx.op, 'temporary_expenses', 'adv1'), {
        status: 'recovered', recovered_date: '2026-08-31', amount: 1,
      }));
      // والزوج غير المتّسق مرفوض حتى داخل الحقول المسموحة.
      await assertFails(updateDoc(doc(ctx.op, 'temporary_expenses', 'adv1'), {
        status: 'recovered', recovered_date: null,
      }));

      // التحويل الصحيح يمرّ: يوم صرف الراتب، بنفس حساب النقد.
      await assertSucceeds(updateDoc(doc(ctx.op, 'temporary_expenses', 'adv1'), {
        status: 'recovered', recovered_date: '2026-08-31', recovery_method: 'cash',
      }));
      // والتراجع عنه — ما دام الاسترداد نفسه لم يُرحَّل — يمرّ كذلك.
      await assertSucceeds(updateDoc(doc(ctx.op, 'temporary_expenses', 'adv1'), {
        status: 'pending', recovered_date: null,
      }));
      await assertSucceeds(updateDoc(doc(ctx.op, 'temporary_expenses', 'adv1'), {
        status: 'recovered', recovered_date: '2026-08-31', recovery_method: 'cash',
      }));

      // يُرحَّل الاسترداد → يُغلق حتى هذا الباب، ويبقى الحذف مرفوضاً.
      await postSource(adb, FieldValue, { kind: 'recovery', sourceId: 'adv1' }, { userId: 'acct1' });
      await assertFails(updateDoc(doc(ctx.op, 'temporary_expenses', 'adv1'), {
        status: 'pending', recovered_date: null,
      }));
      await assertFails(deleteDoc(doc(ctx.admin, 'temporary_expenses', 'adv1')));
    }, 120_000);

    // ═══ سجل البايكرات ═════════════════════════════════════════════════
    // Plain operational collection: members read, operators and above write,
    // a partner reads and touches nothing, an account with no membership
    // document sees nothing at all.
    it('بايكرات: العضو يقرأ، المشغّل يكتب، الشريك والغريب لا', async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'users', 'partner1'), { email: 'p@x.com', role: 'partner' });
      });
      const partner = env.authenticatedContext('partner1').firestore();
      const ghost = env.authenticatedContext('ghost1').firestore();

      const biker = {
        name: 'أحمد محمد', contact_number: '0555555555', residence: 'حي النسيم',
        salary: 2000, start_date: '2026-06-01',
        iqama_number: '2222222222', iqama_expiry: '2027-01-01',
      };
      await assertSucceeds(setDoc(doc(ctx.op, 'bikers', 'b1'), biker));
      await assertSucceeds(updateDoc(doc(ctx.op, 'bikers', 'b1'), { salary: 2200 }));
      await assertSucceeds(getDoc(doc(ctx.acct, 'bikers', 'b1')));

      // الشريك للاطلاع فقط — يقرأ ولا يكتب ولا يحذف.
      await assertSucceeds(getDoc(doc(partner, 'bikers', 'b1')));
      await assertFails(setDoc(doc(partner, 'bikers', 'b2'), biker));
      await assertFails(updateDoc(doc(partner, 'bikers', 'b1'), { salary: 1 }));
      await assertFails(deleteDoc(doc(partner, 'bikers', 'b1')));

      // وحساب بلا مستند عضوية لا يقرأ أصلاً.
      await assertFails(getDoc(doc(ghost, 'bikers', 'b1')));

      await assertSucceeds(deleteDoc(doc(ctx.op, 'bikers', 'b1')));
    }, 120_000);
  });
});