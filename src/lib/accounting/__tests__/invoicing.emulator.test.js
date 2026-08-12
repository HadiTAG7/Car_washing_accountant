/**
 * اختبارات الإصدار على محاكي Firestore — the transactional numbering layer.
 *
 * The unit suite proves the invoice ARITHMETIC and the QR encoding. These
 * prove what only a real database can: that two devices issuing at the same
 * instant cannot receive the same invoice number, that a source record can
 * produce exactly one invoice however many times the button is pressed, that
 * an issued document is voided rather than removed — and that the two issuing
 * paths behave differently in the one way that matters: a standalone sale
 * posts its own entry, an invoice for a posted wash posts nothing.
 *
 * Run: npm run test:emulator — which passes `--no-file-parallelism`. Both
 * emulator suites share ONE database and each wipes its collections between
 * tests, so running them concurrently lets one suite's reset clear the other
 * suite's counter mid-flight and fake a duplicate-numbering failure.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc, deleteDoc, terminate,
} from 'firebase/firestore';

import { useServerTransport } from './_serverTransport';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let restoreTransport;
let db, inv, pure, ledger;

const SELLER = { name: 'شركة هادي الغانم', vatNumber: '300000000000003', address: 'الرياض', vatRegistered: true };
const LINES = [{ description: 'غسلة خارجية', quantity: 2, unitPrice: 57.5 }];

/** A standalone sale — no wash behind it, so the settlement is required. */
const sale = (over = {}) => inv.issueSimplifiedInvoice({
  issueDate: '2026-08-11', issueTime: '09:00:00', lines: LINES,
  paymentMethod: 'cash', paymentStatus: 'paid', ...over,
}, { userId: 'u1' });

/** A wash actually carried into the books, through the ledger's own path. */
async function postedWash(id, over = {}) {
  await setDoc(doc(db, 'washes', id), {
    biker_name: 'أحمد', quantity: 2, price: 57.5, status: 'مكتملة',
    wash_date: '2026-08-11', payment_method: 'cash', ...over,
  });
  return ledger.postSource('wash', id);
}

async function wipe() {
  for (const c of ['sales_documents', 'sales_document_sources', 'counters', 'audit_logs',
    'app_settings', 'chart_of_accounts', 'journal_entries', 'journal_lines',
    'accounting_periods', 'posting_locks', 'washes']) {
    const snap = await getDocs(collection(db, c));
    await Promise.all(snap.docs.map((s) => deleteDoc(s.ref)));
  }
}

