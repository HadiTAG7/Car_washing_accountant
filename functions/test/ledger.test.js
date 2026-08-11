/**
 * اختبارات الخادم الموثوق — the ledger core, on a real Firestore.
 *
 * These drive `functions/src/ledger.js` through the Admin SDK against the
 * emulator, which is exactly how it runs in production: rules do not apply,
 * so every guard proven here is a guard the code itself enforces. That is the
 * point — the four holes these close are ones no rule could express.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  postEntry, postSource, reverseEntry, closePeriod, reopenPeriod,
  seedChartOfAccounts, COL,
} from '../src/ledger.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let app, db;

const CHART = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1200', nameArabic: 'ضريبة مدخلات', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '2100', nameArabic: 'ضريبة مخرجات', accountType: 'liability', normalBalance: 'credit', active: true },
  { code: '4000', nameArabic: 'إيرادات', accountType: 'revenue', normalBalance: 'credit', active: true },
  { code: '5100', nameArabic: 'مصروفات متغيرة', accountType: 'expense', normalBalance: 'debit', active: true },
  { code: '5200', nameArabic: 'مصروفات شهرية', accountType: 'expense', normalBalance: 'debit', active: true },
  { code: '2000', nameArabic: 'الموردون', accountType: 'liability', normalBalance: 'credit', active: true },
];

/** A balanced wash entry: 115 gross = 100 revenue + 15 output VAT. */
const WASH = (over = {}) => ({
  entry: {
    entryDate: '2026-08-11', sourceType: 'wash', sourceId: 'w1',
    description: 'غسلات', ...over.entry,
  },
  lines: over.lines || [
    { accountId: '1010', debit: 115, credit: 0, description: 'تحصيل' },
    { accountId: '4000', debit: 0, credit: 100, description: 'إيراد' },
    { accountId: '2100', debit: 0, credit: 15, description: 'ضريبة' },
  ],
});

// `postEntry` is the MANUAL path, so it writes a source lock only when the
// caller names the kind — a manual entry has no source record to lock.
const post = (payload, opts) => postEntry(db, FieldValue, payload, {
  userId: 'u1', lockKind: 'wash', ...opts,
});

// The operational collections and app_settings are written by the postSource
// cases; leaving them behind would leak state into the next test.
const WIPE = [...Object.values(COL), 'washes', 'monthly_expenses',
  'variable_expenses', 'app_settings'];

async function wipe() {
  for (const c of WIPE) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((s) => s.ref.delete()));
  }
}

