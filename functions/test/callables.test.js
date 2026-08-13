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
import { taxPolicyAt } from '../src/taxPolicy.js';
import { setTaxPolicy } from '../src/accountingSettings.js';
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
  // Startup spend is CAPITALISED, so it debits the fixed-asset account rather
  // than an expense one — and its input VAT needs 1200 like any purchase.
  { code: '1200', nameArabic: 'ضريبة مدخلات', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1500', nameArabic: 'أصول ثابتة', accountType: 'asset', normalBalance: 'debit', active: true },
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
      'washes', 'monthly_expenses', 'startup_costs', 'startup_cost_entries']) {
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
    // A legacy startup item: an amount and an invoice typed onto the PARENT,
    // which no adapter can post and the rules no longer let a client write.
    await adb.collection('startup_costs').doc('sp1').set({
      category: 'equipment', item_name: 'ماكينة ضغط', quantity: 1,
      budgeted_amount: 1000, actual_amount: 1150, status: 'completed',
      is_tax_invoice: true, invoice_number: 'S-77', invoice_date: '2026-08-03',
      supplier: 'مؤسسة النور', vat_amount: 150, price_mode: 'inclusive',
      vat_deductible: true, created_at: '2026-08-20T09:00:00.000Z',
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
        paymentMethod: 'cash', paymentStatus: 'paid',
        lines: [{ description: 'غسلة خارجية', quantity: 2, unitPrice: 57.5 }],
      });
      expect(res.data.documentNumber).toBe('INV-2026-000001');
      expect(res.data.gross).toBe(115);
      const saved = (await adb.collection('sales_documents').doc(res.data.id).get()).data();
      expect(saved.issuedBy).toBe(uids.accountant);
      // The audit record no client could write.
      expect((await adb.collection('audit_logs').where('action', '==', 'issue').get()).size).toBe(1);

      // A standalone sale posts its own entry, through the same call.
      expect(res.data.journalEntryId).toBeTruthy();
      const entry = (await adb.collection('journal_entries').doc(res.data.journalEntryId).get()).data();
      expect(entry.sourceType).toBe('sales_invoice');
      expect(entry.createdBy).toBe(uids.accountant);
    }, 60_000);

    // ── تاريخ العكس يعبر الـcallable ─────────────────────────────────
    // The callable used to drop `reversalDate` on the floor, so no client
    // could ever name the month a reversal lands in — which is the whole gap.
    it('يمرّر تاريخ العكس عند الإلغاء بدل افتراض تاريخ المستند', async () => {
      const call = await as('accountant');
      const inv = await call('salesIssueDocument')({
        type: 'invoice', issueDate: '2026-08-11',
        paymentMethod: 'cash', paymentStatus: 'paid',
        lines: [{ description: 'غسلة', quantity: 2, unitPrice: 57.5 }],
      });

      // Without a date the callable refuses rather than picking one.
      await expect(call('salesVoidDocument')({ documentId: inv.data.id, reason: 'خطأ' }))
        .rejects.toSatisfy((e) => /تاريخ القيد العكسي مطلوب/.test(String(e?.message)));

      const voided = await call('salesVoidDocument')({
        documentId: inv.data.id, reason: 'خطأ', reversalDate: '2026-09-02',
      });
      const mirror = (await adb.collection('journal_entries')
        .doc(voided.data.reversalEntryId).get()).data();
      expect(mirror.entryDate).toBe('2026-09-02');
      expect(mirror.periodKey).toBe('2026-09');
      // The original stays in August, exactly as issued.
      const original = (await adb.collection('journal_entries').doc(inv.data.journalEntryId).get()).data();
      expect(original.entryDate).toBe('2026-08-11');
      expect(original.status).toBe('reversed');
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

    // ── المسار الذري عبر الاستدعاء الحقيقي ────────────────────────────
    it('يصحّح فاتورة غسلة ذرياً، وعكس القيد مباشرةً مرفوض قبلها', async () => {
      const call = await as('accountant');
      const posted = await call('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' });
      const f1 = await call('salesIssueDocument')({
        type: 'invoice', washId: 'w1', issueDate: '2026-08-12',
      });
      expect(f1.data.linkedJournalEntryId).toBe(posted.data.entryId);
      expect(f1.data.supplyDate).toBe('2026-08-11');

      // The ledger refuses the piecemeal route and says where to go.
      await expect(call('ledgerReverseEntry')({
        entryId: posted.data.entryId, entryDate: '2026-08-25',
      })).rejects.toSatisfy((e) => /موثّق بفاتورة سارية/.test(String(e?.message)));

      const fixed = await call('salesCorrectWashInvoice')({
        documentId: f1.data.id, reason: 'سعر خاطئ', reversalDate: '2026-08-25',
      });
      expect(fixed.data.lockReleased).toBe(true);
      expect(fixed.data.claimReleased).toBe(true);
      expect((await adb.collection('sales_documents').doc(f1.data.id).get()).data().status).toBe('cancelled');
      expect((await adb.collection('journal_entries').doc(posted.data.entryId).get()).data().status).toBe('reversed');
      expect((await adb.collection('posting_locks').doc('wash__w1').get()).exists).toBe(false);
    }, 120_000);

    it('ويفحص الفواتير القديمة تجريبياً، لكن التطبيق للمدير', async () => {
      const call = await as('accountant');
      const dry = await call('salesLinkLegacyInvoices')({});
      expect(dry.data.dryRun).toBe(true);
      await expectDenied(call('salesLinkLegacyInvoices')({ apply: true }));

      const adminCall = await as('admin');
      const applied = await adminCall('salesLinkLegacyInvoices')({ apply: true });
      expect(applied.data.applied).toBe(0);   // nothing to link in this fixture
    }, 90_000);
  });

  // ═══ سياسة الضريبة ══════════════════════════════════════════════════
  // `app_settings/accounting` is denied to clients in the rules, so this is
  // the only door. What it has to get right: a real calendar date, a
  // transaction that cannot lose a concurrent update, an audit record, and a
  // gate on rewriting a month that has already been filed.
  describe('سياسة الضريبة عبر الاستدعاء', () => {
    const settings = () => adb.collection('app_settings').doc('accounting').get()
      .then((s) => (s.exists ? (s.data().value || {}) : {}));

    it('يهيّئ السجل ثم يغيّر السياسة بتاريخ سريان، فيقرأ يوليو inclusive', async () => {
      const call = await as('accountant');
      await call('accountingSeedTaxPolicy')({ baselineFrom: '2026-01-01', note: 'بداية الدفاتر' });
      const seeded = await settings();
      expect(seeded.taxPolicyHistory).toHaveLength(1);
      expect(seeded.taxPolicyHistory[0]).toMatchObject({ effectiveFrom: '2026-01-01', washPriceMode: 'inclusive' });

      await call('accountingSetTaxPolicy')({
        vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15,
        effectiveFrom: '2026-08-01',
      });
      const after = await settings();
      expect(after.taxPolicyHistory.map((h) => h.effectiveFrom)).toEqual(['2026-01-01', '2026-08-01']);
      expect(taxPolicyAt('2026-07-15', after)).toMatchObject({ known: true, washPriceMode: 'inclusive' });
      expect(taxPolicyAt('2026-08-15', after)).toMatchObject({ known: true, washPriceMode: 'exclusive' });

      const audit = await adb.collection('audit_logs').where('action', '==', 'tax-policy').get();
      expect(audit.size).toBe(2);
      const change = audit.docs.map((x) => x.data()).find((x) => x.after?.effectiveFrom === '2026-08-01');
      expect(change.userId).toBe(uids.accountant);
      expect(change.before).toMatchObject({ washPriceMode: 'inclusive' });
      expect(change.after).toMatchObject({ washPriceMode: 'exclusive', effectiveFrom: '2026-08-01' });
    }, 90_000);

    it('وأول تغيير بلا سجل يحتاج تاريخ بداية صريحاً', async () => {
      const call = await as('accountant');
      await expect(call('accountingSetTaxPolicy')({
        vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15,
        effectiveFrom: '2026-08-01',
      })).rejects.toSatisfy((e) => /تاريخ بداية السياسة الحالية/.test(String(e?.message)));
      expect((await settings()).taxPolicyHistory ?? []).toHaveLength(0);
    }, 60_000);

    it('ويرفض تاريخاً غير حقيقي ونسبة خارج المدى', async () => {
      const call = await as('accountant');
      for (const bad of ['2026-02-30', '2026-13-01', '']) {
        await expect(call('accountingSetTaxPolicy')({
          vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15,
          effectiveFrom: bad, baselineFrom: '2026-01-01',
        })).rejects.toSatisfy((e) => /تاريخ سريان/.test(String(e?.message)));
      }
      await expect(call('accountingSetTaxPolicy')({
        vatRegistered: true, washPriceMode: 'inclusive', vatRate: 1.5,
        effectiveFrom: '2026-08-01', baselineFrom: '2026-01-01',
      })).rejects.toSatisfy((e) => /نسبة الضريبة/.test(String(e?.message)));
    }, 90_000);

    it('وتحديثان متزامنان لا يفقدان أي سطر سياسة', async () => {
      const call = await as('accountant');
      await call('accountingSeedTaxPolicy')({ baselineFrom: '2026-01-01' });
      await Promise.all([
        call('accountingSetTaxPolicy')({
          vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15, effectiveFrom: '2026-08-01',
        }),
        call('accountingSetTaxPolicy')({
          vatRegistered: false, washPriceMode: 'inclusive', vatRate: 0, effectiveFrom: '2026-09-01',
        }),
      ]);
      const after = await settings();
      // Read-merge-write from two callers would have dropped one of these.
      expect(after.taxPolicyHistory.map((h) => h.effectiveFrom))
        .toEqual(['2026-01-01', '2026-08-01', '2026-09-01']);
    }, 120_000);

    // ── الرجعي في فترة مقفلة ───────────────────────────────────────────
    it('والتغيير الرجعي في فترة مقفلة يفشل للمحاسب', async () => {
      const call = await as('accountant');
      await call('accountingSeedTaxPolicy')({ baselineFrom: '2026-01-01' });
      await call('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' });
      await call('ledgerClosePeriod')({ periodKey: '2026-08' });

      await expect(call('accountingSetTaxPolicy')({
        vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15,
        effectiveFrom: '2026-08-01', reason: 'تصحيح',
      })).rejects.toSatisfy((e) => /يحتاج مديراً وسبباً مكتوباً/.test(String(e?.message)));

      const after = await settings();
      expect(after.taxPolicyHistory).toHaveLength(1);
    }, 120_000);

    it('والمدير لا ينفّذه بلا سبب، وينفّذه بسبب مكتوب ومُدقَّق', async () => {
      const acct = await as('accountant');
      await acct('accountingSeedTaxPolicy')({ baselineFrom: '2026-01-01' });
      await acct('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' });
      await acct('ledgerClosePeriod')({ periodKey: '2026-08' });

      const admin = await as('admin');
      await expect(admin('accountingSetTaxPolicy')({
        vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15,
        effectiveFrom: '2026-08-01',
      })).rejects.toSatisfy((e) => /سبباً مكتوباً/.test(String(e?.message)));

      const res = await admin('accountingSetTaxPolicy')({
        vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15,
        effectiveFrom: '2026-08-01', reason: 'تصحيح تسجيل بأثر رجعي بقرار الهيئة',
      });
      expect(res.data.retroactive).toBe(true);
      expect(res.data.closedThrough).toBe('2026-08');

      const audit = (await adb.collection('audit_logs').where('action', '==', 'tax-policy').get())
        .docs.map((x) => x.data()).find((x) => x.after?.retroactive === true);
      expect(audit.userId).toBe(uids.admin);
      expect(audit.note).toContain('رجعي في فترة مقفلة');
    }, 150_000);

    // ── سباق الفترة المقفلة ────────────────────────────────────────────
    // The closed-period query lives INSIDE the transaction. Read beforehand it
    // is a photograph, and a period closed between the photograph and the
    // commit lets the accountant's change into a month filed while it was in
    // flight. `onBeforeCommit` closes the period after the reads and before
    // the writes; Firestore then aborts and retries, and the retry sees it.
    it('الفترة تُقفل قبل commit: المحاسب يُرفض ولا يبقى أي سطر', async () => {
      const call = await as('accountant');
      await call('accountingSeedTaxPolicy')({ baselineFrom: '2026-01-01' });
      await call('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' });

      let closed = false;
      await expect(setTaxPolicy(adb, FieldValue, {
        vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15,
        effectiveFrom: '2026-08-01',
      }, {
        userId: uids.accountant, role: 'accountant',
        onBeforeCommit: async () => {
          if (closed) return;
          closed = true;
          await adb.collection('accounting_periods').doc('2026-08')
            .set({ periodKey: '2026-08', status: 'closed' }, { merge: true });
        },
      })).rejects.toThrow(/يحتاج مديراً وسبباً مكتوباً/);

      const after = await settings();
      expect(after.taxPolicyHistory).toHaveLength(1);
      expect(after.taxPolicyHistory[0].effectiveFrom).toBe('2026-01-01');
    }, 120_000);

    it('وفي السباق نفسه: المدير بلا سبب يُرفض، وبسبب صريح ينجح', async () => {
      const call = await as('accountant');
      await call('accountingSeedTaxPolicy')({ baselineFrom: '2026-01-01' });
      await call('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' });

      const closeMidFlight = () => {
        let done = false;
        return async () => {
          if (done) return;
          done = true;
          await adb.collection('accounting_periods').doc('2026-08')
            .set({ periodKey: '2026-08', status: 'closed' }, { merge: true });
        };
      };

      await expect(setTaxPolicy(adb, FieldValue, {
        vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15,
        effectiveFrom: '2026-08-01',
      }, { userId: uids.admin, role: 'admin', onBeforeCommit: closeMidFlight() }))
        .rejects.toThrow(/سبباً مكتوباً/);
      expect((await settings()).taxPolicyHistory).toHaveLength(1);

      const ok = await setTaxPolicy(adb, FieldValue, {
        vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15,
        effectiveFrom: '2026-08-01', reason: 'قرار الهيئة بأثر رجعي',
      }, { userId: uids.admin, role: 'admin', onBeforeCommit: closeMidFlight() });
      expect(ok.retroactive).toBe(true);
      expect(ok.closedThrough).toBe('2026-08');
      expect((await settings()).taxPolicyHistory).toHaveLength(2);
      // The audit names the closed month the TRANSACTION actually read.
      const audit = (await adb.collection('audit_logs').where('action', '==', 'tax-policy').get())
        .docs.map((x) => x.data()).find((x) => x.after?.retroactive === true);
      expect(audit.after.closedThrough).toBe('2026-08');
    }, 150_000);

    // ── التهيئة لا تغيّر رقماً، لكنها لا تُترك بعد أقدم قيد ────────────
    it('التهيئة تُقبل في فترة مقفلة لأنها لا تغيّر رقماً', async () => {
      const call = await as('accountant');
      await call('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' });
      const before = (await adb.collection('journal_entries').get()).docs[0].data();
      await call('ledgerClosePeriod')({ periodKey: '2026-08' });

      // The baseline covers the closed month, and that is fine: before it,
      // every date already resolved to these same values as an unlabelled
      // assumption. Nothing posted moves.
      await call('accountingSeedTaxPolicy')({ baselineFrom: '2026-01-01' });
      const after = (await adb.collection('journal_entries').get()).docs[0].data();
      expect(after.taxSnapshot).toEqual(before.taxSnapshot);
      expect(after.lines).toEqual(before.lines);
      expect((await settings()).taxPolicyHistory).toHaveLength(1);
    }, 120_000);

    it('وترفض التهيئة بتاريخ بعد أقدم قيد مُرحّل', async () => {
      const call = await as('accountant');
      await call('ledgerPostSource')({ kind: 'wash', sourceId: 'w1' });   // 2026-08-11
      await expect(call('accountingSeedTaxPolicy')({ baselineFrom: '2026-09-01' }))
        .rejects.toSatisfy((e) => /بعد أقدم قيد مُرحّل/.test(String(e?.message)));
      expect((await settings()).taxPolicyHistory ?? []).toHaveLength(0);
    }, 90_000);

    it('والمشغّل لا يمسّ السياسة إطلاقاً', async () => {
      const call = await as('operator');
      await expectDenied(call('accountingSetTaxPolicy')({
        vatRegistered: false, washPriceMode: 'inclusive', vatRate: 0,
        effectiveFrom: '2026-08-01', baselineFrom: '2026-01-01',
      }));
      await expectDenied(call('accountingSeedTaxPolicy')({ baselineFrom: '2026-01-01' }));
      await expectDenied(call('accountingSetPreferences')({ autoPost: true }));
    }, 90_000);

    it('وإعدادات لا تمسّ الضريبة تُحفظ بلا تاريخ سريان', async () => {
      const call = await as('accountant');
      await call('accountingSetPreferences')({ autoPost: true, vatFilingPeriod: 'monthly' });
      const after = await settings();
      expect(after.autoPost).toBe(true);
      expect(after.vatFilingPeriod).toBe('monthly');
      expect(after.taxPolicyHistory ?? []).toHaveLength(0);
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

  // ═══ سجل مصاريف التأسيس عبر الاستدعاء ═══════════════════════════════
  // The rules deny `startup_cost_entries` to every client and deny the
  // parent's `actual_amount` and tax block to every client, so these three
  // callables are the ONLY door. What matters here is the part a unit test
  // cannot reach: the role comes from the verified token.
  describe('سجل مصاريف التأسيس', () => {
    const ENTRY = {
      description: 'دفعة', amount: 400, spentDate: '2026-08-04',
      paymentMethod: 'cash', isTaxInvoice: false,
    };
    const FORM = {
      spentDate: '2026-08-04', paymentMethod: 'cash', isTaxInvoice: true,
      invoiceNumber: 'S-77', invoiceDate: '2026-08-03', supplier: 'مؤسسة النور',
      vatAmount: 150, vatRate: null, priceMode: 'inclusive', vatDeductible: true,
    };

    it('المشغّل يسجّل مصروفاً، والخادم يشتقّ المجموع', async () => {
      // The seeded item carries a legacy amount, so the accountant converts it
      // first — that is the rule this fixture exists to exercise everywhere.
      const acct = await as('accountant');
      await acct('startupConvertLegacySpend')({ parentId: 'sp1', form: FORM });
      const call = await as('operator');
      const res = await call('startupAddEntry')({ parentId: 'sp1', entry: ENTRY });
      expect(res.data).toMatchObject({ actualAmount: 1550 });
      const parent = (await adb.collection('startup_costs').doc('sp1').get()).data();
      expect(parent.actual_amount).toBe(1550);
    }, 90_000);

    it('والشريك مرفوض في الإضافة والحذف والتحويل', async () => {
      const call = await as('partner');
      await expectDenied(call('startupAddEntry')({ parentId: 'sp1', entry: ENTRY }));
      await expectDenied(call('startupDeleteEntry')({ entryId: 'x' }));
      await expectDenied(call('startupConvertLegacySpend')({ parentId: 'sp1', form: FORM }));
    }, 60_000);

    it('والمشغّل مرفوض في ترحيل البيانات القديمة — الفترة قرار محاسبي', async () => {
      const call = await as('operator');
      await expectDenied(call('startupConvertLegacySpend')({ parentId: 'sp1', form: FORM }));
      expect((await adb.collection('startup_cost_entries').get()).size).toBe(0);
    }, 60_000);

    it('وغير المسجَّل الدخول مرفوض', async () => {
      await signOut(auth).catch(() => {});
      const anon = (name) => httpsCallable(fns, name);
      await expectDenied(anon('startupAddEntry')({ parentId: 'sp1', entry: ENTRY }));
      await expectDenied(anon('startupConvertLegacySpend')({ parentId: 'sp1', form: FORM }));
    }, 60_000);

    it('وحساب بلا وثيقة مستخدم مرفوض — الدور يُقرأ من Firestore لا من الحمولة', async () => {
      await adb.collection('users').doc(uids.operator).delete();
      const call = await as('operator');
      await expectDenied(call('startupAddEntry')({
        // The payload claims a role and a userId; neither is read.
        parentId: 'sp1', entry: ENTRY, role: 'admin', userId: uids.admin,
      }));
    }, 60_000);

    it('والمحاسب يحوّل البند القديم مرة واحدة، والتدقيق يحمل هوية التوكن', async () => {
      const call = await as('accountant');
      const first = await call('startupConvertLegacySpend')({ parentId: 'sp1', form: FORM });
      expect(first.data).toMatchObject({ id: 'legacy__sp1', created: true });
      const second = await call('startupConvertLegacySpend')({ parentId: 'sp1', form: FORM });
      expect(second.data.created).toBe(false);
      expect((await adb.collection('startup_cost_entries').get()).size).toBe(1);

      const parent = (await adb.collection('startup_costs').doc('sp1').get()).data();
      expect(parent.is_tax_invoice).toBe(false);
      expect(parent.actual_amount).toBe(1150);

      const audit = (await adb.collection('audit_logs')
        .where('action', '==', 'startup-convert-legacy').get()).docs.map((x) => x.data());
      expect(audit).toHaveLength(1);
      expect(audit[0].userId).toBe(uids.accountant);
      expect(audit[0].before).toMatchObject({ actualAmount: 1150, isTaxInvoice: true });
      expect(audit[0].after).toMatchObject({ actualAmount: 1150, entryCount: 1, role: 'accountant' });
    }, 90_000);

    it('والخطة تُعدَّل وتُحذف عبر الاستدعاء وحده، والحالة تُشتق', async () => {
      const call = await as('operator');
      // Convert first: the plan carries a legacy amount, and adding to it is
      // refused until that becomes a document.
      const acct = await as('accountant');
      await acct('startupConvertLegacySpend')({ parentId: 'sp1', form: FORM });
      const op = await as('operator');
      await op('startupAddEntry')({ parentId: 'sp1', entry: { ...ENTRY, amount: 1500 } });
      expect((await adb.collection('startup_costs').doc('sp1').get()).data())
        .toMatchObject({ actual_amount: 2650, status: 'completed' });

      // Raising the budget past the spend flips the badge back — the whole
      // point of `status` being derived rather than stored.
      await op('startupUpdatePlan')({ parentId: 'sp1', patch: { plannedAmount: 5000 } });
      expect((await adb.collection('startup_costs').doc('sp1').get()).data())
        .toMatchObject({ budgeted_amount: 5000, actual_amount: 2650, status: 'in_progress' });

      await expect(op('startupUpdatePlan')({ parentId: 'sp1', patch: { status: 'completed' } }))
        .rejects.toThrow(/يملكها الخادم/);
      await expect(op('startupDeletePlan')({ parentId: 'sp1' }))
        .rejects.toThrow(/احذف المصاريف غير المُرحّلة أولاً/);
      expect(call).toBeTruthy();
    }, 120_000);

    it('وخطة فارغة تُحذف عبر الاستدعاء، والشريك مرفوض', async () => {
      await adb.collection('startup_costs').doc('sp2').set({
        category: 'equipment', item_name: 'خرطوم', quantity: 1,
        budgeted_amount: 300, actual_amount: 0, status: 'in_progress', is_tax_invoice: false,
      });
      const partner = await as('partner');
      await expectDenied(partner('startupDeletePlan')({ parentId: 'sp2' }));
      await expectDenied(partner('startupUpdatePlan')({ parentId: 'sp2', patch: { itemName: 'x' } }));

      const op = await as('operator');
      const res = await op('startupDeletePlan')({ parentId: 'sp2' });
      expect(res.data).toMatchObject({ deleted: true });
      expect((await adb.collection('startup_costs').doc('sp2').get()).exists).toBe(false);
    }, 90_000);

    it('وإضافة مصروف إلى بند يحمل مبلغاً قديماً تُرفض قبل التحويل', async () => {
      const op = await as('operator');
      await expect(op('startupAddEntry')({ parentId: 'sp1', entry: ENTRY }))
        .rejects.toThrow(/يُحوّل المحاسب/);
      const parent = (await adb.collection('startup_costs').doc('sp1').get()).data();
      expect(parent.actual_amount).toBe(1150);
      expect(parent.invoice_number).toBe('S-77');
      expect((await adb.collection('startup_cost_entries').get()).size).toBe(0);
    }, 90_000);

    it('والمصروف المُرحّل لا يُحذف عبر الاستدعاء', async () => {
      const acct = await as('accountant');
      await acct('startupConvertLegacySpend')({ parentId: 'sp1', form: FORM });
      const added = await acct('startupAddEntry')({
        parentId: 'sp1',
        entry: {
          ...ENTRY, amount: 1150, isTaxInvoice: true, invoiceNumber: 'S-9',
          invoiceDate: '2026-08-03', supplier: 'مورّد', vatAmount: 150,
        },
      });
      await acct('ledgerPostSource')({ kind: 'startup', sourceId: added.data.id });
      await expect(acct('startupDeleteEntry')({ entryId: added.data.id }))
        .rejects.toThrow(/مُرحّل بالقيد رقم/);
      expect((await adb.collection('startup_cost_entries').get()).size).toBe(2);
    }, 90_000);
  });

  // ═══ تهيئة أول مدير عبر الاستدعاء ═══════════════════════════════════
  // The one path that works WITHOUT already being a member — because on a
  // fresh project nobody is one, and the rules make that unfixable from a
  // browser by design.
  describe('المطالبة بأول مدير', () => {
    it('على نظام فارغ: المتصل يصير مديراً، والهوية من التوكن لا من الحمولة', async () => {
      // Emptied so this is a genuine first run.
      for (const c of ['users', 'app_admins']) {
        const snap = await adb.collection(c).get();
        await Promise.all(snap.docs.map((s) => s.ref.delete()));
      }
      const call = await as('operator');
      expect((await call('authBootstrapStatus')({})).data).toEqual({ unclaimed: true });

      // The payload claims another uid; it is never read.
      const res = await call('authClaimFirstAdmin')({ uid: uids.admin, role: 'admin' });
      expect(res.data).toMatchObject({ uid: uids.operator, role: 'admin', claimed: true });

      const written = (await adb.collection('users').doc(uids.operator).get()).data();
      expect(written).toMatchObject({ role: 'admin', email: 'operator@sweater.test' });
      expect((await adb.collection('app_admins').doc(uids.operator).get()).exists).toBe(true);
      // …ولا شيء كُتب للحساب الذي ادّعته الحمولة.
      expect((await adb.collection('users').doc(uids.admin).get()).exists).toBe(false);
    }, 90_000);

    it('وعلى نظام مُهيَّأ: مرفوضة، والحالة تقول ذلك قبل عرض الزر', async () => {
      // `beforeEach` seeds the four role documents, so this run is not fresh.
      const call = await as('operator');
      expect((await call('authBootstrapStatus')({})).data).toEqual({ unclaimed: false });
      await expect(call('authClaimFirstAdmin')({})).rejects.toThrow(/مُهيَّأ بالفعل/);
      expect((await adb.collection('app_admins').get()).size).toBe(0);
    }, 90_000);

    it('وغير المسجَّل الدخول مرفوض في الاثنين', async () => {
      await signOut(auth).catch(() => {});
      const anon = (name) => httpsCallable(fns, name);
      await expectDenied(anon('authBootstrapStatus')({}));
      await expectDenied(anon('authClaimFirstAdmin')({}));
    }, 60_000);
  });
});
