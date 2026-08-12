/**
 * إصدار المستندات على الخادم.
 *
 * Issuing was BROKEN before this: the client transaction wrote `audit_logs`,
 * which the rules deny, so every issue attempt failed as a whole. These prove
 * it works now and, more importantly, that nothing a caller sends can decide
 * the number, the totals, the seller identity or the issuer.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { issueDocument, voidDocument, DOC_COL, totalsFromLines } from '../src/invoicing.js';
import { COL } from '../src/ledger.js';

/**
 * Net movement on one account — what the books say.
 *
 * Counts `posted` AND `reversed`, exactly as the reports do: a reversal adds a
 * mirror that cancels the original, so dropping the original while keeping the
 * mirror would show the reversal's effect twice, in the wrong direction.
 */
async function accountMovement(db, code) {
  const snap = await db.collection(COL.ENTRIES).get();
  let credit = 0, debit = 0;
  for (const d of snap.docs) {
    if (!['posted', 'reversed'].includes(d.data().status)) continue;
    for (const l of d.data().lines || []) {
      if (String(l.accountId) !== code) continue;
      credit += Number(l.credit) || 0;
      debit += Number(l.debit) || 0;
    }
  }
  return Math.round((credit - debit) * 100) / 100;
}

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let app, db;

const COMPANY = {
  name: 'شركة هادي الغانم', vatNumber: '300000000000003',
  address: 'الرياض', vatRegistered: true,
};
const LINES = [{ description: 'غسلة خارجية', quantity: 2, unitPrice: 57.5 }];

const issue = (input, opts) => issueDocument(db, FieldValue, input, { userId: 'acct1', ...opts });

async function wipe() {
  for (const c of [DOC_COL.DOCUMENTS, DOC_COL.SOURCES, DOC_COL.COUNTERS, DOC_COL.AUDIT,
    DOC_COL.SETTINGS, COL.ENTRIES, COL.PERIODS, 'chart_of_accounts']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((s) => s.ref.delete()));
  }
}

