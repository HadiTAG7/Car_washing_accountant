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
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
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
      // A posted entry to attack in the immutability cases. Lines live
      // INSIDE it now; the legacy row exercises the frozen collection.
      await setDoc(doc(db, 'journal_entries', 'e1'), {
        entryDate: '2026-08-11', periodKey: '2026-08', status: 'posted',
        entryNumber: 1, sourceType: 'wash', sourceId: 'w1', description: 'غسلة',
        lines: [
          { accountId: '1010', debit: 115, credit: 0 },
          { accountId: '4000', debit: 0, credit: 115 },
        ],
      });
      await setDoc(doc(db, 'journal_lines', 'l1'), {
        entryId: 'e1', accountId: '1010', debit: 115, credit: 0,
      });
      // A closed month, and an open one to contrast it with.
      await setDoc(doc(db, 'accounting_periods', '2026-07'), {
        periodKey: '2026-07', status: 'closed', closedBy: 'acct1',
      });
      await setDoc(doc(db, 'accounting_periods', '2026-08'), {
        periodKey: '2026-08', status: 'open',
      });
      // Operational records: w1 is in the books, w2 is not.
      await setDoc(doc(db, 'washes', 'w1'), { quantity: 1, price: 115, status: 'مكتملة', wash_date: '2026-08-11' });
      await setDoc(doc(db, 'washes', 'w2'), { quantity: 1, price: 100, status: 'مكتملة', wash_date: '2026-08-12' });
      await setDoc(doc(db, 'posting_locks', 'wash__w1'), {
        sourceType: 'wash', sourceId: 'w1', entryId: 'e1', entryNumber: 1,
      });
      await setDoc(doc(db, 'partner_payments', 'pp1'), { partner_id: 'p1', amount: 5000 });
      await setDoc(doc(db, 'posting_locks', 'partner_payment__pp1'), {
        sourceType: 'partner_payment', sourceId: 'pp1', entryId: 'e1',
      });
      await setDoc(doc(db, 'monthly_expenses', 'm1'), { expense_name: 'إيجار', total_monthly_cost: 5000 });
      await setDoc(doc(db, 'posting_locks', 'expense__m1'), {
        sourceType: 'expense', sourceId: 'm1', entryId: 'e1',
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

  // ── دفاتر القيد المزدوج غير قابلة للكتابة من العميل ────────────────
  // Three of the ledger's invariants CANNOT be expressed in a rule, because
  // rules have no fold: "debits equal credits" over a list of unknown length,
  // "this reversal names a real balanced mirror", and "this lock release
  // accompanies an actual reversal". So the rules deny every client write and
  // the callable Cloud Functions are the only door.
  describe('لا كتابة مباشرة في الدفاتر — مهما كان الدور', () => {
    const balanced = {
      entryDate: '2026-08-12', periodKey: '2026-08', status: 'posted',
      entryNumber: 2, sourceType: 'manual', description: 'قيد',
      lines: [
        { accountId: '1010', debit: 50, credit: 0 },
        { accountId: '4000', debit: 0, credit: 50 },
      ],
    };

    it('لا يُنشئ قيداً حتى لو كان متوازناً تماماً', async () => {
      await assertFails(setDoc(doc(ctx.acct, 'journal_entries', 'e2'), balanced));
      await assertFails(setDoc(doc(ctx.admin, 'journal_entries', 'e3'), balanced));
      await assertFails(setDoc(doc(ctx.op, 'journal_entries', 'e4'), balanced));
    });

    // ── الثغرة ١ ─────────────────────────────────────────────────────
    it('ولا قيداً مديناً 100 ودائناً 1 — وهو ما لم تكن القواعد تراه', async () => {
      await assertFails(setDoc(doc(ctx.acct, 'journal_entries', 'e5'), {
        ...balanced,
        lines: [
          { accountId: '1010', debit: 100, credit: 0 },
          { accountId: '4000', debit: 0, credit: 1 },
        ],
      }));
    });

    it('لا يُعدَّل قيد ولا يُحذف — ولا حتى من المدير', async () => {
      await assertFails(updateDoc(doc(ctx.acct, 'journal_entries', 'e1'), { entryDate: '2026-09-01' }));
      await assertFails(updateDoc(doc(ctx.admin, 'journal_entries', 'e1'), { description: 'تلاعب' }));
      await assertFails(deleteDoc(doc(ctx.admin, 'journal_entries', 'e1')));
    });

    // ── الثغرة ٣ ─────────────────────────────────────────────────────
    // The status flip used to be the one permitted update, which let a client
    // mark an entry reversed while `reversedBy` named nothing at all.
    it('لا يُقلَب القيد إلى معكوس من العميل بـ reversedBy وهمي', async () => {
      await assertFails(updateDoc(doc(ctx.acct, 'journal_entries', 'e1'), {
        status: 'reversed', reversedBy: 'قيد-لا-وجود-له', reversedAt: new Date(),
      }));
      await assertFails(updateDoc(doc(ctx.admin, 'journal_entries', 'e1'), {
        status: 'reversed', reversedBy: 'e1',
      }));
    });

    it('ولا سطر جديد في المجموعة القديمة', async () => {
      await assertFails(setDoc(doc(ctx.acct, 'journal_lines', 'hack'), {
        entryId: 'e1', accountId: '1010', debit: 1000000, credit: 0,
      }));
      await assertFails(updateDoc(doc(ctx.acct, 'journal_lines', 'l1'), { debit: 999 }));
      await assertFails(deleteDoc(doc(ctx.admin, 'journal_lines', 'l1')));
    });

    it('الأعضاء يقرأون الدفاتر — القراءة وحدها متاحة', async () => {
      await assertSucceeds(getDoc(doc(ctx.partner, 'journal_entries', 'e1')));
      await assertSucceeds(getDocs(collection(ctx.op, 'journal_entries')));
      await assertFails(getDocs(collection(ctx.anon, 'journal_entries')));
    });

    it('عدّاد القيود محجوب عن العميل، وعدّادات المستندات لا', async () => {
      await assertFails(setDoc(doc(ctx.acct, 'counters', 'journal'), { nextNumber: 1 }));
      await assertFails(setDoc(doc(ctx.admin, 'counters', 'journal'), { nextNumber: 9999 }));
      await assertSucceeds(setDoc(doc(ctx.acct, 'counters', 'documents-invoice-2026'), { nextNumber: 2 }));
    });

    it('سجل التدقيق لا يُكتب من العميل — وإلا لأمكن تلفيق الأثر', async () => {
      await assertFails(setDoc(doc(ctx.op, 'audit_logs', 'a9'), { action: 'post' }));
      await assertFails(setDoc(doc(ctx.acct, 'audit_logs', 'a9'), { action: 'post' }));
      await assertFails(setDoc(doc(ctx.admin, 'audit_logs', 'a9'), { action: 'post' }));
    });
  });

  // ── الفترات ────────────────────────────────────────────────────────
  // Closing re-reads every entry in the month and re-checks that each one
  // balances on its own — arithmetic, so it runs on the server.
  describe('الفترات لا تُكتب من العميل', () => {
    it('لا يُنشئ ولا يُقفل ولا يُعيد فتح فترة مباشرة', async () => {
      await assertFails(setDoc(doc(ctx.acct, 'accounting_periods', '2026-09'), {
        periodKey: '2026-09', status: 'open',
      }));
      await assertFails(updateDoc(doc(ctx.acct, 'accounting_periods', '2026-08'), { status: 'closed' }));
      await assertFails(updateDoc(doc(ctx.admin, 'accounting_periods', '2026-07'), {
        status: 'open', reopenReason: 'تصحيح',
      }));
      await assertFails(deleteDoc(doc(ctx.admin, 'accounting_periods', '2026-08')));
    });

    it('والأعضاء يقرأونها', async () => {
      await assertSucceeds(getDoc(doc(ctx.partner, 'accounting_periods', '2026-07')));
    });
  });

  // ── مصادر العمليات المُرحّلة ────────────────────────────────────────
  describe('لا تعديل ولا حذف لمصدر عملية مُرحّلة', () => {
    it('الغسلة المُرحّلة محميّة، وغير المُرحّلة قابلة للتعديل', async () => {
      await assertFails(updateDoc(doc(ctx.op, 'washes', 'w1'), { price: 1 }));
      await assertFails(deleteDoc(doc(ctx.op, 'washes', 'w1')));
      // Not even an admin — the entry is immutable, so the source must be too.
      await assertFails(deleteDoc(doc(ctx.admin, 'washes', 'w1')));
      await assertSucceeds(updateDoc(doc(ctx.op, 'washes', 'w2'), { price: 120 }));
      await assertSucceeds(deleteDoc(doc(ctx.op, 'washes', 'w2')));
    });

    it('دفعة الشريك المُرحّلة محميّة', async () => {
      await assertFails(updateDoc(doc(ctx.op, 'partner_payments', 'pp1'), { amount: 1 }));
      await assertFails(deleteDoc(doc(ctx.admin, 'partner_payments', 'pp1')));
    });

    it('المصروف المُرحّل محميّ', async () => {
      await assertFails(updateDoc(doc(ctx.op, 'monthly_expenses', 'm1'), { total_monthly_cost: 1 }));
      await assertFails(deleteDoc(doc(ctx.admin, 'monthly_expenses', 'm1')));
    });

    // ── الثغرة ٢ ─────────────────────────────────────────────────────
    // The release used to be open to any accountant, because a rule cannot
    // tell "released as part of a reversal" from "released so I can edit a
    // posted record". It now happens only inside the reversal transaction on
    // the server, so no client may touch a lock at all.
    it('لا يُزال القفل ولا يُنشأ ولا يُعدَّل من أي عميل — ولا من المدير', async () => {
      await assertFails(deleteDoc(doc(ctx.acct, 'posting_locks', 'wash__w1')));
      await assertFails(deleteDoc(doc(ctx.admin, 'posting_locks', 'wash__w1')));
      await assertFails(deleteDoc(doc(ctx.op, 'posting_locks', 'wash__w1')));
      await assertFails(updateDoc(doc(ctx.admin, 'posting_locks', 'wash__w1'), { entryId: 'other' }));
      await assertFails(setDoc(doc(ctx.acct, 'posting_locks', 'wash__w9'), { sourceType: 'wash' }));
      // And because the lock cannot be removed, the record stays protected.
      await assertFails(updateDoc(doc(ctx.op, 'washes', 'w1'), { price: 120 }));
    });
  });

  // ── الأدوار ────────────────────────────────────────────────────────
  describe('فصل الصلاحيات بين الأدوار', () => {
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

  // ── المستندات الضريبية ─────────────────────────────────────────────
  describe('الفاتورة الصادرة لا تُحذف ولا يُعاد ترقيمها', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await setDoc(doc(db, 'sales_documents', 'inv1'), {
          documentNumber: 'INV-2026-000001', type: 'invoice', status: 'issued',
          issueDate: '2026-08-11', sequence: 1, year: 2026, gross: 115, vat: 15,
        });
        await setDoc(doc(db, 'sales_document_sources', 'wash__w1'), {
          sourceType: 'wash', sourceId: 'w1', documentId: 'inv1',
        });
      });
    });

    it('لا يُحذف مستند صادر — ولا من المدير', async () => {
      await assertFails(deleteDoc(doc(ctx.admin, 'sales_documents', 'inv1')));
      await assertFails(deleteDoc(doc(ctx.acct, 'sales_documents', 'inv1')));
    });

    it('لا يُغيَّر رقم المستند ولا مبلغه', async () => {
      await assertFails(updateDoc(doc(ctx.acct, 'sales_documents', 'inv1'), { documentNumber: 'INV-2026-000009' }));
      await assertFails(updateDoc(doc(ctx.acct, 'sales_documents', 'inv1'), { gross: 1 }));
    });

    it('يُسمح فقط بالإلغاء الموثّق', async () => {
      await assertSucceeds(updateDoc(doc(ctx.acct, 'sales_documents', 'inv1'), {
        status: 'cancelled', voidReason: 'صدرت بالخطأ', voidedBy: 'acct1', voidedAt: new Date(),
      }));
    });

    it('ولا يُمرَّر تعديل مخفي مع الإلغاء', async () => {
      await assertFails(updateDoc(doc(ctx.acct, 'sales_documents', 'inv1'), {
        status: 'cancelled', voidReason: 'x', vat: 0,
      }));
    });

    it('المشغّل لا يُصدر مستنداً ضريبياً', async () => {
      await assertFails(setDoc(doc(ctx.op, 'sales_documents', 'inv2'), {
        documentNumber: 'INV-2026-000002', type: 'invoice', status: 'issued',
      }));
    });

    it('لا يُحذف سجل المصدر — وإلا أمكن إصدار فاتورة ثانية لنفس الغسلة', async () => {
      await assertFails(deleteDoc(doc(ctx.admin, 'sales_document_sources', 'wash__w1')));
      await assertFails(updateDoc(doc(ctx.acct, 'sales_document_sources', 'wash__w1'), { documentId: 'other' }));
    });
  });

  // ── إعدادات التطبيق ────────────────────────────────────────────────
  describe('إعدادات المحاسبة سياسة لا بيانات يومية', () => {
    it('المحاسب يبدّل الترحيل التلقائي، والمشغّل لا', async () => {
      await assertSucceeds(setDoc(doc(ctx.acct, 'app_settings', 'accounting'), {
        value: { autoPost: true },
      }));
      await assertFails(setDoc(doc(ctx.op, 'app_settings', 'accounting'), {
        value: { autoPost: false },
      }));
    });

    it('المشغّل لا يغيّر الرقم الضريبي — يدخل في كل رمز QR', async () => {
      await assertFails(setDoc(doc(ctx.op, 'app_settings', 'company'), {
        value: { vatNumber: '399999999999993' },
      }));
    });

    it('الأعضاء يقرأون الإعدادات', async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'app_settings', 'company'), { value: { name: 'سويتر' } });
      });
      await assertSucceeds(getDoc(doc(ctx.op, 'app_settings', 'company')));
      await assertFails(getDoc(doc(ctx.anon, 'app_settings', 'company')));
    });
  });

  // ── سندات المصاريف المتكررة ────────────────────────────────────────
  describe('السندات الدورية', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'expense_vouchers', 't1__2026-08'), {
          templateId: 't1', templateName: 'إيجار', periodKey: '2026-08',
          dueDate: '2026-08-05', amount: 5000, status: 'active',
        });
      });
    });

    it('المحاسب يولّد ويعدّل، والمشغّل لا', async () => {
      await assertSucceeds(setDoc(doc(ctx.acct, 'expense_vouchers', 't1__2026-09'), {
        templateId: 't1', periodKey: '2026-09', dueDate: '2026-09-05', amount: 5000, status: 'active',
      }));
      await assertFails(setDoc(doc(ctx.op, 'expense_vouchers', 't1__2026-10'), {
        templateId: 't1', periodKey: '2026-10', amount: 5000,
      }));
    });

    it('لا يُحذف سند — يُلغى', async () => {
      await assertFails(deleteDoc(doc(ctx.admin, 'expense_vouchers', 't1__2026-08')));
      await assertSucceeds(updateDoc(doc(ctx.acct, 'expense_vouchers', 't1__2026-08'), {
        status: 'cancelled', cancelReason: 'المحل مغلق',
      }));
    });

    it('الأعضاء يقرأون، والزائر لا', async () => {
      await assertSucceeds(getDoc(doc(ctx.partner, 'expense_vouchers', 't1__2026-08')));
      await assertFails(getDoc(doc(ctx.anon, 'expense_vouchers', 't1__2026-08')));
    });
  });

  // ── سجل الأصول الثابتة ─────────────────────────────────────────────
  describe('سجل الأصول سجل محاسبي لا تشغيلي', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'fixed_assets', 'as1'), {
          name: 'ماكينة', cost: 12000, usefulLifeMonths: 60, inServiceDate: '2026-01-15',
        });
      });
    });

    it('المحاسب يضيف ويعدّل، والمشغّل لا', async () => {
      await assertSucceeds(setDoc(doc(ctx.acct, 'fixed_assets', 'as2'), {
        name: 'مكنسة', cost: 3600, usefulLifeMonths: 36, inServiceDate: '2026-03-01',
      }));
      await assertFails(setDoc(doc(ctx.op, 'fixed_assets', 'as3'), { name: 'x', cost: 1 }));
    });

    it('الأعضاء يقرأون السجل', async () => {
      await assertSucceeds(getDoc(doc(ctx.partner, 'fixed_assets', 'as1')));
      await assertFails(getDoc(doc(ctx.anon, 'fixed_assets', 'as1')));
    });

    it('لا يُحذف أصل — يُعطَّل أو يُستبعد', async () => {
      await assertFails(deleteDoc(doc(ctx.admin, 'fixed_assets', 'as1')));
      await assertSucceeds(updateDoc(doc(ctx.acct, 'fixed_assets', 'as1'), { active: false }));
    });
  });

  // ── سجل التدقيق ────────────────────────────────────────────────────
  describe('سجل التدقيق يُقرأ ولا يُكتب', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'audit_logs', 'a1'), { action: 'post', userId: 'acct1' });
      });
    });
    it('المحاسب والمدير يقرآن، والمشغّل لا', async () => {
      await assertSucceeds(getDoc(doc(ctx.acct, 'audit_logs', 'a1')));
      await assertFails(getDoc(doc(ctx.op, 'audit_logs', 'a1')));
    });
    it('ولا أحد يعدّل أو يحذف', async () => {
      await assertFails(updateDoc(doc(ctx.admin, 'audit_logs', 'a1'), { action: 'tamper' }));
      await assertFails(deleteDoc(doc(ctx.admin, 'audit_logs', 'a1')));
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
