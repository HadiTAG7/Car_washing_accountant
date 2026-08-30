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
      await setDoc(doc(db, 'payroll_runs', '2026-08__r1'), {
        periodKey: '2026-08', status: 'approved', distributionDate: '2026-09-01',
      });
      await setDoc(doc(db, 'payroll_runs', '2026-08__r1', 'items', 'b1'), {
        bikerId: 'b1', name: 'أحمد', status: 'approved', netDue: 1000,
      });
      await setDoc(doc(db, 'payroll_periods', '2026-08'), { currentRunId: '2026-08__r1' });
      await setDoc(doc(db, 'payroll_payment_locks', '2026-08__b1'), {
        periodKey: '2026-08', bikerId: 'b1', runId: '2026-08__r1',
      });
      await setDoc(doc(db, 'temporary_expenses', 'advance1'), {
        biker_id: 'b1', title: 'سلفة — أحمد', amount: 300, recovered_amount: 100,
        status: 'pending', payroll_lock_id: '2026-08__r1',
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

    // Document counters used to stay client-writable. They no longer are:
    // issuing runs on the server, and a client that could set a counter back
    // could reissue a number already on a filed document.
    it('كل العدّادات محجوبة عن العميل — القيود والمستندات', async () => {
      await assertFails(setDoc(doc(ctx.acct, 'counters', 'journal'), { nextNumber: 1 }));
      await assertFails(setDoc(doc(ctx.admin, 'counters', 'journal'), { nextNumber: 9999 }));
      await assertFails(setDoc(doc(ctx.acct, 'counters', 'documents-invoice-2026'), { nextNumber: 2 }));
      await assertFails(setDoc(doc(ctx.admin, 'counters', 'documents-invoice-2026'), { nextNumber: 1 }));
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

    // Cancelling used to be the one permitted client update. Issuing and
    // voiding now run on the server — which recomputes the totals from the
    // lines and mints the number — so no client writes here at all.
    it('ولا يُلغى من العميل — الإلغاء عبر salesVoidDocument', async () => {
      await assertFails(updateDoc(doc(ctx.acct, 'sales_documents', 'inv1'), {
        status: 'cancelled', voidReason: 'صدرت بالخطأ', voidedBy: 'acct1', voidedAt: new Date(),
      }));
      await assertFails(updateDoc(doc(ctx.admin, 'sales_documents', 'inv1'), {
        status: 'cancelled', voidReason: 'من المدير',
      }));
    });

    it('ولا يُصدره أحد مباشرة — لا مشغّل ولا محاسب ولا مدير', async () => {
      const forged = { documentNumber: 'INV-2026-000002', type: 'invoice', status: 'issued', gross: 1 };
      await assertFails(setDoc(doc(ctx.op, 'sales_documents', 'inv2'), forged));
      await assertFails(setDoc(doc(ctx.acct, 'sales_documents', 'inv3'), forged));
      await assertFails(setDoc(doc(ctx.admin, 'sales_documents', 'inv4'), forged));
    });

    it('لا يُحذف سجل المصدر — وإلا أمكن إصدار فاتورة ثانية لنفس الغسلة', async () => {
      await assertFails(deleteDoc(doc(ctx.admin, 'sales_document_sources', 'wash__w1')));
      await assertFails(updateDoc(doc(ctx.acct, 'sales_document_sources', 'wash__w1'), { documentId: 'other' }));
    });
  });

  // ── إعدادات التطبيق ────────────────────────────────────────────────
  describe('إعدادات المحاسبة سياسة لا بيانات يومية', () => {
    // ── app_settings/accounting مغلق تماماً على العملاء ──────────────
    // It carries `taxPolicyHistory`, and a policy row decides what every wash
    // in a period means. Written from a browser it had three holes: two tabs
    // read-merge-writing drop a row with nothing to show it existed, a
    // decision that restates revenue left no audit record, and nothing stopped
    // a policy being back-dated into a filed month. It goes through
    // `accountingSetTaxPolicy` now, so NOBODY writes it directly.
    it('لا أحد يكتب إعدادات المحاسبة مباشرة — ولا المحاسب ولا المدير', async () => {
      await assertFails(setDoc(doc(ctx.acct, 'app_settings', 'accounting'), {
        value: { autoPost: true },
      }));
      await assertFails(setDoc(doc(ctx.admin, 'app_settings', 'accounting'), {
        value: { vatRegistered: false },
      }));
      await assertFails(setDoc(doc(ctx.op, 'app_settings', 'accounting'), {
        value: { autoPost: false },
      }));
    });

    it('ولا يُعدَّل سجل السياسة التاريخية ولا يُحذف المستند', async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'app_settings', 'accounting'), {
          value: {
            vatRegistered: true, washPriceMode: 'inclusive',
            taxPolicyHistory: [{ effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 }],
          },
        });
      });
      await assertFails(updateDoc(doc(ctx.acct, 'app_settings', 'accounting'), {
        'value.taxPolicyHistory': [],
      }));
      await assertFails(deleteDoc(doc(ctx.admin, 'app_settings', 'accounting')));
      // …but every member may READ it: the reports need the policy.
      await assertSucceeds(getDoc(doc(ctx.op, 'app_settings', 'accounting')));
    });

    it('وبقية إعدادات التطبيق تبقى للمحاسب', async () => {
      await assertSucceeds(setDoc(doc(ctx.acct, 'app_settings', 'company'), {
        value: { name: 'سويتر' },
      }));
      await assertFails(setDoc(doc(ctx.op, 'app_settings', 'company'), {
        value: { name: 'غير مصرّح' },
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

  // ── بنود رسوم التأسيس: خطة للعميل، وصرفٌ للخادم ─────────────────────
  // `startup_costs` sat in the operational wildcard, so an operator could
  // write EVERY field on it — `actual_amount` and the whole tax-invoice block
  // included. The accounting fix removed those from the forms, and a form is
  // not a boundary: one direct write restored a parent-level amount with an
  // invoice on it, which enters the VAT return and can never reach `1200`,
  // because no adapter posts this collection and none can.
  describe('رسوم التأسيس', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await setDoc(doc(db, 'startup_costs', 's1'), {
          category: 'equipment', item_name: 'ماكينة', quantity: 1,
          budgeted_amount: 1000, actual_amount: 0, status: 'in_progress',
          is_tax_invoice: false,
        });
        await setDoc(doc(db, 'startup_cost_entries', 'se1'), {
          startup_cost_id: 's1', description: 'دفعة', amount: 500,
          spent_date: '2026-08-01', is_tax_invoice: false,
        });
      });
    });

    // ═══ ١ ═══════════════════════════════════════════════════════════
    it('١ — المشغّل لا يكتب actual_amount ولا أي حقل ضريبي على البند', async () => {
      const ref = doc(ctx.op, 'startup_costs', 's1');
      await assertFails(updateDoc(ref, { actual_amount: 1150 }));
      // …ولا الحالة: هي دالة في المبلغ والميزانية، لا قيمة تُختار.
      await assertFails(updateDoc(ref, { status: 'completed' }));
      await assertFails(updateDoc(ref, { is_tax_invoice: true }));
      await assertFails(updateDoc(ref, { invoice_number: 'S-77' }));
      await assertFails(updateDoc(ref, { invoice_date: '2026-03-10' }));
      await assertFails(updateDoc(ref, { supplier: 'مورّد' }));
      await assertFails(updateDoc(ref, { vat_amount: 150 }));
      await assertFails(updateDoc(ref, { vat_rate: 0.15 }));
      await assertFails(updateDoc(ref, { price_mode: 'exclusive' }));
      await assertFails(updateDoc(ref, { vat_deductible: false }));
      await assertFails(updateDoc(ref, { converted_at: '2026-08-20' }));
      await assertFails(updateDoc(ref, { converted_by: 'op1' }));
      // …ولا تهريبها مع تعديل مشروع.
      await assertFails(updateDoc(ref, { item_name: 'ماكينة أخرى', actual_amount: 1150 }));
    });

    // ═══ ٢ ═══════════════════════════════════════════════════════════
    it('٢ — والمدير لا يتجاوزها بكتابة عميل مباشرة', async () => {
      // Not a hierarchy: the ban is on the CLIENT, whoever is holding it. The
      // server writes these columns because only the server can re-sum the
      // siblings and check the posting lock atomically — a rule has no fold.
      const ref = doc(ctx.admin, 'startup_costs', 's1');
      await assertFails(updateDoc(ref, { actual_amount: 1150 }));
      await assertFails(updateDoc(ref, { is_tax_invoice: true, vat_amount: 150 }));
      await assertFails(setDoc(doc(ctx.admin, 'startup_costs', 's2'), {
        category: 'equipment', item_name: 'رفّاعة', quantity: 1,
        budgeted_amount: 1000, actual_amount: 1150, status: 'completed',
        is_tax_invoice: true, invoice_number: 'S-9',
      }));
    });

    // ═══ ٣ ═══════════════════════════════════════════════════════════
    it('٣ — إنشاء خطة نظيفة ينجح، والتعديل والحذف يمرّان بالخادم', async () => {
      await assertSucceeds(setDoc(doc(ctx.op, 'startup_costs', 's3'), {
        category: 'equipment', item_name: 'خرطوم', quantity: 2,
        budgeted_amount: 300, actual_amount: 0, status: 'in_progress',
        is_tax_invoice: false, invoice_number: null, invoice_date: null,
        supplier: null, vat_amount: null, vat_rate: null,
        price_mode: 'inclusive', vat_deductible: true,
      }));
      // …وبحالة يختارها العميل: مرفوضة. خطة بلا صرف حالتها in_progress
      // بالاشتقاق، وصفٌّ يُنشأ completed يكذب من لحظته الأولى.
      await assertFails(setDoc(doc(ctx.op, 'startup_costs', 's4'), {
        category: 'equipment', item_name: 'خرطوم', quantity: 2,
        budgeted_amount: 300, actual_amount: 0, status: 'completed',
        is_tax_invoice: false,
      }));
      // التعديل والحذف مغلقان: تغيير الميزانية يجب أن يعيد اشتقاق الحالة في
      // المعاملة نفسها، والحذف يجب أن يثبت أن لا شيء معلَّق على الخطة.
      await assertFails(updateDoc(doc(ctx.op, 'startup_costs', 's1'), { item_name: 'ماكينة ضغط' }));
      await assertFails(updateDoc(doc(ctx.admin, 'startup_costs', 's1'), { budgeted_amount: 1200 }));
      await assertFails(deleteDoc(doc(ctx.op, 'startup_costs', 's1')));
      await assertFails(deleteDoc(doc(ctx.admin, 'startup_costs', 's1')));
      // …والقراءة سليمة لكل عضو، بما فيهم الشريك.
      await assertSucceeds(getDoc(doc(ctx.partner, 'startup_costs', 's1')));
      await assertSucceeds(getDoc(doc(ctx.partner, 'startup_cost_entries', 'se1')));
      // والشريك لا يُنشئ أصلاً.
      await assertFails(setDoc(doc(ctx.partner, 'startup_costs', 's5'), {
        category: 'equipment', item_name: 'x', quantity: 1,
        budgeted_amount: 1, actual_amount: 0, status: 'in_progress', is_tax_invoice: false,
      }));
      await assertFails(getDoc(doc(ctx.anon, 'startup_costs', 's1')));
    });

    // ═══ ٤ ═══════════════════════════════════════════════════════════
    it('٤ — سجل المصاريف مغلق أمام كل عميل: إنشاء وتعديل وحذف', async () => {
      for (const [name, db] of [['المشغّل', ctx.op], ['المحاسب', ctx.acct], ['المدير', ctx.admin]]) {
        await assertFails(setDoc(doc(db, 'startup_cost_entries', `x-${name}`), {
          startup_cost_id: 's1', description: 'دفعة', amount: 100, spent_date: '2026-08-02',
        }));
        await assertFails(updateDoc(doc(db, 'startup_cost_entries', 'se1'), { amount: 999 }));
        await assertFails(deleteDoc(doc(db, 'startup_cost_entries', 'se1')));
      }
    });
  });

  describe('مسير الرواتب لا يُكتب من المتصفح', () => {
    it('المدير والمحاسب يقرآن المسير وسطوره، وبقية الأدوار لا', async () => {
      for (const db of [ctx.admin, ctx.acct]) {
        await assertSucceeds(getDoc(doc(db, 'payroll_runs', '2026-08__r1')));
        await assertSucceeds(getDoc(doc(db, 'payroll_runs', '2026-08__r1', 'items', 'b1')));
      }
      await assertFails(getDoc(doc(ctx.op, 'payroll_runs', '2026-08__r1')));
      await assertFails(getDoc(doc(ctx.partner, 'payroll_runs', '2026-08__r1')));
      await assertFails(getDoc(doc(ctx.anon, 'payroll_runs', '2026-08__r1')));
    });

    it('لا يستطيع أي دور تغيير الحالة أو المبلغ أو إنشاء سطر', async () => {
      for (const db of [ctx.admin, ctx.acct, ctx.op]) {
        await assertFails(updateDoc(doc(db, 'payroll_runs', '2026-08__r1'), { status: 'paid' }));
        await assertFails(updateDoc(doc(db, 'payroll_runs', '2026-08__r1', 'items', 'b1'), { netDue: 1 }));
        await assertFails(setDoc(doc(db, 'payroll_runs', '2026-08__r1', 'items', 'hack'), {
          bikerId: 'hack', status: 'paid', netDue: 1,
        }));
      }
    });

    it('بيانات النسخة الحالية وأقفال عدم التكرار خادمية بالكامل', async () => {
      for (const db of [ctx.admin, ctx.acct, ctx.op]) {
        await assertFails(getDoc(doc(db, 'payroll_periods', '2026-08')));
        await assertFails(setDoc(doc(db, 'payroll_payment_locks', 'hack'), { bikerId: 'b1' }));
        await assertFails(deleteDoc(doc(db, 'payroll_payment_locks', '2026-08__b1')));
      }
    });

    it('السلفة المرتبطة بمسير مصروف لا تُعدّل أو تُحذف من العميل', async () => {
      await assertFails(updateDoc(doc(ctx.admin, 'temporary_expenses', 'advance1'), {
        status: 'recovered', recovered_date: '2026-09-01', recovery_method: 'bank',
      }));
      await assertFails(deleteDoc(doc(ctx.admin, 'temporary_expenses', 'advance1')));
    });
  });

  // ── حساب مُصادَق عليه بلا وثيقة في users ───────────────────────────
  // Firebase Auth and the app's user directory are two different things.
  // Creating an account in the Auth console makes someone able to SIGN IN;
  // it does not make them a member. `isMember()` is
  // `hasUserDoc() || isAdminDoc()`, so an account with neither document is
  // refused EVERY read — and the UI, which never checks a role, still renders
  // the full admin sidebar. That combination reads as «I am logged in as the
  // admin and the app says I have no permissions».
  //
  // And it cannot fix itself: `/users` create needs `isAdmin()`, `isAdmin()`
  // needs one of those two documents, and `/app_admins` is closed to every
  // client. The first admin has to be provisioned out of band —
  // `npm run bootstrap:admin`.
  describe('حساب بلا وثيقة مستخدم', () => {
    let ghost;
    beforeEach(() => {
      // Signed in, and unknown to the directory: no `users/ghost1`, no
      // `app_admins/ghost1`.
      ghost = env.authenticatedContext('ghost1').firestore();
    });

    it('يُرفض كل قراءة محاسبية رغم أنه مسجَّل الدخول', async () => {
      for (const [coll, id] of [
        ['journal_entries', 'e1'],
        ['journal_lines', 'l1'],
        ['chart_of_accounts', '1010'],
        ['accounting_periods', '2026-08'],
        ['posting_locks', 'wash__w1'],
      ]) {
        await assertFails(getDoc(doc(ghost, coll, id)));
      }
    });

    it('ويُرفض في البيانات التشغيلية كذلك — فالمشكلة العضوية لا الصفحة', async () => {
      await assertFails(getDoc(doc(ghost, 'washes', 'w1')));
      await assertFails(getDoc(doc(ghost, 'startup_costs', 's1')));
      await assertFails(getDoc(doc(ghost, 'monthly_expenses', 'm1')));
    });

    it('ولا يستطيع إصلاح نفسه: كتابة users أو app_admins مرفوضة', async () => {
      // The bootstrap deadlock, stated as a test so it cannot be «fixed» by
      // quietly opening one of these.
      await assertFails(setDoc(doc(ghost, 'users', 'ghost1'), { email: 'g@x.com', role: 'admin' }));
      await assertFails(setDoc(doc(ghost, 'app_admins', 'ghost1'), { note: 'me' }));
    });

    it('وبمجرد وجود وثيقة المستخدم يعمل كل شيء', async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'users', 'ghost1'), { email: 'g@x.com', role: 'admin' });
      });
      const now = env.authenticatedContext('ghost1').firestore();
      await assertSucceeds(getDoc(doc(now, 'journal_entries', 'e1')));
      await assertSucceeds(getDoc(doc(now, 'chart_of_accounts', '1010')));
      await assertSucceeds(getDoc(doc(now, 'washes', 'w1')));
      // …ومن ثمّ يستطيع تسجيل بقية الحسابات.
      await assertSucceeds(setDoc(doc(now, 'users', 'someone'), { email: 's@x.com', role: 'operator' }));
    });

    it('و`app_admins` وحدها تكفي أيضاً — وهو ما يكتبه سكربت التهيئة', async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'app_admins', 'ghost1'), { note: 'bootstrap' });
      });
      const now = env.authenticatedContext('ghost1').firestore();
      await assertSucceeds(getDoc(doc(now, 'journal_entries', 'e1')));
      await assertSucceeds(getDoc(doc(now, 'counters', 'journal')));
    });
  });
});