d('إصدار المستندات الضريبية على الخادم', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-sweater-invoicing' }, 'inv-test');
    db = getFirestore(app);
  }, 60_000);

  afterAll(async () => { if (app) await deleteApp(app); });

  const CHART = [
    { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit', active: true },
    { code: '1020', nameArabic: 'البنك', accountType: 'asset', normalBalance: 'debit', active: true },
    { code: '1100', nameArabic: 'العملاء', accountType: 'asset', normalBalance: 'debit', active: true },
    { code: '2100', nameArabic: 'ضريبة مخرجات', accountType: 'liability', normalBalance: 'credit', active: true },
    { code: '4000', nameArabic: 'إيرادات', accountType: 'revenue', normalBalance: 'credit', active: true },
    { code: '4010', nameArabic: 'مردودات المبيعات', accountType: 'revenue', normalBalance: 'debit', contra: true, active: true },
  ];

  beforeEach(async () => {
    await wipe();
    await db.collection(DOC_COL.SETTINGS).doc('company').set({ value: COMPANY });
    for (const a of CHART) await db.collection('chart_of_accounts').doc(a.code).set(a);
  }, 60_000);

  describe('الإصدار', () => {
    it('يصدر فاتورة مرقّمة بمجاميع محسوبة ورمز QR وسجل تدقيق', async () => {
      const res = await issue({ type: 'invoice', issueDate: '2026-08-11', issueTime: '14:30:00', lines: LINES });
      expect(res.documentNumber).toBe('INV-2026-000001');
      expect(res).toMatchObject({ net: 100, vat: 15, gross: 115 });

      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.status).toBe('issued');
      expect(doc.issuedBy).toBe('acct1');
      expect(doc.seller.vatNumber).toBe(COMPANY.vatNumber);
      expect(doc.qrPayload).toBeTruthy();
      expect(doc.zatcaReported).toBe(false);

      // The audit record the client could not write is here.
      const audit = await db.collection(DOC_COL.AUDIT).where('action', '==', 'issue').get();
      expect(audit.size).toBe(1);
      expect(audit.docs[0].data().userId).toBe('acct1');
    });

    // ── ما لا يُصدَّق من الحمولة ──────────────────────────────────────
    it('يعيد حساب المجاميع من السطور ويتجاهل المُرسَل منها', async () => {
      const res = await issue({
        type: 'invoice', issueDate: '2026-08-11', lines: LINES,
        net: 999999, vat: 999999, gross: 999999,      // ← ignored
      });
      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.gross).toBe(115);
      expect(doc.net).toBe(100);
      expect(doc.vat).toBe(15);
    });

    it('يتجاهل documentNumber وsequence وissuedBy المُرسَلة', async () => {
      const res = await issue({
        type: 'invoice', issueDate: '2026-08-11', lines: LINES,
        documentNumber: 'INV-1999-000001', sequence: 9999, issuedBy: 'someone-else',
        status: 'cancelled',
      });
      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.documentNumber).toBe('INV-2026-000001');
      expect(doc.sequence).toBe(1);
      expect(doc.issuedBy).toBe('acct1');
      expect(doc.status).toBe('issued');
    });

    it('يتجاهل هوية مورّد مُرسَلة — الرقم الضريبي من الإعدادات وحدها', async () => {
      const res = await issue({
        type: 'invoice', issueDate: '2026-08-11', lines: LINES,
        seller: { name: 'منشأة أخرى', vatNumber: '399999999999993' },
      });
      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.seller.vatNumber).toBe(COMPANY.vatNumber);
      expect(doc.seller.name).toBe(COMPANY.name);
    });

    it('الأرقام متسلسلة وفريدة تحت التزامن', async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () =>
        issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES })));
      const seqs = results.map((r) => r.sequence).sort((a, b) => a - b);
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
    }, 60_000);

    it('لا يُصدَر مستندان لنفس السجل المصدر', async () => {
      await issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES, sourceType: 'wash', sourceId: 'w1' });
      await expect(issue({
        type: 'invoice', issueDate: '2026-08-12', lines: LINES, sourceType: 'wash', sourceId: 'w1',
      })).rejects.toThrow(/سبق إصدار مستند/);
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(1);
    });

    it('يرفض تاريخاً غير حقيقي ومستنداً بلا سطور وإجمالياً صفراً', async () => {
      await expect(issue({ type: 'invoice', issueDate: '2026-02-30', lines: LINES }))
        .rejects.toThrow(/تاريخ إصدار المستند غير صالح/);
      await expect(issue({ type: 'invoice', issueDate: '2026-08-11', lines: [] }))
        .rejects.toThrow(/بلا سطور/);
      // A zero unit price is caught by the line check, which names the row.
      await expect(issue({
        type: 'invoice', issueDate: '2026-08-11',
        lines: [{ description: 'مجاني', quantity: 1, unitPrice: 0 }],
      })).rejects.toThrow(/السطر 1: سعر الوحدة/);
    });

    it('الإشعار يحتاج سبباً ومرجعاً', async () => {
      await expect(issue({ type: 'credit_note', issueDate: '2026-08-11', lines: LINES, referenceDocumentId: 'x' }))
        .rejects.toThrow(/سبب الإشعار مطلوب/);
      await expect(issue({ type: 'credit_note', issueDate: '2026-08-11', lines: LINES, reason: 'إلغاء' }))
        .rejects.toThrow(/يشير إلى فاتورة/);
    });

    it('لكل نوع تسلسله المستقل، ولكل سنة بداية جديدة', async () => {
      const inv = await issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES });
      const crn = await issue({
        type: 'credit_note', issueDate: '2026-08-20', lines: LINES,
        reason: 'إلغاء', referenceDocumentId: inv.id,
      });
      const next = await issue({ type: 'invoice', issueDate: '2027-01-02', lines: LINES });
      expect(inv.documentNumber).toBe('INV-2026-000001');
      expect(crn.documentNumber).toBe('CRN-2026-000001');
      expect(next.documentNumber).toBe('INV-2027-000001');
    }, 60_000);

    it('منشأة غير مسجّلة: بلا ضريبة وبلا رمز QR', async () => {
      await db.collection(DOC_COL.SETTINGS).doc('company').set({
        value: { name: 'مغسلة', vatNumber: '', vatRegistered: false },
      });
      const res = await issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES });
      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.vat).toBe(0);
      expect(doc.gross).toBe(115);
      expect(doc.qrPayload).toBeNull();
    });

    it('رقم ضريبي غير صالح يمنع الإصدار قبل أن يمسّ العدّاد', async () => {
      await db.collection(DOC_COL.SETTINGS).doc('company').set({
        value: { name: 'س', vatNumber: '999', vatRegistered: true },
      });
      await expect(issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES }))
        .rejects.toThrow(/الرقم الضريبي/);
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(0);
      expect((await db.collection(DOC_COL.COUNTERS).doc('documents-invoice-2026').get()).exists).toBe(false);
    });
  });

  describe('الإلغاء', () => {
    it('يلغي بسبب ويسجّل التدقيق، ولا يحذف', async () => {
      const res = await issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES });
      await voidDocument(db, FieldValue, { documentId: res.id, reason: 'صدرت بالخطأ' }, { userId: 'acct1' });

      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.status).toBe('cancelled');
      expect(doc.voidReason).toBe('صدرت بالخطأ');
      expect(doc.documentNumber).toBe('INV-2026-000001');   // number stays spoken for
      expect((await db.collection(DOC_COL.AUDIT).where('action', '==', 'void').get()).size).toBe(1);
    });

    it('يرفض بلا سبب، ومستنداً مفقوداً، وإلغاءً مكرراً', async () => {
      const res = await issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES });
      await expect(voidDocument(db, FieldValue, { documentId: res.id, reason: '  ' }))
        .rejects.toThrow(/سبب الإلغاء مطلوب/);
      await expect(voidDocument(db, FieldValue, { documentId: 'ghost', reason: 'x' }))
        .rejects.toThrow(/غير موجود/);
      await voidDocument(db, FieldValue, { documentId: res.id, reason: 'خطأ' });
      await expect(voidDocument(db, FieldValue, { documentId: res.id, reason: 'مرة أخرى' }))
        .rejects.toThrow(/ملغى بالفعل/);
    });
  });

  describe('حساب السطور', () => {
    it('المجموع هو مجموع السطور المقرّبة — فالمستند يجمع كما يجمعه القارئ', () => {
      const t = totalsFromLines([
        { quantity: 1, unitPrice: 33.33 },
        { quantity: 1, unitPrice: 33.33 },
        { quantity: 1, unitPrice: 33.34 },
      ]);
      const sumNet = Math.round(t.lines.reduce((s, l) => s + l.lineNet, 0) * 100) / 100;
      expect(sumNet).toBe(t.net);
      expect(Math.round((t.net + t.vat) * 100) / 100).toBe(t.gross);
    });
  });

  // ═══ الإشعارات: المرجع يُقرأ ولا يُصدَّق ════════════════════════════
  describe('الإشعار الدائن والمدين', () => {
    const invoiceOf = () => issue({
      type: 'invoice', issueDate: '2026-08-11',
      lines: [{ description: 'غسلة', quantity: 4, unitPrice: 57.5 }],   // 230
    });

    it('يشتق رقم المرجع من المستند المقروء، لا من الحمولة', async () => {
      const inv = await invoiceOf();
      const note = await issue({
        type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع',
        referenceDocumentId: inv.id,
        // A forged number in the payload changes nothing.
        referenceNumber: 'INV-1999-999999',
        lines: [{ description: 'إرجاع', quantity: 1, unitPrice: 57.5 }],
      });
      const saved = (await db.collection(DOC_COL.DOCUMENTS).doc(note.id).get()).data();
      expect(saved.referenceNumber).toBe(inv.documentNumber);
      expect(saved.referenceNumber).not.toBe('INV-1999-999999');
    }, 60_000);

    it('يرفض مرجعاً وهمياً', async () => {
      await expect(issue({
        type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع',
        referenceDocumentId: 'لا-يوجد',
        lines: [{ description: 'إرجاع', quantity: 1, unitPrice: 10 }],
      })).rejects.toThrow(/الفاتورة المرجعية غير موجودة/);
    });

    it('ويرفض إشعاراً مقابل إشعار', async () => {
      const inv = await invoiceOf();
      const note = await issue({
        type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع',
        referenceDocumentId: inv.id,
        lines: [{ description: 'إرجاع', quantity: 1, unitPrice: 57.5 }],
      });
      await expect(issue({
        type: 'credit_note', issueDate: '2026-08-21', reason: 'مرة أخرى',
        referenceDocumentId: note.id,
        lines: [{ description: 'إرجاع', quantity: 1, unitPrice: 10 }],
      })).rejects.toThrow(/فاتورة فقط/);
    }, 60_000);

    // ── سياسة عدم التجاوز ──
    it('يرفض إشعاراً دائناً أكبر من الفاتورة الأصلية', async () => {
      const inv = await invoiceOf();                       // 230
      await expect(issue({
        type: 'credit_note', issueDate: '2026-08-20', reason: 'مبالغة',
        referenceDocumentId: inv.id,
        lines: [{ description: 'إرجاع', quantity: 10, unitPrice: 57.5 }],   // 575
      })).rejects.toThrow(/يتجاوز المتبقي من الفاتورة/);
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(1);
    }, 60_000);

    it('ويجمع الإشعارات السابقة قبل الحكم', async () => {
      const inv = await invoiceOf();                       // 230
      await issue({
        type: 'credit_note', issueDate: '2026-08-20', reason: 'جزئي',
        referenceDocumentId: inv.id,
        lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],    // 115
      });
      // 115 remains: this one fits exactly…
      await issue({
        type: 'credit_note', issueDate: '2026-08-21', reason: 'الباقي',
        referenceDocumentId: inv.id,
        lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],    // 115
      });
      // …and nothing is left for a third.
      await expect(issue({
        type: 'credit_note', issueDate: '2026-08-22', reason: 'زيادة',
        referenceDocumentId: inv.id,
        lines: [{ description: 'إرجاع', quantity: 1, unitPrice: 57.5 }],
      })).rejects.toThrow(/يتجاوز المتبقي/);
    }, 90_000);

    it('الإشعار المدين لا يخضع للسقف — فهو يزيد الفاتورة لا يعكسها', async () => {
      const inv = await invoiceOf();
      const debit = await issue({
        type: 'debit_note', issueDate: '2026-08-22', reason: 'فرق سعر',
        referenceDocumentId: inv.id,
        lines: [{ description: 'فرق', quantity: 20, unitPrice: 57.5 }],
      });
      expect(debit.documentNumber).toBe('DBN-2026-000001');
    }, 60_000);
  });

  // ═══ سطور مسمومة ════════════════════════════════════════════════════
  // `Number(x) || 0` turns NaN into 0 and passes Infinity straight through, so
  // these would have produced a document totalling Infinity — or one silently
  // worth nothing.
  describe('قيم السطور غير الصالحة', () => {
    const bad = (line) => issue({ type: 'invoice', issueDate: '2026-08-11', lines: [line] });

    it('يرفض Infinity في الكمية أو السعر', async () => {
      await expect(bad({ description: 'x', quantity: Infinity, unitPrice: 10 }))
        .rejects.toThrow(/الكمية يجب أن تكون رقماً موجباً/);
      await expect(bad({ description: 'x', quantity: 1, unitPrice: Infinity }))
        .rejects.toThrow(/سعر الوحدة يجب أن يكون رقماً موجباً/);
    });

    it('ويرفض NaN وغير الرقمي', async () => {
      await expect(bad({ description: 'x', quantity: NaN, unitPrice: 10 }))
        .rejects.toThrow(/الكمية/);
      await expect(bad({ description: 'x', quantity: 'كثير', unitPrice: 10 }))
        .rejects.toThrow(/الكمية/);
      await expect(bad({ description: 'x', quantity: 1, unitPrice: null }))
        .rejects.toThrow(/سعر الوحدة/);
    });

    it('ويرفض السالب والصفر', async () => {
      await expect(bad({ description: 'x', quantity: -1, unitPrice: 10 }))
        .rejects.toThrow(/الكمية/);
      await expect(bad({ description: 'x', quantity: 1, unitPrice: -10 }))
        .rejects.toThrow(/سعر الوحدة/);
    });

    it('ويرفض وصفاً فارغاً', async () => {
      await expect(bad({ description: '   ', quantity: 1, unitPrice: 10 }))
        .rejects.toThrow(/الوصف مطلوب/);
    });

    it('ولا يترك أي أثر — لا مستند ولا رقم مستهلك', async () => {
      await expect(bad({ description: 'x', quantity: 1e308, unitPrice: 1e308 }))
        .rejects.toThrow();
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(0);
      expect((await db.collection(DOC_COL.COUNTERS).doc('documents-invoice-2026').get()).exists).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // الإشعار يجب أن يصل إلى الدفاتر
  // ═══════════════════════════════════════════════════════════════════════
  // A note that writes only `sales_documents` changes nothing: revenue and
  // output tax stay where the invoice left them, and the VAT report keeps
  // showing the original sale in full. These prove the entry lands with it.
  describe('الأثر المحاسبي للإشعارات', () => {
    // 115 gross = 100 revenue + 15 output VAT.
    const invoiceOf = () => issue({
      type: 'invoice', issueDate: '2026-08-11',
      lines: [{ description: 'غسلة', quantity: 2, unitPrice: 57.5 }],
    });
    const creditFor = (inv, over = {}) => issue({
      type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع',
      referenceDocumentId: inv.id, refundMethod: 'cash',
      lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],
      ...over,
    });

    it('الفاتورة وحدها لا تُنشئ قيداً — غسلتها مُرحّلة أصلاً', async () => {
      const inv = await invoiceOf();
      expect(inv.journalEntryId).toBeNull();
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
    });

    it('الإشعار الدائن الكامل يصفّر ضريبة المخرجات وصافي الإيراد', async () => {
      const inv = await invoiceOf();
      const note = await creditFor(inv);

      expect(note.journalEntryId).toBeTruthy();
      const entry = (await db.collection(COL.ENTRIES).doc(note.journalEntryId).get()).data();
      expect(entry.totalDebit).toBe(entry.totalCredit);
      expect(entry.documentId).toBe(note.id);
      expect(entry.documentNumber).toBe(note.documentNumber);
      // Dr 4010 returns 100 · Dr 2100 tax 15 · Cr 1010 cash 115.
      expect(entry.lines.find((l) => l.accountId === '4010').debit).toBe(100);
      expect(entry.lines.find((l) => l.accountId === '2100').debit).toBe(15);
      expect(entry.lines.find((l) => l.accountId === '1010').credit).toBe(115);

      // And the document points back at its entry.
      const saved = (await db.collection(DOC_COL.DOCUMENTS).doc(note.id).get()).data();
      expect(saved.journalEntryId).toBe(note.journalEntryId);

      // Against a posted invoice-side entry the movement nets to zero. Here
      // only the note is posted, so 2100 shows the reversal.
      expect(await accountMovement(db, '2100')).toBe(-15);
      expect(await accountMovement(db, '4010')).toBe(-100);
    }, 60_000);

    it('الإشعار الجزئي يخفض جزئياً', async () => {
      const inv = await invoiceOf();
      await creditFor(inv, { lines: [{ description: 'إرجاع', quantity: 1, unitPrice: 57.5 }] });
      expect(await accountMovement(db, '2100')).toBe(-7.5);
      expect(await accountMovement(db, '4010')).toBe(-50);
    }, 60_000);

    it('الإشعار المدين يزيد الإيراد وضريبة المخرجات', async () => {
      const inv = await invoiceOf();
      const note = await issue({
        type: 'debit_note', issueDate: '2026-08-22', reason: 'فرق سعر',
        referenceDocumentId: inv.id, paymentMethod: 'transfer',
        lines: [{ description: 'فرق', quantity: 1, unitPrice: 23 }],
      });
      const entry = (await db.collection(COL.ENTRIES).doc(note.journalEntryId).get()).data();
      // Dr 1020 bank 23 · Cr 4000 revenue 20 · Cr 2100 tax 3.
      expect(entry.lines.find((l) => l.accountId === '1020').debit).toBe(23);
      expect(entry.lines.find((l) => l.accountId === '4000').credit).toBe(20);
      expect(entry.lines.find((l) => l.accountId === '2100').credit).toBe(3);
      expect(await accountMovement(db, '2100')).toBe(3);
    }, 60_000);

    it('طريقة الرد تحدّد حساب التسوية — لا تخمين', async () => {
      const inv = await invoiceOf();
      const note = await creditFor(inv, { refundMethod: 'credit' });
      const entry = (await db.collection(COL.ENTRIES).doc(note.journalEntryId).get()).data();
      // On credit the refund reduces the customer's balance, not the till.
      expect(entry.lines.find((l) => l.accountId === '1100').credit).toBe(115);
    }, 60_000);

    it('فشل القيد يمنع المستند ولا يستهلك رقماً', async () => {
      const inv = await invoiceOf();
      // 4010 removed from the chart → the note's entry cannot validate.
      await db.collection('chart_of_accounts').doc('4010').delete();
      await expect(creditFor(inv)).rejects.toThrow(/غير موجود في دليل الحسابات/);

      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(1);   // invoice only
      expect((await db.collection(DOC_COL.COUNTERS).doc('documents-credit_note-2026').get()).exists).toBe(false);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
    }, 60_000);

    it('الفترة المقفلة ترفض الإشعار كاملاً', async () => {
      const inv = await invoiceOf();
      await db.collection(COL.PERIODS).doc('2026-08').set({ periodKey: '2026-08', status: 'closed' });
      await expect(creditFor(inv)).rejects.toThrow(/مقفلة/);
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(1);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
    }, 60_000);

    it('التزامن لا ينتج مستنداً بلا قيد ولا قيداً بلا مستند', async () => {
      const inv = await issue({
        type: 'invoice', issueDate: '2026-08-11',
        lines: [{ description: 'غسلة', quantity: 20, unitPrice: 57.5 }],   // 1150
      });
      const results = await Promise.allSettled(Array.from({ length: 4 }, () =>
        creditFor(inv, { lines: [{ description: 'إرجاع', quantity: 1, unitPrice: 57.5 }] })));
      const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      expect(ok.length).toBeGreaterThan(0);

      const notes = (await db.collection(DOC_COL.DOCUMENTS).get()).docs
        .map((x) => x.data()).filter((x) => x.type === 'credit_note');
      const entries = (await db.collection(COL.ENTRIES).get()).docs.map((x) => ({ id: x.id, ...x.data() }));
      // One entry per note, and every entry names a note that exists.
      expect(entries).toHaveLength(notes.length);
      for (const n of notes) {
        expect(n.journalEntryId).toBeTruthy();
        expect(entries.some((e) => e.id === n.journalEntryId)).toBe(true);
      }
      for (const e of entries) {
        expect(notes.some((n) => n.journalEntryId === e.id)).toBe(true);
      }
      // And the journal numbers are unique.
      const numbers = entries.map((e) => e.entryNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
    }, 120_000);

    // ── الإلغاء يعكس الأثر ──
    it('إلغاء إشعار له قيد يعكس القيد ذرياً', async () => {
      const inv = await invoiceOf();
      const note = await creditFor(inv);
      expect(await accountMovement(db, '2100')).toBe(-15);

      const voided = await voidDocument(db, FieldValue, {
        documentId: note.id, reason: 'صدر بالخطأ', entryDate: '2026-08-25',
      }, { userId: 'acct1' });
      expect(voided.reversalEntryId).toBeTruthy();

      // The original entry is marked, the mirror is posted, and the net
      // effect on 2100 is back to nothing.
      const original = (await db.collection(COL.ENTRIES).doc(note.journalEntryId).get()).data();
      expect(original.status).toBe('reversed');
      expect(original.reversedBy).toBe(voided.reversalEntryId);
      expect(await accountMovement(db, '2100')).toBe(0);
      expect(await accountMovement(db, '4010')).toBe(0);

      const saved = (await db.collection(DOC_COL.DOCUMENTS).doc(note.id).get()).data();
      expect(saved.status).toBe('cancelled');
      expect(saved.reversalEntryId).toBe(voided.reversalEntryId);
    }, 120_000);

    it('وإلغاء فاتورة بلا قيد يبقى إلغاءً بسيطاً', async () => {
      const inv = await invoiceOf();
      const voided = await voidDocument(db, FieldValue, {
        documentId: inv.id, reason: 'خطأ',
      }, { userId: 'acct1' });
      expect(voided.reversalEntryId).toBeNull();
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
    }, 60_000);

    it('لا يُلغى الإشعار مرتين ولا يُعكس قيده مرتين', async () => {
      const inv = await invoiceOf();
      const note = await creditFor(inv);
      await voidDocument(db, FieldValue, { documentId: note.id, reason: 'خطأ' }, { userId: 'acct1' });
      await expect(voidDocument(db, FieldValue, { documentId: note.id, reason: 'مرة أخرى' }))
        .rejects.toThrow(/ملغى بالفعل/);
      const entries = (await db.collection(COL.ENTRIES).get()).docs.map((x) => x.data());
      expect(entries.filter((e) => e.reversalOf)).toHaveLength(1);
    }, 120_000);
  });

  // ═══ المعالجة الضريبية تأتي من الفاتورة المرجعية ═════════════════════
  describe('الإشعار يرث معالجة فاتورته', () => {
    it('إشعار على فاتورة ضريبية يحمل ضريبتها ولو أُلغي التسجيل بعدها', async () => {
      // (أ) a taxable invoice, VAT 15
      const inv = await issue({
        type: 'invoice', issueDate: '2026-08-11',
        lines: [{ description: 'غسلة', quantity: 2, unitPrice: 57.5 }],
      });
      expect(inv.vat).toBe(15);
      expect(inv.vatRate).toBe(0.15);

      // (ب) the business de-registers
      await db.collection(DOC_COL.SETTINGS).doc('company').set({
        value: { name: 'مغسلة', vatNumber: '', vatRegistered: false },
      });

      // (ج) a full credit note against the OLD invoice
      const note = await issue({
        type: 'credit_note', issueDate: '2026-09-01', reason: 'إرجاع',
        referenceDocumentId: inv.id, refundMethod: 'cash',
        lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],
      });

      // (د) it still carries VAT 15 and zeroes the invoice
      expect(note.vat).toBe(15);
      expect(note.gross).toBe(115);
      expect(note.vatRate).toBe(0.15);
      const saved = (await db.collection(DOC_COL.DOCUMENTS).doc(note.id).get()).data();
      expect(saved.taxable).toBe(true);
      // The seller identity travels with the reference, so the note is still
      // attributable to the registration that issued the invoice.
      expect(saved.seller.vatNumber).toBe(COMPANY.vatNumber);

      // (هـ) 2100 and revenue fall by the right amounts
      expect(await accountMovement(db, '2100')).toBe(-15);
      expect(await accountMovement(db, '4010')).toBe(-100);
    }, 120_000);

    it('ويتجاهل taxable وvatRate وpriceMode المُرسَلة', async () => {
      const inv = await issue({
        type: 'invoice', issueDate: '2026-08-11',
        lines: [{ description: 'غسلة', quantity: 2, unitPrice: 57.5 }],
      });
      const note = await issue({
        type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع',
        referenceDocumentId: inv.id, refundMethod: 'cash',
        taxable: false, vatRate: 0, priceMode: 'exclusive',   // ← all ignored
        lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],
      });
      expect(note.vat).toBe(15);
      expect(note.gross).toBe(115);
      const saved = (await db.collection(DOC_COL.DOCUMENTS).doc(note.id).get()).data();
      expect(saved.priceMode).toBe('inclusive');
      expect(saved.vatRate).toBe(0.15);
    }, 90_000);

    it('كل مستند يخزّن نسبته صراحةً', async () => {
      const inv = await issue({
        type: 'invoice', issueDate: '2026-08-11',
        lines: [{ description: 'غسلة', quantity: 1, unitPrice: 115 }],
      });
      const saved = (await db.collection(DOC_COL.DOCUMENTS).doc(inv.id).get()).data();
      expect(saved.vatRate).toBe(0.15);
    });
  });

  // ═══ الوقت ═════════════════════════════════════════════════════════
  describe('التحقق من الوقت', () => {
    const at = (t) => issue({ type: 'invoice', issueDate: '2026-08-11', issueTime: t, lines: LINES });

    it('يرفض 25:70 و99:99:99 بدل قبولها', async () => {
      expect((await db.collection(DOC_COL.DOCUMENTS).doc((await at('25:70')).id).get()).data().issueTime)
        .toBe('00:00:00');
      expect((await db.collection(DOC_COL.DOCUMENTS).doc((await at('99:99:99')).id).get()).data().issueTime)
        .toBe('00:00:00');
    }, 60_000);

    it('ويقبل الحدين 00:00:00 و23:59:59', async () => {
      const a = await at('00:00:00');
      const b = await at('23:59:59');
      const docA = (await db.collection(DOC_COL.DOCUMENTS).doc(a.id).get()).data();
      const docB = (await db.collection(DOC_COL.DOCUMENTS).doc(b.id).get()).data();
      expect(docA.issueTime).toBe('00:00:00');
      expect(docB.issueTime).toBe('23:59:59');
      expect(docB.timestamp).toBe('2026-08-11T23:59:59');
    }, 60_000);

    it('و24:00:00 ليس وقتاً', async () => {
      const r = await at('24:00:00');
      expect((await db.collection(DOC_COL.DOCUMENTS).doc(r.id).get()).data().issueTime).toBe('00:00:00');
    }, 60_000);
  });
});