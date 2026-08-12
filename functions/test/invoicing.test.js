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
import {
  issueDocument, voidDocument, correctLinkedInvoice, DOC_COL, totalsFromLines,
} from '../src/invoicing.js';
import { postSource, reverseEntry } from '../src/ledger.js';
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

/** The raw call — for the tests that are ABOUT a missing field. */
const issueRaw = (input, opts) => issueDocument(db, FieldValue, input, { userId: 'acct1', ...opts });

/**
 * A standalone invoice now creates the sale in the books, so its settlement is
 * required. Tests that are not about the settlement get the common one; the
 * ones that are use `issueRaw` and pass (or omit) their own.
 */
const issue = (input, opts) => issueRaw({
  ...(String(input.type || 'invoice') === 'invoice' && !input.washId
    ? { paymentMethod: 'cash', paymentStatus: 'paid' } : {}),
  ...input,
}, opts);

/** 115 gross = 100 revenue + 15 output VAT, with no wash behind it. */
const invoiceOfStandalone = (over = {}) => issue({
  type: 'invoice', issueDate: '2026-08-11',
  paymentMethod: 'cash', paymentStatus: 'paid',
  lines: [{ description: 'غسلة', quantity: 2, unitPrice: 57.5 }],
  ...over,
});

/** Voiding an entry-carrying document needs the date its reversal lands on. */
const voidDoc = (documentId, extra = {}) => voidDocument(
  db, FieldValue, { documentId, reason: 'إلغاء', reversalDate: '2026-08-25', ...extra },
  { userId: 'acct1' },
);

async function wipe() {
  for (const c of [DOC_COL.DOCUMENTS, DOC_COL.SOURCES, DOC_COL.COUNTERS, DOC_COL.AUDIT,
    DOC_COL.SETTINGS, COL.ENTRIES, COL.PERIODS, COL.LOCKS, 'chart_of_accounts', 'washes']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((s) => s.ref.delete()));
  }
}

/**
 * A wash that is genuinely in the books: the record, its posting lock and the
 * entry the lock names, exactly as `postSource` would have left them.
 */
