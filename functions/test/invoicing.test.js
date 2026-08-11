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
  for (const c of [DOC_COL.DOCUMENTS, DOC_COL.SOURCES, DOC_COL.COUNTERS, DOC_COL.AUDIT, DOC_COL.SETTINGS]) {
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

  beforeEach(async () => {
    await wipe();
    await db.collection(DOC_COL.SETTINGS).doc('company').set({ value: COMPANY });
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
      await expect(issue({
        type: 'invoice', issueDate: '2026-08-11',
        lines: [{ description: 'مجاني', quantity: 1, unitPrice: 0 }],
      })).rejects.toThrow(/أكبر من صفر/);
    });

    it('الإشعار يحتاج سبباً ومرجعاً', async () => {
      await expect(issue({ type: 'credit_note', issueDate: '2026-08-11', lines: LINES, referenceNumber: 'INV-2026-000001' }))
        .rejects.toThrow(/سبب الإشعار مطلوب/);
      await expect(issue({ type: 'credit_note', issueDate: '2026-08-11', lines: LINES, reason: 'إلغاء' }))
        .rejects.toThrow(/يشير إلى فاتورة/);
    });

    it('لكل نوع تسلسله المستقل، ولكل سنة بداية جديدة', async () => {
      const inv = await issue({ type: 'invoice', issueDate: '2026-08-11', lines: LINES });
      const crn = await issue({
        type: 'credit_note', issueDate: '2026-08-20', lines: LINES,
        reason: 'إلغاء', referenceNumber: inv.documentNumber,
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
});