d('إصدار المستندات على Firestore الحقيقي', () => {
  beforeAll(async () => {
    const client = await import('../../firebaseClient');
    db = client.db;
    const [host, port] = EMU.split(':');
    connectFirestoreEmulator(db, host, Number(port));
    // Issuing runs on the server now — the app calls it as a Cloud Function,
    // which a test cannot.
    restoreTransport = useServerTransport();
    inv    = await import('../firestoreInvoicing');
    pure   = await import('../invoicing');
    ledger = await import('../firestoreLedger');
  }, 60_000);

  afterAll(async () => {
    if (restoreTransport) await restoreTransport();
    if (db) await terminate(db);
  });

  beforeEach(async () => {
    await wipe();
    // A standalone invoice posts a sales entry, so the chart has to exist
    // before anything can be issued.
    await ledger.seedChartOfAccounts({ userId: 'u1' });
    await inv.saveSellerProfile(SELLER, { userId: 'u1' });
  }, 60_000);

  it('يحفظ هوية المنشأة ويقرأها كما هي', async () => {
    const p = await inv.fetchSellerProfile();
    expect(p).toMatchObject({ name: SELLER.name, vatNumber: SELLER.vatNumber, vatRegistered: true });
  }, 60_000);

  it('يصدر فاتورة مرقّمة تحمل رمز QR صالحاً', async () => {
    const res = await sale();

    expect(res.documentNumber).toBe('INV-2026-000001');

    const saved = await inv.fetchDocument(res.id);
    expect(saved.status).toBe('issued');
    expect(saved.gross).toBe(115);
    expect(saved.vat).toBe(15);
    // The document says plainly that nobody reported it.
    expect(saved.zatcaReported).toBe(false);

    const decoded = pure.decodeZatcaQrPayload(saved.qrPayload);
    expect(decoded[2]).toBe(SELLER.vatNumber);
    expect(decoded[4]).toBe('115.00');
    expect(decoded[5]).toBe('15.00');
  }, 60_000);

  it('أرقام الفواتير فريدة ومتصلة تحت التزامن', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => sale({
      sourceType: 'counter', sourceId: `s${i}`,
    })));

    const seqs = results.map((r) => r.sequence).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(8);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(results.map((r) => r.documentNumber)).size).toBe(8);

    // And the same conclusion read back off the database, the way an auditor
    // would check it.
    const gaps = inv.sequenceGaps(await inv.fetchDocuments());
    expect(gaps).toEqual([{ series: 'invoice-2026', count: 8, missing: [], duplicates: [] }]);
  }, 120_000);

  it('لا تُصدَر فاتورتان لنفس السجل مهما تكرّر الضغط', async () => {
    const first = await sale({ sourceType: 'counter', sourceId: 's-dup' });

    await expect(sale({ issueTime: '09:05:00', sourceType: 'counter', sourceId: 's-dup' }))
      .rejects.toThrow(/سبق إصدار مستند/);

    // Exactly one document, and the counter did not advance past it.
    const docs = await inv.fetchDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].documentNumber).toBe(first.documentNumber);
  }, 90_000);

  it('لكل نوع مستند تسلسله المستقل', async () => {
    const invoice = await sale();

    const credit = await inv.issueCreditNoteFor(invoice.id, {
      issueDate: '2026-08-20', issueTime: '11:00:00', reason: 'إلغاء الغسلة',
    }, { userId: 'u1' });
    const debit = await inv.issueDebitNoteFor(invoice.id, {
      issueDate: '2026-08-21', issueTime: '11:00:00', reason: 'فرق سعر',
      lines: [{ description: 'فرق', quantity: 1, unitPrice: 23 }],
    }, { userId: 'u1' });

    expect(invoice.documentNumber).toBe('INV-2026-000001');
    expect(credit.documentNumber).toBe('CRN-2026-000001');
    expect(debit.documentNumber).toBe('DBN-2026-000001');

    const saved = await inv.fetchDocument(credit.id);
    expect(saved.referenceNumber).toBe(invoice.documentNumber);
    expect(saved.reason).toBe('إلغاء الغسلة');
    // A note must not carry the invoice's source claim, or the claim that
    // stops a duplicate invoice would also stop the note that corrects it.
    expect(saved.sourceId).toBeNull();

    const notes = await inv.fetchNotesFor(invoice.documentNumber);
    expect(notes.map((n) => n.type).sort()).toEqual(['credit_note', 'debit_note']);
  }, 120_000);

  it('الإشعار الدائن الكامل يصفّر أثر الفاتورة', async () => {
    const invoice = await sale();
    await inv.issueCreditNoteFor(invoice.id, { issueDate: '2026-08-20', reason: 'إلغاء' }, { userId: 'u1' });

    const docs = await inv.fetchDocuments();
    const netVat = docs.reduce((s, x) => s + x.vat * pure.documentSign(x.type), 0);
    const netGross = docs.reduce((s, x) => s + x.gross * pure.documentSign(x.type), 0);
    expect(netVat).toBe(0);
    expect(netGross).toBe(0);
  }, 90_000);

  it('لا يصدر إشعار مقابل إشعار', async () => {
    const invoice = await sale();
    const credit = await inv.issueCreditNoteFor(invoice.id, { issueDate: '2026-08-20', reason: 'إلغاء' }, { userId: 'u1' });
    await expect(inv.issueCreditNoteFor(credit.id, { issueDate: '2026-08-22', reason: 'مرة أخرى' }))
      .rejects.toThrow(/فاتورة فقط/);
  }, 90_000);

  it('يرفض الإصدار برقم ضريبي غير صالح قبل أن يمسّ العدّاد', async () => {
    await inv.saveSellerProfile({ ...SELLER, vatNumber: '999' }, { userId: 'u1' });
    await expect(sale()).rejects.toThrow(/الرقم الضريبي/);

    expect((await getDocs(collection(db, 'sales_documents'))).size).toBe(0);
    expect((await getDoc(doc(db, 'counters', 'documents-invoice-2026'))).exists()).toBe(false);
  }, 90_000);

  it('منشأة غير مسجّلة في الضريبة تصدر مستنداً بلا ضريبة وبلا رمز', async () => {
    await inv.saveSellerProfile({ name: 'مغسلة', vatNumber: '', vatRegistered: false }, { userId: 'u1' });
    const res = await sale();
    const saved = await inv.fetchDocument(res.id);
    expect(saved.vat).toBe(0);
    expect(saved.gross).toBe(115);
    expect(saved.qrPayload).toBeNull();
  }, 90_000);

  it('المستند الصادر يُلغى بسبب ولا يُحذف', async () => {
    const invoice = await sale();

    await expect(inv.voidDocument(invoice.id, { reason: '' })).rejects.toThrow(/سبب/);
    await inv.voidDocument(invoice.id, {
      reason: 'صدرت بالخطأ', reversalDate: '2026-08-25', userId: 'u1',
    });

    const saved = await inv.fetchDocument(invoice.id);
    expect(saved).not.toBeNull();                 // still there — the number is spoken for
    expect(saved.status).toBe('cancelled');
    expect(saved.voidReason).toBe('صدرت بالخطأ');
    await expect(inv.voidDocument(invoice.id, { reason: 'مرة أخرى', reversalDate: '2026-08-26' }))
      .rejects.toThrow(/ملغى بالفعل/);
  }, 90_000);

  it('كل إصدار وإلغاء يترك أثراً في سجل التدقيق', async () => {
    const invoice = await sale();
    await inv.voidDocument(invoice.id, { reason: 'خطأ', reversalDate: '2026-08-25', userId: 'u1' });

    const logs = (await getDocs(collection(db, 'audit_logs'))).docs.map((s) => s.data());
    expect(logs.filter((l) => l.action === 'issue')).toHaveLength(1);
    expect(logs.filter((l) => l.action === 'void')).toHaveLength(1);
  }, 90_000);

  it('السنة تفصل التسلسل — 2027 تبدأ من واحد', async () => {
    await sale({ issueDate: '2026-12-31', issueTime: '23:00:00', sourceType: 'counter', sourceId: 's-2026' });
    const next = await sale({
      issueDate: '2027-01-01', issueTime: '08:00:00', sourceType: 'counter', sourceId: 's-2027',
    });
    expect(next.documentNumber).toBe('INV-2027-000001');
  }, 90_000);

  // ═══════════════════════════════════════════════════════════════════════
  // المساران، من مسار العميل
  // ═══════════════════════════════════════════════════════════════════════
  describe('مسارا الإصدار', () => {
    it('الفاتورة المستقلة تُرحّل بيعها، وفاتورة الغسلة لا تُرحّل شيئاً', async () => {
      // (أ) standalone: the invoice IS the sale, so it posts.
      const standalone = await sale();
      expect(standalone.journalEntryId).toBeTruthy();
      let entries = await ledger.fetchEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].sourceType).toBe('sales_invoice');

      // (ب) linked: the wash's entry already holds that revenue.
      const posted = await postedWash('w1');
      entries = await ledger.fetchEntries();
      expect(entries).toHaveLength(2);

      const linked = await inv.issueInvoiceForWash('w1', { issueTime: '10:00:00' });
      expect(linked.journalEntryId).toBeNull();
      expect(linked.linkedJournalEntryId).toBe(posted.entryId);
      expect(linked.gross).toBe(115);

      // Still two entries — the invoice added none.
      expect(await ledger.fetchEntries()).toHaveLength(2);

      const saved = await inv.fetchDocument(linked.id);
      expect(saved.issueMode).toBe('linked');
      expect(saved.washId).toBe('w1');
      expect(saved.issueDate).toBe('2026-08-11');
    }, 120_000);

    it('لا تُصدَر فاتورة لغسلة غير مُرحّلة', async () => {
      await setDoc(doc(db, 'washes', 'w-unposted'), {
        biker_name: 'س', quantity: 1, price: 115, status: 'مكتملة',
        wash_date: '2026-08-12', payment_method: 'cash',
      });
      await expect(inv.issueInvoiceForWash('w-unposted'))
        .rejects.toThrow(/غير مُرحّلة إلى الدفاتر/);
      expect(await inv.fetchDocuments()).toHaveLength(0);
    }, 90_000);

    it('لا يُصدَر إشعار على فاتورة بلا أثر محاسبي', async () => {
      // A paper-only invoice, exactly as the old code left every one of them.
      const orphan = doc(collection(db, 'sales_documents'));
      await setDoc(orphan, {
        type: 'invoice', status: 'issued', documentNumber: 'INV-2025-000009',
        sequence: 9, year: 2025, issueDate: '2025-12-01', taxable: true,
        priceMode: 'inclusive', vatRate: 0.15, net: 100, vat: 15, gross: 115,
        journalEntryId: null, linkedJournalEntryId: null,
        lines: [{ description: 'غسلة', quantity: 2, unitPrice: 57.5, lineNet: 100, lineVat: 15, lineGross: 115 }],
        seller: { name: SELLER.name, vatNumber: SELLER.vatNumber, address: '' },
      });
      await expect(inv.issueCreditNoteFor(orphan.id, {
        issueDate: '2026-08-20', reason: 'إرجاع',
      })).rejects.toThrow(/بلا قيد في الدفاتر/);
      // No entry, so no negative revenue was invented.
      expect(await ledger.fetchEntries()).toHaveLength(0);
    }, 90_000);
  });
});