d('الخادم الموثوق للترحيل', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-sweater-functions' }, 'fn-test');
    db = getFirestore(app);
  }, 60_000);

  afterAll(async () => { if (app) await deleteApp(app); });

  beforeEach(async () => {
    await wipe();
    await seedChartOfAccounts(db, FieldValue, CHART, { userId: 'u1' });
  }, 60_000);

  // ═══ الثغرة ١: التوازن ═══════════════════════════════════════════════
  // Firestore rules have no fold, so this check CANNOT live in a rule. It is
  // the single reason posting had to move to a trusted server.
  describe('التوازن — ما لا تستطيع القواعد التحقق منه', () => {
    it('يرفض قيداً مديناً 100 ودائناً 1', async () => {
      await expect(post({
        entry: { entryDate: '2026-08-11', sourceType: 'manual', description: 'مختل' },
        lines: [
          { accountId: '1010', debit: 100, credit: 0 },
          { accountId: '4000', debit: 0, credit: 1 },
        ],
      })).rejects.toThrow(/غير متوازن/);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
    });

    it('يرفض فرقاً بهللة واحدة', async () => {
      await expect(post({
        entry: { entryDate: '2026-08-11', sourceType: 'manual', description: 'هللة' },
        lines: [
          { accountId: '1010', debit: 100.01, credit: 0 },
          { accountId: '4000', debit: 0, credit: 100 },
        ],
      })).rejects.toThrow(/غير متوازن/);
    });

    it('ولا يترك أثراً: لا قيد ولا رقم مستهلك ولا قفل', async () => {
      await post(WASH());                                  // number 1
      await expect(post({
        entry: { entryDate: '2026-08-11', sourceType: 'manual', description: 'مختل' },
        lines: [
          { accountId: '1010', debit: 500, credit: 0 },
          { accountId: '4000', debit: 0, credit: 1 },
        ],
      })).rejects.toThrow();
      const next = await post({ ...WASH({ entry: { sourceId: 'w2' } }) });
      expect(next.entryNumber).toBe(2);                    // not 3
      expect((await db.collection(COL.LOCKS).get()).size).toBe(2);
    });

    it('يرفض السطر الذي يحمل مديناً ودائناً معاً', async () => {
      await expect(post({
        entry: { entryDate: '2026-08-11', sourceType: 'manual', description: 'سطر مزدوج' },
        lines: [
          { accountId: '1010', debit: 100, credit: 100 },
          { accountId: '4000', debit: 0, credit: 100 },
          { accountId: '5100', debit: 100, credit: 0 },
        ],
      })).rejects.toThrow(/مديناً ودائناً معاً/);
    });

    it('يرفض المبالغ السالبة وحساباً خارج الدليل', async () => {
      await expect(post({
        entry: { entryDate: '2026-08-11', sourceType: 'manual', description: 'سالب' },
        lines: [
          { accountId: '1010', debit: -100, credit: 0 },
          { accountId: '4000', debit: 0, credit: -100 },
        ],
      })).rejects.toThrow(/سالب/);
      await expect(post({
        entry: { entryDate: '2026-08-11', sourceType: 'manual', description: 'مجهول' },
        lines: [
          { accountId: '9999', debit: 100, credit: 0 },
          { accountId: '4000', debit: 0, credit: 100 },
        ],
      })).rejects.toThrow(/غير موجود في دليل الحسابات/);
    });
  });

  // ═══ الثغرة ٤: الفترة تُشتق من التاريخ ═══════════════════════════════
  describe('الفترة مشتقة من تاريخ القيد على الخادم', () => {
    it('يتجاهل periodKey المُرسَل من العميل ويشتقه من entryDate', async () => {
      const res = await post({
        entry: {
          entryDate: '2026-07-15', periodKey: '2026-08',   // ← a lie
          sourceType: 'manual', description: 'محاولة تمرير',
        },
        lines: [
          { accountId: '1010', debit: 100, credit: 0 },
          { accountId: '4000', debit: 0, credit: 100 },
        ],
      });
      const saved = (await db.collection(COL.ENTRIES).doc(res.entryId).get()).data();
      expect(saved.periodKey).toBe('2026-07');
    });

    it('فيوليو المقفلة تُرفض ولو ادّعى العميل أغسطس', async () => {
      await db.collection(COL.PERIODS).doc('2026-07').set({ periodKey: '2026-07', status: 'closed' });
      await expect(post({
        entry: {
          entryDate: '2026-07-15', periodKey: '2026-08',
          sourceType: 'manual', description: 'تهريب',
        },
        lines: [
          { accountId: '1010', debit: 100, credit: 0 },
          { accountId: '4000', debit: 0, credit: 100 },
        ],
      })).rejects.toThrow(/الفترة 2026-07 مقفلة/);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
    });

    // Date.parse rolls 2026-02-30 over to 2 March instead of failing, so a
    // naive check would have filed this entry in the wrong month.
    it('يرفض تاريخاً غير موجود في التقويم', async () => {
      await expect(post({
        entry: { entryDate: '2026-02-30', sourceType: 'manual', description: 'تاريخ وهمي' },
        lines: [
          { accountId: '1010', debit: 100, credit: 0 },
          { accountId: '4000', debit: 0, credit: 100 },
        ],
      })).rejects.toThrow(/التقويم/);
      await expect(post({
        entry: { entryDate: '2025-02-29', sourceType: 'manual', description: 'سنة غير كبيسة' },
        lines: [
          { accountId: '1010', debit: 100, credit: 0 },
          { accountId: '4000', debit: 0, credit: 100 },
        ],
      })).rejects.toThrow(/التقويم/);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
    });
  });

  // ═══ الترحيل السليم ═════════════════════════════════════════════════
  describe('الترحيل الناجح', () => {
    it('يكتب القيد وسطوره والفترة والقفل والتدقيق في معاملة واحدة', async () => {
      const res = await post(WASH());
      expect(res.entryNumber).toBe(1);
      expect(res).toMatchObject({ debit: 115, credit: 115 });

      const entry = (await db.collection(COL.ENTRIES).doc(res.entryId).get()).data();
      expect(entry.status).toBe('posted');
      expect(entry.periodKey).toBe('2026-08');
      expect(entry.lines).toHaveLength(3);
      expect(entry.totalDebit).toBe(115);
      expect(entry.createdBy).toBe('u1');

      expect((await db.collection(COL.PERIODS).doc('2026-08').get()).data().status).toBe('open');
      const lock = await db.collection(COL.LOCKS).doc('wash__w1').get();
      expect(lock.data()).toMatchObject({ entryId: res.entryId, entryNumber: 1 });
      expect((await db.collection(COL.AUDIT).where('action', '==', 'post').get()).size).toBe(1);
    });

    it('أرقام القيود فريدة ومتصلة تحت التزامن', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => post(WASH({ entry: { sourceId: `w${i}` } }))),
      );
      const numbers = results.map((r) => r.entryNumber).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(8);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }, 60_000);

    it('لا يُرحَّل السجل نفسه مرتين — القفل يُقرأ داخل المعاملة', async () => {
      await post(WASH());
      await expect(post(WASH())).rejects.toThrow(/سبق ترحيل/);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(1);
    });
  });

  // ═══ الثغرتان ٢ و٣: العكس والقفل ════════════════════════════════════
  describe('العكس يبنيه الخادم — لا يقبله من العميل', () => {
    it('ينشئ مرآة متوازنة ويربط القيدين ويؤشّر الأصل', async () => {
      const orig = await post(WASH());
      const rev = await reverseEntry(db, FieldValue, orig.entryId, {
        entryDate: '2026-09-01', userId: 'u1',
      });

      const original = (await db.collection(COL.ENTRIES).doc(orig.entryId).get()).data();
      expect(original.status).toBe('reversed');
      expect(original.reversedBy).toBe(rev.entryId);
      // The original's lines are untouched — the trail shows what was filed.
      expect(original.lines).toHaveLength(3);
      expect(original.lines[0]).toMatchObject({ accountId: '1010', debit: 115 });

      const mirror = (await db.collection(COL.ENTRIES).doc(rev.entryId).get()).data();
      expect(mirror.reversalOf).toBe(orig.entryId);
      expect(mirror.totalDebit).toBe(mirror.totalCredit);
      // Every account nets to zero across the pair.
      const net = new Map();
      for (const l of [...original.lines, ...mirror.lines]) {
        net.set(l.accountId, (net.get(l.accountId) || 0) + l.debit - l.credit);
      }
      for (const v of net.values()) expect(Math.abs(v)).toBeLessThan(0.005);
    });

    it('يفكّ قفل المصدر داخل عملية العكس نفسها', async () => {
      const orig = await post(WASH());
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(true);
      await reverseEntry(db, FieldValue, orig.entryId, { entryDate: '2026-09-01', userId: 'u1' });
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(false);
    });

    it('لا يُعكس قيد مرتين ولا قيد غير موجود', async () => {
      const orig = await post(WASH());
      await reverseEntry(db, FieldValue, orig.entryId, { entryDate: '2026-09-01', userId: 'u1' });
      await expect(reverseEntry(db, FieldValue, orig.entryId, { entryDate: '2026-09-02' }))
        .rejects.toThrow(/غير مُرحّل/);
      await expect(reverseEntry(db, FieldValue, 'لا-يوجد', { entryDate: '2026-09-02' }))
        .rejects.toThrow(/غير موجود/);
    });

    it('لا يُعكس في فترة مقفلة', async () => {
      const orig = await post(WASH());
      await db.collection(COL.PERIODS).doc('2026-09').set({ periodKey: '2026-09', status: 'closed' });
      await expect(reverseEntry(db, FieldValue, orig.entryId, { entryDate: '2026-09-05' }))
        .rejects.toThrow(/مقفلة/);
      expect((await db.collection(COL.ENTRIES).doc(orig.entryId).get()).data().status).toBe('posted');
    });

    it('القيد القديم بلا سطور داخله يُرفض عكسه بدل تخمينها', async () => {
      const ref = db.collection(COL.ENTRIES).doc();
      await ref.set({
        entryDate: '2026-08-01', periodKey: '2026-08', status: 'posted',
        entryNumber: 99, sourceType: 'manual', description: 'قديم',
      });
      await expect(reverseEntry(db, FieldValue, ref.id, { entryDate: '2026-09-01' }))
        .rejects.toThrow(/صيغة قديمة/);
    });
  });

  // ═══ الفترات ════════════════════════════════════════════════════════
  describe('الإقفال وإعادة الفتح', () => {
    it('يُقفل بعد التحقق من توازن كل قيد على حدة', async () => {
      await post(WASH());
      const r = await closePeriod(db, FieldValue, '2026-08', { userId: 'u1' });
      expect(r.periodKey).toBe('2026-08');
      expect((await db.collection(COL.PERIODS).doc('2026-08').get()).data().status).toBe('closed');
    });

    it('يرفض الإقفال مع قيد غير متوازن دُسّ في القاعدة مباشرة', async () => {
      await post(WASH());
      await db.collection(COL.ENTRIES).doc().set({
        entryDate: '2026-08-20', periodKey: '2026-08', status: 'posted',
        entryNumber: 999, sourceType: 'manual', description: 'مختل',
        lines: [
          { accountId: '1010', debit: 50, credit: 0 },
          { accountId: '4000', debit: 0, credit: 40 },
        ],
      });
      await expect(closePeriod(db, FieldValue, '2026-08', { userId: 'u1' }))
        .rejects.toThrow(/غير متوازن/);
    });

    it('لا يُقفل شهر مرتين', async () => {
      await post(WASH());
      await closePeriod(db, FieldValue, '2026-08', { userId: 'u1' });
      await expect(closePeriod(db, FieldValue, '2026-08', { userId: 'u1' }))
        .rejects.toThrow(/مقفلة بالفعل/);
    });

    it('إعادة الفتح تتطلب سبباً وتُسجَّل', async () => {
      await post(WASH());
      await closePeriod(db, FieldValue, '2026-08', { userId: 'u1' });
      await expect(reopenPeriod(db, FieldValue, '2026-08', { userId: 'admin1' }))
        .rejects.toThrow(/سبب/);
      await expect(reopenPeriod(db, FieldValue, '2026-08', { userId: 'admin1', reason: '  ' }))
        .rejects.toThrow(/سبب/);

      await reopenPeriod(db, FieldValue, '2026-08', { userId: 'admin1', reason: 'فاتورة متأخرة' });
      const p = (await db.collection(COL.PERIODS).doc('2026-08').get()).data();
      expect(p.status).toBe('open');
      expect(p.reopenReason).toBe('فاتورة متأخرة');
      const audit = await db.collection(COL.AUDIT).where('action', '==', 'reopen').get();
      expect(audit.size).toBe(1);
      expect(audit.docs[0].data().userId).toBe('admin1');
    });

    it('لا تُفتح فترة ليست مقفلة', async () => {
      await expect(reopenPeriod(db, FieldValue, '2026-08', { userId: 'admin1', reason: 'x' }))
        .rejects.toThrow(/ليست مقفلة/);
    });
  });

  describe('تهيئة دليل الحسابات', () => {
    it('قابلة للتكرار ولا تُنشئ حساباً مرتين', async () => {
      const again = await seedChartOfAccounts(db, FieldValue, CHART, { userId: 'u1' });
      expect(again.created).toBe(0);
      expect((await db.collection(COL.ACCOUNTS).get()).size).toBe(CHART.length);
    });

    it('ترفض الترحيل قبل التهيئة برسالة مفهومة', async () => {
      await wipe();
      await expect(post(WASH())).rejects.toThrow(/دليل الحسابات غير مُهيّأ/);
    });
  });

  // ═══ الترحيل من المصدر — الخادم يقرأ السجل ═══════════════════════════
  describe('ledgerPostSource — الحمولة تسمّي السجل والخادم يقرأه', () => {
    const wash = (over = {}) => ({
      biker_name: 'أحمد', quantity: 2, price: 57.5, status: 'مكتملة',
      wash_date: '2026-08-11', payment_method: 'cash', ...over,
    });

    it('يبني القيد من مستند الغسلة نفسه', async () => {
      await db.collection('washes').doc('w1').set(wash());
      const res = await postSource(db, FieldValue, { kind: 'wash', sourceId: 'w1' }, { userId: 'u1' });
      const e = (await db.collection(COL.ENTRIES).doc(res.entryId).get()).data();
      expect(e.totalDebit).toBe(115);
      expect(e.lines.find((l) => l.accountId === '4000').credit).toBe(100);
      expect(e.lines.find((l) => l.accountId === '2100').credit).toBe(15);
      expect(e.entryDate).toBe('2026-08-11');
      expect(e.sourceKind).toBe('wash');
    });

    // The whole point: the payload cannot describe a different transaction.
    it('يتجاهل أي مبالغ أو تواريخ في الحمولة — لا مكان لها أصلاً', async () => {
      await db.collection('washes').doc('w1').set(wash());
      const res = await postSource(db, FieldValue, {
        kind: 'wash', sourceId: 'w1',
        // None of this reaches the ledger: postSource takes kind + id only.
        entry: { entryDate: '2020-01-01', description: 'مزوّر' },
        lines: [
          { accountId: '1010', debit: 50000, credit: 0 },
          { accountId: '4000', debit: 0, credit: 50000 },
        ],
      }, { userId: 'u1' });
      const e = (await db.collection(COL.ENTRIES).doc(res.entryId).get()).data();
      expect(e.totalDebit).toBe(115);            // from the wash, not the payload
      expect(e.entryDate).toBe('2026-08-11');
      expect(e.description).not.toContain('مزوّر');
    });

    it('يرفض سجلاً غير موجود', async () => {
      await expect(postSource(db, FieldValue, { kind: 'wash', sourceId: 'ghost' }))
        .rejects.toThrow(/غير موجود/);
    });

    it('يرفض بلا معرّف مصدر — لا شيء يمنع تكراره', async () => {
      await expect(postSource(db, FieldValue, { kind: 'wash', sourceId: '' }))
        .rejects.toThrow(/معرّف السجل المصدر مطلوب/);
      await expect(postSource(db, FieldValue, { kind: 'wash' }))
        .rejects.toThrow(/معرّف السجل المصدر مطلوب/);
    });

    it('يرفض سجلاً غير معتمد', async () => {
      await db.collection('washes').doc('w2').set(wash({ status: 'قيد التنفيذ' }));
      await expect(postSource(db, FieldValue, { kind: 'wash', sourceId: 'w2' }))
        .rejects.toThrow(/غير مكتملة/);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
    });

    it('يرفض نوعاً غير معروف', async () => {
      await expect(postSource(db, FieldValue, { kind: 'لا-شيء', sourceId: 'x' }))
        .rejects.toThrow(/نوع سجل غير معروف/);
    });

    it('يقرأ إعدادات الضريبة من الخادم لا من الحمولة', async () => {
      await db.collection('app_settings').doc('accounting').set({ value: { vatRegistered: false } });
      await db.collection('washes').doc('w1').set(wash());
      const res = await postSource(db, FieldValue, { kind: 'wash', sourceId: 'w1' }, { userId: 'u1' });
      const e = (await db.collection(COL.ENTRIES).doc(res.entryId).get()).data();
      // Not registered → the whole amount is revenue, no output VAT line.
      expect(e.lines.find((l) => l.accountId === '4000').credit).toBe(115);
      expect(e.lines.some((l) => l.accountId === '2100')).toBe(false);
    });

    it('لا يُرحَّل السجل مرتين، والقفل مفتاحه نوع السجل', async () => {
      await db.collection('washes').doc('w1').set(wash());
      await postSource(db, FieldValue, { kind: 'wash', sourceId: 'w1' }, { userId: 'u1' });
      await expect(postSource(db, FieldValue, { kind: 'wash', sourceId: 'w1' }))
        .rejects.toThrow(/سبق ترحيل/);
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(true);
    });

    // Five collections post with sourceType 'expense'; keying the lock on the
    // type put them all in one namespace.
    it('نوعا مصروف مختلفان بنفس المعرّف لا يتصادمان', async () => {
      await db.collection('monthly_expenses').doc('same-id').set({
        expense_name: 'إيجار', total_monthly_cost: 1150, logged_date: '2026-08-05',
        payment_status: 'paid',
      });
      await db.collection('variable_expenses').doc('same-id').set({
        expense_name: 'مواد', total_variable_cost: 230, logged_date: '2026-08-06',
      });
      const a = await postSource(db, FieldValue, { kind: 'monthly', sourceId: 'same-id' }, { userId: 'u1' });
      const b = await postSource(db, FieldValue, { kind: 'variable', sourceId: 'same-id' }, { userId: 'u1' });
      expect(a.entryId).not.toBe(b.entryId);
      expect((await db.collection(COL.LOCKS).doc('monthly__same-id').get()).exists).toBe(true);
      expect((await db.collection(COL.LOCKS).doc('variable__same-id').get()).exists).toBe(true);
    });

    it('يحترم قفلاً قديماً بصيغة expense__<id>', async () => {
      await db.collection('monthly_expenses').doc('m1').set({
        expense_name: 'إيجار', total_monthly_cost: 1150, logged_date: '2026-08-05',
      });
      await db.collection(COL.LOCKS).doc('expense__m1').set({
        sourceType: 'expense', sourceId: 'm1', entryId: 'old', entryNumber: 7,
      });
      await expect(postSource(db, FieldValue, { kind: 'monthly', sourceId: 'm1' }))
        .rejects.toThrow(/سبق ترحيل هذا السجل بالقيد رقم 7/);
    });
  });

  // ═══ الاختبار الإلزامي: E1 → E2 → E3، ثم عكس E2 ══════════════════════
  describe('دورة العكس وإعادة الترحيل', () => {
    it('لا يُعكس قيد عكسي، والقفل الأحدث يبقى، والمصدر يبقى محميًا', async () => {
      await db.collection('washes').doc('w1').set({
        biker_name: 'أحمد', quantity: 1, price: 115, status: 'مكتملة',
        wash_date: '2026-08-11', payment_method: 'cash',
      });

      // E1 — the original posting.
      const e1 = await postSource(db, FieldValue, { kind: 'wash', sourceId: 'w1' }, { userId: 'u1' });
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).data().entryId).toBe(e1.entryId);

      // E2 — reversing it releases the lock, so the record can be corrected.
      const e2 = await reverseEntry(db, FieldValue, e1.entryId, { entryDate: '2026-08-20', userId: 'u1' });
      expect(e2.lockReleased).toBe(true);
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(false);

      // Correct the source and re-post it — E3 now owns the lock.
      await db.collection('washes').doc('w1').update({ price: 230 });
      const e3 = await postSource(db, FieldValue, { kind: 'wash', sourceId: 'w1' }, { userId: 'u1' });
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).data().entryId).toBe(e3.entryId);

      // Reversing E2 must be REFUSED: it is itself a reversal.
      await expect(reverseEntry(db, FieldValue, e2.entryId, { entryDate: '2026-08-25', userId: 'u1' }))
        .rejects.toThrow(/لا يُعكس قيد عكسي/);

      // And E3's lock is untouched — the source is still in the books.
      const lock = await db.collection(COL.LOCKS).doc('wash__w1').get();
      expect(lock.exists).toBe(true);
      expect(lock.data().entryId).toBe(e3.entryId);

      // Belt and braces: reversing E1 again cannot steal E3's lock either.
      await expect(reverseEntry(db, FieldValue, e1.entryId, { entryDate: '2026-08-26' }))
        .rejects.toThrow(/غير مُرحّل/);
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).data().entryId).toBe(e3.entryId);
    }, 120_000);

    it('عكس قيد أقدم لا يحذف قفلاً يملكه قيد أحدث', async () => {
      await db.collection('washes').doc('w1').set({
        quantity: 1, price: 115, status: 'مكتملة', wash_date: '2026-08-11',
      });
      const e1 = await postSource(db, FieldValue, { kind: 'wash', sourceId: 'w1' }, { userId: 'u1' });
      // Re-point the lock at a newer entry, as a re-post would.
      await db.collection(COL.LOCKS).doc('wash__w1').update({ entryId: 'newer-entry' });

      const rev = await reverseEntry(db, FieldValue, e1.entryId, { entryDate: '2026-08-20', userId: 'u1' });
      expect(rev.lockReleased).toBe(false);
      expect(rev.lockRetained).toBe(true);
      const lock = await db.collection(COL.LOCKS).doc('wash__w1').get();
      expect(lock.exists).toBe(true);
      expect(lock.data().entryId).toBe('newer-entry');
    }, 90_000);

    it('تاريخ العكس إلزامي وحقيقي — لا افتراضي ولا 30 فبراير', async () => {
      const orig = await post(WASH());
      await expect(reverseEntry(db, FieldValue, orig.entryId, {}))
        .rejects.toThrow(/تاريخ القيد العكسي مطلوب/);
      await expect(reverseEntry(db, FieldValue, orig.entryId, { entryDate: '2026-02-30' }))
        .rejects.toThrow(/تاريخ القيد العكسي مطلوب/);
      expect((await db.collection(COL.ENTRIES).doc(orig.entryId).get()).data().status).toBe('posted');
    });
  });

  // ═══ الفترات: شهر حقيقي ═════════════════════════════════════════════
  describe('مفتاح الفترة يجب أن يسمّي شهراً حقيقياً', () => {
    it('يرفض 2026-13 و2026-00 في الإقفال', async () => {
      await expect(closePeriod(db, FieldValue, '2026-13', { userId: 'u1' }))
        .rejects.toThrow(/مفتاح الفترة غير صالح/);
      await expect(closePeriod(db, FieldValue, '2026-00', { userId: 'u1' }))
        .rejects.toThrow(/مفتاح الفترة غير صالح/);
      await expect(closePeriod(db, FieldValue, '2026-8', { userId: 'u1' }))
        .rejects.toThrow(/مفتاح الفترة غير صالح/);
    });

    it('ويرفضها في إعادة الفتح أيضاً', async () => {
      await expect(reopenPeriod(db, FieldValue, '2026-13', { userId: 'a1', reason: 'x' }))
        .rejects.toThrow(/مفتاح الفترة غير صالح/);
    });
  });
});