async function postedWash(id, { quantity = 2, price = 57.5, taxable = true, date = '2026-08-11',
  method = 'cash', biker = 'أحمد', entryNumber = 1 } = {}) {
  const base = Math.round(quantity * price * 100) / 100;
  const vat = taxable ? Math.round((base - base / 1.15) * 100) / 100 : 0;
  const net = Math.round((base - vat) * 100) / 100;
  const lines = [
    { accountId: method === 'cash' ? '1010' : '1020', debit: base, credit: 0, description: 'تحصيل غسلات' },
    { accountId: '4000', debit: 0, credit: net, description: 'إيراد غسيل السيارات' },
  ];
  if (vat > 0) lines.push({ accountId: '2100', debit: 0, credit: vat, description: 'ضريبة مخرجات 15%' });

  await db.collection('washes').doc(id).set({
    biker_name: biker, quantity, price, status: 'مكتملة', wash_date: date, payment_method: method,
  });
  const entryRef = db.collection(COL.ENTRIES).doc();
  await entryRef.set({
    entryDate: date, periodKey: date.slice(0, 7), sourceType: 'wash', sourceId: id,
    sourceKind: 'wash', description: `غسلات — ${biker}`, status: 'posted', reversalOf: null,
    entryNumber, lines, lineCount: lines.length, totalDebit: base, totalCredit: base,
  });
  await db.collection(COL.LOCKS).doc(`wash__${id}`).set({
    kind: 'wash', sourceType: 'wash', sourceId: id, entryId: entryRef.id, entryNumber,
  });
  return { entryId: entryRef.id, base, net, vat };
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

    // `wash` is not usable here any more — it has its own path — so the claim
    // is exercised with a source kind that genuinely has no ledger entry.
    it('لا يُصدَر مستندان لنفس السجل المصدر', async () => {
      await issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES, sourceType: 'contract', sourceId: 'c1' });
      await expect(issue({
        type: 'invoice', issueDate: '2026-08-12', lines: LINES, sourceType: 'contract', sourceId: 'c1',
      })).rejects.toThrow(/سبق إصدار مستند/);
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(1);
    });

    it('يرفض تاريخاً غير حقيقي ومستنداً بلا سطور وإجمالياً صفراً', async () => {
      await expect(issue({ type: 'invoice', issueDate: '2026-02-30', lines: LINES }))
        .rejects.toThrow(/تاريخ إصدار المستند مطلوب/);
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
      await voidDoc(res.id, { reason: 'صدرت بالخطأ' });

      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.status).toBe('cancelled');
      expect(doc.voidReason).toBe('صدرت بالخطأ');
      expect(doc.documentNumber).toBe('INV-2026-000001');   // number stays spoken for
      expect((await db.collection(DOC_COL.AUDIT).where('action', '==', 'void').get()).size).toBe(1);
    });

    it('يرفض بلا سبب، ومستنداً مفقوداً، وإلغاءً مكرراً', async () => {
      const res = await issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES });
      await expect(voidDoc(res.id, { reason: '  ' })).rejects.toThrow(/سبب الإلغاء مطلوب/);
      await expect(voidDoc('ghost', { reason: 'x' })).rejects.toThrow(/غير موجود/);
      await voidDoc(res.id, { reason: 'خطأ' });
      await expect(voidDoc(res.id, { reason: 'مرة أخرى' })).rejects.toThrow(/ملغى بالفعل/);
    });

    // ── تاريخ العكس مطلوب وصريح ─────────────────────────────────────
    // The old default — "no date? use the document's own" — is precisely what
    // left a document in a closed month with no way out.
    it('يرفض إلغاء مستند ذي قيد بلا تاريخ عكس صريح', async () => {
      const res = await issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES });
      await expect(voidDocument(db, FieldValue, { documentId: res.id, reason: 'خطأ' }))
        .rejects.toThrow(/تاريخ القيد العكسي مطلوب/);
      await expect(voidDoc(res.id, { reversalDate: '2026-02-30' }))
        .rejects.toThrow(/تاريخ القيد العكسي مطلوب/);
      // Nothing was written by either refusal.
      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.status).toBe('issued');
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
    // 115 gross = 100 revenue + 15 output VAT. A STANDALONE invoice: no wash
    // behind it, so the invoice itself is the source and posts the sale.
    const invoiceOf = (over = {}) => issue({
      type: 'invoice', issueDate: '2026-08-11',
      paymentMethod: 'cash', paymentStatus: 'paid',
      lines: [{ description: 'غسلة', quantity: 2, unitPrice: 57.5 }],
      ...over,
    });
    const creditFor = (inv, over = {}) => issue({
      type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع',
      referenceDocumentId: inv.id, refundMethod: 'cash',
      lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],
      ...over,
    });

    it('الفاتورة المستقلة تُنشئ فاتورتها وقيد بيعها في معاملة واحدة', async () => {
      const inv = await invoiceOf();
      expect(inv.mode).toBe('standalone');
      expect(inv.journalEntryId).toBeTruthy();
      expect(inv.linkedJournalEntryId).toBeNull();

      const entry = (await db.collection(COL.ENTRIES).doc(inv.journalEntryId).get()).data();
      expect(entry.sourceType).toBe('sales_invoice');
      expect(entry.sourceId).toBe(inv.id);
      expect(entry.documentId).toBe(inv.id);
      expect(entry.documentNumber).toBe(inv.documentNumber);
      // Dr 1010 cash 115 · Cr 4000 revenue 100 · Cr 2100 output tax 15.
      expect(entry.lines.find((l) => l.accountId === '1010').debit).toBe(115);
      expect(entry.lines.find((l) => l.accountId === '4000').credit).toBe(100);
      expect(entry.lines.find((l) => l.accountId === '2100').credit).toBe(15);

      const saved = (await db.collection(DOC_COL.DOCUMENTS).doc(inv.id).get()).data();
      expect(saved.journalEntryId).toBe(inv.journalEntryId);
      expect(saved.issueMode).toBe('standalone');
      expect(await accountMovement(db, '4000')).toBe(100);
      expect(await accountMovement(db, '2100')).toBe(15);
    }, 60_000);

    it('البيع غير المحصّل يدين ذمم العملاء لا الصندوق', async () => {
      const inv = await invoiceOf({ paymentMethod: 'card', paymentStatus: 'unpaid' });
      const entry = (await db.collection(COL.ENTRIES).doc(inv.journalEntryId).get()).data();
      // "Sold on card but not collected" is still a balance the customer owes.
      expect(entry.lines.find((l) => l.accountId === '1100').debit).toBe(115);
      expect(entry.lines.find((l) => l.accountId === '1020')).toBeUndefined();
      const saved = (await db.collection(DOC_COL.DOCUMENTS).doc(inv.id).get()).data();
      expect(saved.settlementAccount).toBe('1100');
    }, 60_000);

    it('يرفض فاتورة بيع مستقلة بلا طريقة أو حالة سداد', async () => {
      await expect(issueRaw({
        type: 'invoice', issueDate: '2026-08-11', lines: LINES,
      })).rejects.toThrow(/طريقة السداد مطلوبة/);
      await expect(issueRaw({
        type: 'invoice', issueDate: '2026-08-11', lines: LINES, paymentMethod: 'cash',
      })).rejects.toThrow(/حالة السداد مطلوبة/);
      // Neither refusal consumed a number.
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(0);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
    }, 60_000);

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

      // The invoice posted 100 of revenue and 15 of output tax; the note takes
      // both back. NET zero — which is what "cancelled in full" has to mean.
      expect(await accountMovement(db, '2100')).toBe(0);
      expect(await accountMovement(db, '4000')).toBe(100);
      expect(await accountMovement(db, '4010')).toBe(-100);
      const netRevenue = await accountMovement(db, '4000') + await accountMovement(db, '4010');
      expect(netRevenue).toBe(0);
      // And the cash went out again, so the till is level too.
      expect(await accountMovement(db, '1010')).toBe(0);
    }, 60_000);

    it('الإشعار الجزئي يخفض جزئياً', async () => {
      const inv = await invoiceOf();
      await creditFor(inv, { lines: [{ description: 'إرجاع', quantity: 1, unitPrice: 57.5 }] });
      expect(await accountMovement(db, '2100')).toBe(7.5);
      expect(await accountMovement(db, '4010')).toBe(-50);
      const netRevenue = await accountMovement(db, '4000') + await accountMovement(db, '4010');
      expect(netRevenue).toBe(50);
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
      expect(await accountMovement(db, '2100')).toBe(18);
      const netRevenue = await accountMovement(db, '4000') + await accountMovement(db, '4010');
      expect(netRevenue).toBe(120);
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
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(1);         // the invoice's own
    }, 60_000);

    it('الفترة المقفلة ترفض الإشعار كاملاً', async () => {
      const inv = await invoiceOf();
      await db.collection(COL.PERIODS).doc('2026-08').set({ periodKey: '2026-08', status: 'closed' });
      await expect(creditFor(inv)).rejects.toThrow(/مقفلة/);
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(1);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(1);
    }, 60_000);

    it('التزامن لا ينتج مستنداً بلا قيد ولا قيداً بلا مستند', async () => {
      const inv = await invoiceOf({
        lines: [{ description: 'غسلة', quantity: 20, unitPrice: 57.5 }],   // 1150
      });
      const results = await Promise.allSettled(Array.from({ length: 4 }, () =>
        creditFor(inv, { lines: [{ description: 'إرجاع', quantity: 1, unitPrice: 57.5 }] })));
      const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      expect(ok.length).toBeGreaterThan(0);

      const docs = (await db.collection(DOC_COL.DOCUMENTS).get()).docs.map((x) => x.data());
      const entries = (await db.collection(COL.ENTRIES).get()).docs.map((x) => ({ id: x.id, ...x.data() }));
      // Every document that posts has exactly one entry, and every entry names
      // a document that exists.
      const posting = docs.filter((x) => x.journalEntryId);
      expect(entries).toHaveLength(posting.length);
      for (const n of posting) {
        expect(entries.some((e) => e.id === n.journalEntryId)).toBe(true);
      }
      for (const e of entries) {
        expect(posting.some((n) => n.journalEntryId === e.id)).toBe(true);
      }
      // And the journal numbers are unique.
      const numbers = entries.map((e) => e.entryNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
    }, 120_000);

    // ── الإلغاء يعكس الأثر ──
    it('إلغاء إشعار له قيد يعكس القيد ذرياً', async () => {
      const inv = await invoiceOf();
      const note = await creditFor(inv);
      expect(await accountMovement(db, '2100')).toBe(0);   // invoice +15, note −15

      const voided = await voidDoc(note.id, { reason: 'صدر بالخطأ', reversalDate: '2026-08-25' });
      expect(voided.reversalEntryId).toBeTruthy();

      // The original entry is marked, the mirror is posted, and the note's
      // effect is undone — so the invoice's own 15 stands again.
      const original = (await db.collection(COL.ENTRIES).doc(note.journalEntryId).get()).data();
      expect(original.status).toBe('reversed');
      expect(original.reversedBy).toBe(voided.reversalEntryId);
      expect(await accountMovement(db, '2100')).toBe(15);
      expect(await accountMovement(db, '4010')).toBe(0);

      const saved = (await db.collection(DOC_COL.DOCUMENTS).doc(note.id).get()).data();
      expect(saved.status).toBe('cancelled');
      expect(saved.reversalEntryId).toBe(voided.reversalEntryId);
    }, 120_000);

    it('وفاتورة الغسلة لا تُلغى إلغاءً عادياً — تُوجَّه إلى التصحيح الذري', async () => {
      const wash = await postedWash('w-void');
      const inv = await issue({ type: 'invoice', washId: 'w-void', issueDate: '2026-08-12' });
      expect(inv.journalEntryId).toBeNull();

      // A plain void would cancel the paper, leave the entry posted, leave the
      // lock held and leave the claim held — a wash with revenue in the books
      // and no way to invoice it again.
      await expect(voidDoc(inv.id, { reason: 'خطأ' })).rejects.toThrow(/التصحيح الذري/);

      const saved = (await db.collection(DOC_COL.DOCUMENTS).doc(inv.id).get()).data();
      expect(saved.status).toBe('issued');
      const entries = (await db.collection(COL.ENTRIES).get()).docs;
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(wash.entryId);
      expect(entries[0].data().status).toBe('posted');
    }, 60_000);

    it('لا يُلغى الإشعار مرتين ولا يُعكس قيده مرتين', async () => {
      const inv = await invoiceOf();
      const note = await creditFor(inv);
      await voidDoc(note.id, { reason: 'خطأ' });
      await expect(voidDoc(note.id, { reason: 'مرة أخرى' })).rejects.toThrow(/ملغى بالفعل/);
      const entries = (await db.collection(COL.ENTRIES).get()).docs.map((x) => x.data());
      expect(entries.filter((e) => e.reversalOf)).toHaveLength(1);
    }, 120_000);

    // ── إلغاء إشعار في فترة مقفلة ─────────────────────────────────────
    // The gap this closes: a July note, July filed and closed, and the only
    // date the server would accept was the one inside the closed month.
    it('إشعار في فترة مقفلة يُلغى بتاريخ عكس في شهر مفتوح', async () => {
      const inv = await invoiceOf({ issueDate: '2026-07-05' });
      const note = await creditFor(inv, { issueDate: '2026-07-20' });
      const original = (await db.collection(COL.ENTRIES).doc(note.journalEntryId).get()).data();
      expect(original.periodKey).toBe('2026-07');

      await db.collection(COL.PERIODS).doc('2026-07').set({ periodKey: '2026-07', status: 'closed' });

      // Its own month is refused, and says why.
      await expect(voidDoc(note.id, { reversalDate: '2026-07-31' })).rejects.toThrow(/مقفلة/);
      // An open month succeeds.
      const voided = await voidDoc(note.id, { reversalDate: '2026-08-03' });
      const mirror = (await db.collection(COL.ENTRIES).doc(voided.reversalEntryId).get()).data();
      expect(mirror.entryDate).toBe('2026-08-03');
      expect(mirror.periodKey).toBe('2026-08');
      expect(mirror.reversalOf).toBe(note.journalEntryId);

      // July is untouched: the original still sits in its own closed month
      // with its own lines, exactly as filed.
      const after = (await db.collection(COL.ENTRIES).doc(note.journalEntryId).get()).data();
      expect(after.entryDate).toBe('2026-07-20');
      expect(after.periodKey).toBe('2026-07');
      expect(after.status).toBe('reversed');
      expect(after.lines).toEqual(original.lines);
    }, 120_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // مساران للإصدار: فاتورة غسلة مُرحّلة · فاتورة بيع مستقلة
  // ═══════════════════════════════════════════════════════════════════════
  // The assumption this replaces — "every invoice is for a wash that was
  // already posted, so no invoice ever posts" — was true of one path only.
  describe('فاتورة الغسلة المُرحّلة', () => {
    it('تبني الفاتورة من الغسلة وقيدها ولا تُنشئ قيداً ثانياً', async () => {
      const wash = await postedWash('w1');
      const res = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12', issueTime: '09:15:00' });

      expect(res.mode).toBe('linked');
      expect(res.journalEntryId).toBeNull();
      expect(res.linkedJournalEntryId).toBe(wash.entryId);
      expect(res).toMatchObject({ net: 100, vat: 15, gross: 115 });

      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.issueMode).toBe('linked');
      expect(doc.washId).toBe('w1');
      expect(doc.sourceType).toBe('wash');
      expect(doc.sourceId).toBe('w1');
      // Two dates, two facts: the paper's own and the service's.
      expect(doc.issueDate).toBe('2026-08-12');
      expect(doc.supplyDate).toBe('2026-08-11');
      expect(doc.lines).toHaveLength(1);
      expect(doc.lines[0].quantity).toBe(2);
      expect(doc.lines[0].unitPrice).toBe(57.5);
      expect(doc.settlementAccount).toBe('1010');

      // The books are unchanged: one entry, the wash's, and the revenue is in
      // there exactly once.
      const entries = (await db.collection(COL.ENTRIES).get()).docs;
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(wash.entryId);
      expect(await accountMovement(db, '4000')).toBe(100);
      expect(await accountMovement(db, '2100')).toBe(15);
    }, 60_000);

    it('تتجاهل السطور والمبالغ المُرسَلة لصالح قيمة الغسلة', async () => {
      await postedWash('w1');
      const res = await issue({
        type: 'invoice', washId: 'w1', issueDate: '2026-08-20',
        priceMode: 'exclusive',                                     // ← ignored
        lines: [{ description: 'مزوّر', quantity: 500, unitPrice: 999 }], // ← ignored
        net: 999999, vat: 999999, gross: 999999,                    // ← ignored
      });
      expect(res).toMatchObject({ net: 100, vat: 15, gross: 115 });
      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.lines).toHaveLength(1);
      expect(doc.lines[0].unitPrice).toBe(57.5);
      expect(doc.priceMode).toBe('inclusive');
      // The DATE, though, is the caller's — it is the document's own fact.
      expect(doc.issueDate).toBe('2026-08-20');
      expect(doc.supplyDate).toBe('2026-08-11');
    }, 60_000);

    // ═══ تاريخ الإصدار ≠ تاريخ التوريد ═════════════════════════════════
    it('الرقم والسنة والفترة ورمز QR تتبع تاريخ الإصدار لا تاريخ الغسلة', async () => {
      // A wash on the last day of July, invoiced on 12 August.
      await postedWash('w1', { date: '2026-07-31' });
      const res = await issue({
        type: 'invoice', washId: 'w1', issueDate: '2026-08-12', issueTime: '10:05:00',
      });

      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.supplyDate).toBe('2026-07-31');
      expect(doc.issueDate).toBe('2026-08-12');
      // Everything the document's identity is made of follows the ISSUE date.
      expect(doc.year).toBe(2026);
      expect(doc.timestamp).toBe('2026-08-12T10:05:00');
      expect(doc.documentNumber).toBe('INV-2026-000001');
      const qr = Buffer.from(doc.qrPayload, 'base64');
      expect(qr.toString('utf8')).toContain('2026-08-12T10:05:00');
      expect(qr.toString('utf8')).not.toContain('2026-07-31');
      // The counter that was consumed is the one for the issue year.
      expect((await db.collection(DOC_COL.COUNTERS).doc('documents-invoice-2026').get()).data().nextNumber).toBe(2);
    }, 60_000);

    it('لا تُصدر فاتورة قبل تاريخ توريدها', async () => {
      await postedWash('w1', { date: '2026-08-11' });
      await expect(issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-10' }))
        .rejects.toThrow(/قبل تاريخ التوريد/);
      // Same day is fine — invoicing on the day of service is the normal case.
      const same = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-11' });
      expect(same.issueDate).toBe('2026-08-11');
      expect(same.supplyDate).toBe('2026-08-11');
    }, 60_000);

    it('الفاتورة المستقلة تقبل تاريخ توريد صريح وتخزّنه', async () => {
      const res = await issue({
        type: 'invoice', issueDate: '2026-08-12', supplyDate: '2026-07-31', lines: LINES,
      });
      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(res.id).get()).data();
      expect(doc.supplyDate).toBe('2026-07-31');
      expect(doc.issueDate).toBe('2026-08-12');
      // …and its entry is dated by the ISSUE date, which is the period it
      // belongs to.
      const entry = (await db.collection(COL.ENTRIES).doc(res.journalEntryId).get()).data();
      expect(entry.entryDate).toBe('2026-08-12');
      expect(entry.periodKey).toBe('2026-08');
    }, 60_000);

    it('والإشعار يرث تاريخ توريد فاتورته', async () => {
      await postedWash('w1', { date: '2026-07-31' });
      const inv = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      const note = await issue({
        type: 'credit_note', issueDate: '2026-09-01', reason: 'إرجاع',
        referenceDocumentId: inv.id, refundMethod: 'cash',
        lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],
      });
      const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(note.id).get()).data();
      expect(doc.supplyDate).toBe('2026-07-31');   // the supply it corrects
      expect(doc.issueDate).toBe('2026-09-01');    // when the correction was raised
    }, 90_000);

    it('ترفض غسلة غير موجودة، وغير مكتملة، وغير مُرحّلة', async () => {
      await expect(issue({ type: 'invoice', washId: 'ghost', issueDate: '2026-08-12' }))
        .rejects.toThrow(/الغسلة غير موجودة/);

      // Recorded but never posted: no lock, so no invoice.
      await db.collection('washes').doc('w-unposted').set({
        biker_name: 'س', quantity: 1, price: 115, status: 'مكتملة',
        wash_date: '2026-08-12', payment_method: 'cash',
      });
      await expect(issue({ type: 'invoice', washId: 'w-unposted', issueDate: '2026-08-13' }))
        .rejects.toThrow(/غير مُرحّلة إلى الدفاتر/);

      // Not finished: revenue is not recognised, so neither is a tax invoice.
      await db.collection('washes').doc('w-open').set({
        biker_name: 'س', quantity: 1, price: 115, status: 'قيد التنفيذ',
        wash_date: '2026-08-12', payment_method: 'cash',
      });
      await expect(issue({ type: 'invoice', washId: 'w-open', issueDate: '2026-08-13' }))
        .rejects.toThrow(/غير مكتملة/);

      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(0);
    }, 60_000);

    it('ترفض الفاتورة إذا خالفت قيمة الغسلة قيدها المُرحّل', async () => {
      const wash = await postedWash('w1');
      // The wash row is edited under a posted entry — the two now disagree.
      await db.collection('washes').doc('w1').update({ price: 200 });
      await expect(issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' }))
        .rejects.toThrow(/لا تطابق قيدها المُرحّل/);
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(0);
      // And the entry is still the only thing in the books.
      const entries = (await db.collection(COL.ENTRIES).get()).docs;
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(wash.entryId);
    }, 60_000);

    it('لا تُفوتَر الغسلة مرتين', async () => {
      await postedWash('w1');
      const first = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      expect(first.documentNumber).toBe('INV-2026-000001');
      await expect(issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-13' }))
        .rejects.toThrow(/سبق إصدار مستند لهذا السجل/);
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(1);
    }, 60_000);

    it('ترفض تمرير غسلة عبر مسار الفاتورة المستقلة', async () => {
      await postedWash('w1');
      await expect(issueRaw({
        type: 'invoice', issueDate: '2026-08-11', lines: LINES,
        paymentMethod: 'cash', paymentStatus: 'paid',
        sourceType: 'wash', sourceId: 'w1',      // ← the double-count route
      })).rejects.toThrow(/تُصدر بإرسال washId/);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(1);   // the wash's only
    }, 60_000);

    it('إشعار دائن على فاتورة غسلة يخفض الإيراد مرة واحدة', async () => {
      await postedWash('w1');
      const inv = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      await issue({
        type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع',
        referenceDocumentId: inv.id, refundMethod: 'cash',
        lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],
      });
      // Wash entry +100 revenue +15 tax; note −100 (via 4010) −15. Net zero.
      const netRevenue = await accountMovement(db, '4000') + await accountMovement(db, '4010');
      expect(netRevenue).toBe(0);
      expect(await accountMovement(db, '2100')).toBe(0);
    }, 90_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // لا إشعار على فاتورة بلا أصل محاسبي
  // ═══════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════
  // التصحيح الذري لفاتورة الغسلة
  // ═══════════════════════════════════════════════════════════════════════
  // A wash-linked invoice, its entry, the posting lock and the source claim
  // are four things held together. Unwinding them one at a time can leave the
  // set half-undone in four different ways, each of which is a real state the
  // books can end up in. So it is one transaction, and the ledger refuses the
  // piecemeal route outright.
  describe('التصحيح الذري لفاتورة الغسلة', () => {
    const correct = (documentId, over = {}) => correctLinkedInvoice(
      db, FieldValue,
      { documentId, reason: 'سعر خاطئ', reversalDate: '2026-08-25', ...over },
      { userId: 'acct1' },
    );

    /** A wash posted through the ledger's own path, so the lock is real. */
    async function realPostedWash(id, over = {}) {
      await db.collection('washes').doc(id).set({
        biker_name: 'أحمد', quantity: 2, price: 57.5, status: 'مكتملة',
        wash_date: '2026-08-11', payment_method: 'cash', ...over,
      });
      await db.collection('app_settings').doc('accounting').set({
        value: { vatRegistered: true, washPriceMode: 'inclusive' },
      });
      return postSource(db, FieldValue, { kind: 'wash', sourceId: id }, { userId: 'acct1' });
    }

    it('E1 مُرحّل وF1 صادرة — عكس E1 مباشرة يفشل ويوجّه للمسار الذري', async () => {
      const e1 = await realPostedWash('w1');
      const f1 = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      expect(f1.linkedJournalEntryId).toBe(e1.entryId);

      await expect(reverseEntry(db, FieldValue, e1.entryId, { entryDate: '2026-08-25', userId: 'acct1' }))
        .rejects.toThrow(/موثّق بفاتورة سارية/);
      // …and the message names the way out.
      await expect(reverseEntry(db, FieldValue, e1.entryId, { entryDate: '2026-08-25' }))
        .rejects.toThrow(/تصحيح فاتورة الغسلة/);

      // Nothing moved: no mirror, entry still posted, invoice still issued.
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(1);
      expect((await db.collection(COL.ENTRIES).doc(e1.entryId).get()).data().status).toBe('posted');
      expect((await db.collection(DOC_COL.DOCUMENTS).doc(f1.id).get()).data().status).toBe('issued');
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(true);
    }, 120_000);

    it('ولا يُعكس قيد فاتورة بيع مستقلة من دفتر الأستاذ', async () => {
      const inv = await invoiceOfStandalone();
      await expect(reverseEntry(db, FieldValue, inv.journalEntryId, { entryDate: '2026-08-25' }))
        .rejects.toThrow(/مملوك للمستند/);
      expect((await db.collection(COL.ENTRIES).doc(inv.journalEntryId).get()).data().status).toBe('posted');
    }, 90_000);

    it('الرحلة الكاملة: F1 → تصحيح ذري → تعديل الغسلة → E2 → F2 بلا تكرار إيراد', async () => {
      const e1 = await realPostedWash('w1');
      const f1 = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      expect(await accountMovement(db, '4000')).toBe(100);

      // ── التصحيح الذري ──
      const fixed = await correct(f1.id);
      expect(fixed.reversalEntryId).toBeTruthy();
      expect(fixed.lockReleased).toBe(true);
      expect(fixed.claimReleased).toBe(true);

      // (١) المستند ملغى، ورقمه وتاريخاه كما هي
      const cancelled = (await db.collection(DOC_COL.DOCUMENTS).doc(f1.id).get()).data();
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.documentNumber).toBe('INV-2026-000001');
      expect(cancelled.issueDate).toBe('2026-08-12');
      expect(cancelled.supplyDate).toBe('2026-08-11');
      expect(cancelled.reversalEntryId).toBe(fixed.reversalEntryId);

      // (٢) E1 معكوس بمرآة مؤرخة بالتاريخ المطلوب
      const original = (await db.collection(COL.ENTRIES).doc(e1.entryId).get()).data();
      expect(original.status).toBe('reversed');
      const mirror = (await db.collection(COL.ENTRIES).doc(fixed.reversalEntryId).get()).data();
      expect(mirror.entryDate).toBe('2026-08-25');
      expect(mirror.reversalOf).toBe(e1.entryId);
      expect(mirror.sourceType).toBe('adjustment');
      expect(mirror.sourceId).toBeNull();
      expect(mirror.reversedSourceId).toBe('w1');
      expect(await accountMovement(db, '4000')).toBe(0);

      // (٣) القفل مفكوك و(٤) المطالبة محرّرة
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(false);
      const claim = (await db.collection(DOC_COL.SOURCES).doc('wash__w1').get()).data();
      expect(claim.status).toBe('released');
      expect(claim.previousDocumentId).toBe(f1.id);

      // ── الغسلة تُصحَّح وتُعاد ترحيلاً ──
      await db.collection('washes').doc('w1').update({ price: 115 });   // 2 × 115 = 230
      const e2 = await postSource(db, FieldValue, { kind: 'wash', sourceId: 'w1' }, { userId: 'acct1' });
      expect(e2.entryId).not.toBe(e1.entryId);

      // ── F2 ──
      const f2 = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-26' });
      expect(f2.documentNumber).toBe('INV-2026-000002');
      expect(f2.linkedJournalEntryId).toBe(e2.entryId);
      expect(f2.gross).toBe(230);
      expect(f2.replacesDocumentId).toBe(f1.id);

      // الرابط في الاتجاهين
      const savedF2 = (await db.collection(DOC_COL.DOCUMENTS).doc(f2.id).get()).data();
      expect(savedF2.replacesDocumentNumber).toBe('INV-2026-000001');
      const savedF1 = (await db.collection(DOC_COL.DOCUMENTS).doc(f1.id).get()).data();
      expect(savedF1.replacedByDocumentId).toBe(f2.id);
      expect(savedF1.replacedByDocumentNumber).toBe('INV-2026-000002');

      // ── الإيراد مرة واحدة ──
      // E1 (+100) + المرآة (−100) + E2 (+200) = 200، لا 300.
      expect(await accountMovement(db, '4000')).toBe(200);
      // ولا فاتورة سارية على قيد معكوس.
      const docs = (await db.collection(DOC_COL.DOCUMENTS).get()).docs.map((x) => x.data());
      const entriesById = new Map((await db.collection(COL.ENTRIES).get()).docs.map((x) => [x.id, x.data()]));
      for (const doc of docs.filter((x) => x.status === 'issued' && x.linkedJournalEntryId)) {
        expect(entriesById.get(doc.linkedJournalEntryId).status).toBe('posted');
      }
    }, 180_000);

    it('لا تُصدر فاتورة بديلة قبل إعادة ترحيل الغسلة', async () => {
      await realPostedWash('w1');
      const f1 = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      await correct(f1.id);
      // The claim is released, but the lock is gone too — so there is no live
      // entry to document, and the invoice is refused for that reason.
      await expect(issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-26' }))
        .rejects.toThrow(/غير مُرحّلة إلى الدفاتر/);
      expect((await db.collection(DOC_COL.DOCUMENTS).get()).size).toBe(1);
    }, 120_000);

    it('فشل التصحيح لا يترك مستنداً ولا قيداً ولا قفلاً ولا مطالبة جزئية', async () => {
      const e1 = await realPostedWash('w1');
      const f1 = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      // The reversal month is closed, so the whole transaction must abort.
      await db.collection(COL.PERIODS).doc('2026-09').set({ periodKey: '2026-09', status: 'closed' });
      await expect(correct(f1.id, { reversalDate: '2026-09-05' })).rejects.toThrow(/مقفلة/);

      expect((await db.collection(DOC_COL.DOCUMENTS).doc(f1.id).get()).data().status).toBe('issued');
      expect((await db.collection(COL.ENTRIES).doc(e1.entryId).get()).data().status).toBe('posted');
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(1);
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(true);
      expect((await db.collection(DOC_COL.SOURCES).doc('wash__w1').get()).data().status).toBe('held');
    }, 120_000);

    it('ويرفض التصحيح بلا سبب أو بلا تاريخ عكس، ولمستند ليس فاتورة غسلة', async () => {
      await realPostedWash('w1');
      const f1 = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      await expect(correct(f1.id, { reason: '  ' })).rejects.toThrow(/سبب التصحيح مطلوب/);
      await expect(correct(f1.id, { reversalDate: '' })).rejects.toThrow(/تاريخ القيد العكسي مطلوب/);
      const standalone = await invoiceOfStandalone();
      await expect(correct(standalone.id)).rejects.toThrow(/ليست فاتورة غسلة/);
    }, 120_000);

    it('ولا يفك قفلاً يملكه قيد أحدث', async () => {
      // A wash posted, reversed through the correction path, corrected and
      // re-posted — then the OLD invoice is corrected a second time. The lock
      // now belongs to E2 and must not be freed.
      const e1 = await realPostedWash('w1');
      const f1 = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      await correct(f1.id);
      await postSource(db, FieldValue, { kind: 'wash', sourceId: 'w1' }, { userId: 'acct1' });
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(true);
      // Correcting the already-cancelled F1 again is refused, so the lock is
      // never even reached — which is the guard working from the other end.
      await expect(correct(f1.id)).rejects.toThrow(/ملغى بالفعل/);
      expect((await db.collection(COL.ENTRIES).doc(e1.entryId).get()).data().status).toBe('reversed');
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(true);
    }, 150_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // لا تُلغى فاتورة عليها إشعارات نشطة
  // ═══════════════════════════════════════════════════════════════════════
  // Reversing the invoice in full while its credit note stays posted takes the
  // sale out twice: once through the reversal and again through the note.
  describe('الفاتورة ذات الإشعارات النشطة', () => {
    const creditOn = (inv, over = {}) => issue({
      type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع جزئي',
      referenceDocumentId: inv.id, refundMethod: 'cash',
      lines: [{ description: 'إرجاع', quantity: 1, unitPrice: 57.5 }],
      ...over,
    });
    const debitOn = (inv, over = {}) => issue({
      type: 'debit_note', issueDate: '2026-08-21', reason: 'فرق سعر',
      referenceDocumentId: inv.id, paymentMethod: 'cash',
      lines: [{ description: 'فرق', quantity: 1, unitPrice: 23 }],
      ...over,
    });

    it('فاتورة مستقلة 115 وإشعار دائن 57.5 — الإلغاء مرفوض والدفاتر لا تتغير', async () => {
      const inv = await invoiceOfStandalone();
      const note = await creditOn(inv);
      const before = {
        revenue: await accountMovement(db, '4000'),
        returns: await accountMovement(db, '4010'),
        vat: await accountMovement(db, '2100'),
      };
      expect(before).toEqual({ revenue: 100, returns: -50, vat: 7.5 });

      await expect(voidDoc(inv.id, { reason: 'خطأ' })).rejects.toThrow(/إشعار نشط/);
      // The message names the note, so the next step is obvious.
      await expect(voidDoc(inv.id, { reason: 'خطأ' })).rejects.toThrow(new RegExp(note.documentNumber));

      expect((await db.collection(DOC_COL.DOCUMENTS).doc(inv.id).get()).data().status).toBe('issued');
      expect(await accountMovement(db, '4000')).toBe(before.revenue);
      expect(await accountMovement(db, '4010')).toBe(before.returns);
      expect(await accountMovement(db, '2100')).toBe(before.vat);
    }, 120_000);

    it('وبعد إلغاء الإشعار بقيد مرآة تُلغى الفاتورة ويعود الرصيد إلى صفر', async () => {
      const inv = await invoiceOfStandalone();
      const note = await creditOn(inv);

      await voidDoc(note.id, { reason: 'الإشعار صدر بالخطأ', reversalDate: '2026-08-25' });
      // The note is cancelled and its entry mirrored, so the invoice stands
      // alone again at its full amount.
      expect(await accountMovement(db, '4010')).toBe(0);
      expect(await accountMovement(db, '4000')).toBe(100);

      const voided = await voidDoc(inv.id, { reason: 'الفاتورة نفسها خاطئة', reversalDate: '2026-08-26' });
      expect(voided.reversalEntryId).toBeTruthy();
      // Everything nets to nothing: sale, note, and both reversals.
      expect(await accountMovement(db, '4000')).toBe(0);
      expect(await accountMovement(db, '4010')).toBe(0);
      expect(await accountMovement(db, '2100')).toBe(0);
      expect(await accountMovement(db, '1010')).toBe(0);
    }, 150_000);

    it('والإشعار المدين يمنع الإلغاء بنفس السياسة', async () => {
      const inv = await invoiceOfStandalone();
      await debitOn(inv);
      expect(await accountMovement(db, '4000')).toBe(120);
      await expect(voidDoc(inv.id, { reason: 'خطأ' })).rejects.toThrow(/إشعار نشط/);
      expect(await accountMovement(db, '4000')).toBe(120);
    }, 120_000);

    it('وفاتورة الغسلة كذلك — التصحيح الذري مرفوض قبل معالجة الإشعارات', async () => {
      await postedWash('w1');
      const inv = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      await creditOn(inv);
      await expect(correctLinkedInvoice(db, FieldValue, {
        documentId: inv.id, reason: 'سعر خاطئ', reversalDate: '2026-08-25',
      }, { userId: 'acct1' })).rejects.toThrow(/إشعار نشط/);

      // The wash's entry and its lock are untouched.
      expect((await db.collection(COL.LOCKS).doc('wash__w1').get()).exists).toBe(true);
      expect((await db.collection(DOC_COL.DOCUMENTS).doc(inv.id).get()).data().status).toBe('issued');
    }, 120_000);

    it('والإشعار الملغى لا يمنع شيئاً', async () => {
      const inv = await invoiceOfStandalone();
      const note = await creditOn(inv);
      await voidDoc(note.id, { reason: 'خطأ', reversalDate: '2026-08-25' });
      const voided = await voidDoc(inv.id, { reason: 'خطأ', reversalDate: '2026-08-26' });
      expect(voided.reversalEntryId).toBeTruthy();
    }, 120_000);
  });

  describe('الإشعار يتطلب أصلاً محاسبياً قائماً', () => {
    it('يرفض إشعاراً على فاتورة بلا قيد ولا قيد مرتبط', async () => {
      // A document written the way the old code left every invoice: paper only.
      const legacy = db.collection(DOC_COL.DOCUMENTS).doc();
      await legacy.set({
        type: 'invoice', status: 'issued', documentNumber: 'INV-2025-000009',
        sequence: 9, year: 2025, issueDate: '2025-12-01', taxable: true,
        priceMode: 'inclusive', vatRate: 0.15, net: 100, vat: 15, gross: 115,
        journalEntryId: null, linkedJournalEntryId: null,
        seller: { name: COMPANY.name, vatNumber: COMPANY.vatNumber, address: '' },
      });
      await expect(issue({
        type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع',
        referenceDocumentId: legacy.id, refundMethod: 'cash',
        lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],
      })).rejects.toThrow(/بلا قيد في الدفاتر/);

      // Nothing was created, so no negative revenue was invented.
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
      expect(await accountMovement(db, '4010')).toBe(0);
    }, 60_000);

    it('يرفض إشعاراً على فاتورة قيدها معكوس', async () => {
      await postedWash('w1');
      const inv = await issue({ type: 'invoice', washId: 'w1', issueDate: '2026-08-12' });
      // The wash entry is reversed through the ledger — the invoice now
      // documents nothing live.
      await db.collection(COL.ENTRIES).doc(inv.linkedJournalEntryId).update({ status: 'reversed' });
      await expect(issue({
        type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع',
        referenceDocumentId: inv.id, refundMethod: 'cash',
        lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],
      })).rejects.toThrow(/معكوس/);
    }, 60_000);

    it('يرفض إشعاراً على فاتورة قيدها مفقود', async () => {
      const inv = await invoiceOfStandalone();
      await db.collection(COL.ENTRIES).doc(inv.journalEntryId).delete();
      await expect(issue({
        type: 'credit_note', issueDate: '2026-08-20', reason: 'إرجاع',
        referenceDocumentId: inv.id, refundMethod: 'cash',
        lines: [{ description: 'إرجاع', quantity: 2, unitPrice: 57.5 }],
      })).rejects.toThrow(/غير موجود/);
    }, 60_000);
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

      // (هـ) the note undoes the invoice exactly: output tax back to zero and
      // net revenue (4000 less 4010) back to zero, even though the setting
      // that made the sale taxable no longer says so.
      expect(await accountMovement(db, '2100')).toBe(0);
      expect(await accountMovement(db, '4000')).toBe(100);
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