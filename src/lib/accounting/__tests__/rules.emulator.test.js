/**
 * اختبارات قواعد الأمان — the real firestore.rules, against the emulator.
 *
 * These load `firestore.rules` verbatim and drive it with different auth
 * contexts, so the security model is proven rather than assumed. The two
 * guarantees that matter most get their own cases: no client may write
 * `app_admins`, and no client may amend or delete a posted entry.
 *
 * Run: npm run test:rules
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let env;
const ctx = {};

d('قواعد أمان Firestore', () => {
  beforeAll(async () => {
    const [host, port] = EMU.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-sweater-rules',
      firestore: {
        host, port: Number(port),
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
  }, 60_000);

  afterAll(async () => { if (env) await env.cleanup(); });

  beforeEach(async () => {
    await env.clearFirestore();
    // Seed the role documents with rules disabled — provisioning is a
    // console/server operation, which is exactly what the rules enforce.
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, 'users', 'admin1'),      { email: 'a@x.com', role: 'admin' });
      await setDoc(doc(db, 'users', 'acct1'),       { email: 'c@x.com', role: 'accountant' });
      await setDoc(doc(db, 'users', 'op1'),         { email: 'o@x.com', role: 'operator' });
      await setDoc(doc(db, 'users', 'partner1'),    { email: 'p@x.com', role: 'partner' });
      await setDoc(doc(db, 'app_admins', 'admin1'), { note: 'admin' });
      // A posted entry to attack in the immutability cases.
      await setDoc(doc(db, 'journal_entries', 'e1'), {
        entryDate: '2026-08-11', periodKey: '2026-08', status: 'posted',
        entryNumber: 1, sourceType: 'wash', description: 'غسلة',
      });
      await setDoc(doc(db, 'journal_lines', 'l1'), {
        entryId: 'e1', accountId: '1010', debit: 115, credit: 0,
      });
    });
    ctx.admin   = env.authenticatedContext('admin1').firestore();
    ctx.acct    = env.authenticatedContext('acct1').firestore();
    ctx.op      = env.authenticatedContext('op1').firestore();
    ctx.partner = env.authenticatedContext('partner1').firestore();
    ctx.anon    = env.unauthenticatedContext().firestore();
  }, 30_000);

  // ── تصعيد الصلاحيات ────────────────────────────────────────────────
  describe('app_admins محميّة من العميل', () => {
    it('لا يستطيع المدير نفسه الكتابة فيها', async () => {
      await assertFails(setDoc(doc(ctx.admin, 'app_admins', 'op1'), { note: 'hack' }));
    });
    it('ولا المحاسب ولا المشغّل ولا الزائر', async () => {
      await assertFails(setDoc(doc(ctx.acct, 'app_admins', 'op1'), { note: 'x' }));
      await assertFails(setDoc(doc(ctx.op, 'app_admins', 'op1'), { note: 'x' }));
      await assertFails(setDoc(doc(ctx.anon, 'app_admins', 'x'), { note: 'x' }));
    });
    it('ولا يستطيع أحد حذف صف مدير قائم', async () => {
      await assertFails(deleteDoc(doc(ctx.admin, 'app_admins', 'admin1')));
    });
    it('المدير يقرأها، وغيره لا', async () => {
      await assertSucceeds(getDoc(doc(ctx.admin, 'app_admins', 'admin1')));
      await assertFails(getDoc(doc(ctx.op, 'app_admins', 'admin1')));
    });
  });

  // ── حصانة القيد المرحّل ────────────────────────────────────────────
  describe('القيد المُرحّل غير قابل للتعديل أو الحذف', () => {
    it('لا يُعدَّل مبلغ أو تاريخ قيد مرحّل', async () => {
      await assertFails(updateDoc(doc(ctx.acct, 'journal_entries', 'e1'), { entryDate: '2026-09-01' }));
      await assertFails(updateDoc(doc(ctx.admin, 'journal_entries', 'e1'), { description: 'تلاعب' }));
    });
    it('لا يُحذف قيد مرحّل — ولا حتى من المدير', async () => {
      await assertFails(deleteDoc(doc(ctx.admin, 'journal_entries', 'e1')));
      await assertFails(deleteDoc(doc(ctx.acct, 'journal_entries', 'e1')));
    });
    it('لا تُعدَّل أو تُحذف سطور القيد أبداً', async () => {
      await assertFails(updateDoc(doc(ctx.acct, 'journal_lines', 'l1'), { debit: 999 }));
      await assertFails(deleteDoc(doc(ctx.admin, 'journal_lines', 'l1')));
    });
    it('يُسمح فقط بالانتقال المسموح: مُرحّل ← معكوس', async () => {
      await assertSucceeds(updateDoc(doc(ctx.acct, 'journal_entries', 'e1'), {
        status: 'reversed', reversedBy: 'e2', reversedAt: new Date(),
      }));
    });
    it('ولا يُسمح بتمرير تعديل آخر مع انتقال العكس', async () => {
      await assertFails(updateDoc(doc(ctx.acct, 'journal_entries', 'e1'), {
        status: 'reversed', reversedBy: 'e2', description: 'تلاعب مخفي',
      }));
    });
  });

  // ── الأدوار ────────────────────────────────────────────────────────
  describe('فصل الصلاحيات بين الأدوار', () => {
    const entry = {
      entryDate: '2026-08-12', periodKey: '2026-08', status: 'posted',
      entryNumber: 2, sourceType: 'manual', description: 'قيد',
    };

    it('المحاسب يُرحّل، والمشغّل لا', async () => {
      await assertSucceeds(setDoc(doc(ctx.acct, 'journal_entries', 'e2'), entry));
      await assertFails(setDoc(doc(ctx.op, 'journal_entries', 'e3'), entry));
    });

    it('الشريك للقراءة فقط: يقرأ العمليات ولا يكتبها', async () => {
      await assertSucceeds(getDocs(collection(ctx.partner, 'washes')));
      await assertFails(setDoc(doc(ctx.partner, 'washes', 'w1'), { quantity: 1 }));
    });

    it('المشغّل يسجّل العمليات اليومية', async () => {
      await assertSucceeds(setDoc(doc(ctx.op, 'washes', 'w2'), {
        quantity: 1, price: 100, status: 'مكتملة', wash_date: '2026-08-12',
      }));
    });

    it('المشغّل لا يعبث بدليل الحسابات ولا بقواعد الرسوم', async () => {
      await assertFails(setDoc(doc(ctx.op, 'chart_of_accounts', '9999'), { code: '9999' }));
      await assertFails(setDoc(doc(ctx.op, 'fee_rules', 'r1'), { rate: 0.5 }));
    });

    it('المحاسب لا يغيّر قواعد الرسوم — قرار إداري', async () => {
      await assertFails(setDoc(doc(ctx.acct, 'fee_rules', 'r1'), { rate: 0.5 }));
      await assertSucceeds(setDoc(doc(ctx.admin, 'fee_rules', 'r1'), { rate: 0.05 }));
    });

    it('الزائر غير المسجَّل لا يقرأ شيئاً', async () => {
      await assertFails(getDocs(collection(ctx.anon, 'washes')));
      await assertFails(getDocs(collection(ctx.anon, 'journal_entries')));
      await assertFails(getDoc(doc(ctx.anon, 'chart_of_accounts', '1010')));
    });
  });

  // ── سجل التدقيق ────────────────────────────────────────────────────
  describe('سجل التدقيق للإضافة فقط', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'audit_logs', 'a1'), { action: 'post', userId: 'acct1' });
      });
    });
    it('يمكن الإضافة', async () => {
      await assertSucceeds(setDoc(doc(ctx.op, 'audit_logs', 'a2'), { action: 'create', userId: 'op1' }));
    });
    it('ولا يمكن التعديل أو الحذف — ولا للمدير', async () => {
      await assertFails(updateDoc(doc(ctx.admin, 'audit_logs', 'a1'), { action: 'tamper' }));
      await assertFails(deleteDoc(doc(ctx.admin, 'audit_logs', 'a1')));
    });
    it('المشغّل لا يقرأ السجل', async () => {
      await assertFails(getDoc(doc(ctx.op, 'audit_logs', 'a1')));
      await assertSucceeds(getDoc(doc(ctx.acct, 'audit_logs', 'a1')));
    });
  });

  // ── بيانات المستخدمين ──────────────────────────────────────────────
  describe('خصوصية سجلات المستخدمين', () => {
    it('المستخدم يقرأ سجله فقط', async () => {
      await assertSucceeds(getDoc(doc(ctx.op, 'users', 'op1')));
      await assertFails(getDoc(doc(ctx.op, 'users', 'admin1')));
    });
    it('لا يسرد المستخدمين إلا المدير', async () => {
      await assertFails(getDocs(collection(ctx.op, 'users')));
      await assertSucceeds(getDocs(collection(ctx.admin, 'users')));
    });
    it('لا يرفع أحد دوره بنفسه', async () => {
      await assertFails(updateDoc(doc(ctx.op, 'users', 'op1'), { role: 'admin' }));
      // Even an admin cannot change a role from the client.
      await assertFails(updateDoc(doc(ctx.admin, 'users', 'op1'), { role: 'admin' }));
    });
    it('لا يُحذف سجل مستخدم من العميل', async () => {
      await assertFails(deleteDoc(doc(ctx.admin, 'users', 'op1')));
    });
  });

  // ── دليل الحسابات ──────────────────────────────────────────────────
  describe('دليل الحسابات', () => {
    it('الأعضاء يقرأون، والمحاسب يُنشئ', async () => {
      await assertSucceeds(getDoc(doc(ctx.partner, 'chart_of_accounts', '1010')));
      await assertSucceeds(setDoc(doc(ctx.acct, 'chart_of_accounts', '1010'), {
        code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit',
      }));
    });
    it('لا يُحذف حساب — يُعطَّل بدلاً من ذلك', async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'chart_of_accounts', '1010'), { code: '1010' });
      });
      await assertFails(deleteDoc(doc(ctx.admin, 'chart_of_accounts', '1010')));
    });
  });
});
