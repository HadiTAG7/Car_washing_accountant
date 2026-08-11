/**
 * اختبارات الإصدار على محاكي Firestore — the transactional numbering layer.
 *
 * The unit suite proves the invoice ARITHMETIC and the QR encoding. These
 * prove what only a real database can: that two devices issuing at the same
 * instant cannot receive the same invoice number, that a source record can
 * produce exactly one invoice however many times the button is pressed, and
 * that an issued document is voided rather than removed.
 *
 * Run: npm run test:emulator — which passes `--no-file-parallelism`. Both
 * emulator suites share ONE database and each wipes its collections between
 * tests, so running them concurrently lets one suite's reset clear the other
 * suite's counter mid-flight and fake a duplicate-numbering failure.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  connectFirestoreEmulator, collection, doc, getDoc, getDocs, deleteDoc, terminate,
} from 'firebase/firestore';

import { useServerTransport } from './_serverTransport';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let restoreTransport;
let db, inv, pure;

const SELLER = { name: 'شركة هادي الغانم', vatNumber: '300000000000003', address: 'الرياض', vatRegistered: true };
const LINES = [{ description: 'غسلة خارجية', quantity: 2, unitPrice: 57.5 }];

async function wipe() {
  for (const c of ['sales_documents', 'sales_document_sources', 'counters', 'audit_logs', 'app_settings']) {
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
    inv  = await import('../firestoreInvoicing');
    pure = await import('../invoicing');
  }, 60_000);

  afterAll(async () => {
    if (restoreTransport) await restoreTransport();
    if (db) await terminate(db);
  });

  beforeEach(async () => {
    await wipe();
    await inv.saveSellerProfile(SELLER, { userId: 'u1' });
  }, 30_000);

  it('يحفظ هوية المنشأة ويقرأها كما هي', async () => {
    const p = await inv.fetchSellerProfile();
    expect(p).toMatchObject({ name: SELLER.name, vatNumber: SELLER.vatNumber, vatRegistered: true });
  }, 60_000);

  it('يصدر فاتورة مرقّمة تحمل رمز QR صالحاً', async () => {
    const res = await inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '14:30:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w1',
    }, { userId: 'u1' });

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
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '09:00:00', lines: LINES,
      sourceType: 'wash', sourceId: `w${i}`,
    }, { userId: 'u1' })));

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
    const first = await inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '09:00:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w-dup',
    }, { userId: 'u1' });

    await expect(inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '09:05:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w-dup',
    }, { userId: 'u1' })).rejects.toThrow(/سبق إصدار مستند/);

    // Exactly one document, and the counter did not advance past it.
    const docs = await inv.fetchDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].documentNumber).toBe(first.documentNumber);
  }, 90_000);

  it('لكل نوع مستند تسلسله المستقل', async () => {
    const invoice = await inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '09:00:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w1',
    }, { userId: 'u1' });

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
    const invoice = await inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '09:00:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w1',
    }, { userId: 'u1' });
    await inv.issueCreditNoteFor(invoice.id, { issueDate: '2026-08-20', reason: 'إلغاء' }, { userId: 'u1' });

    const docs = await inv.fetchDocuments();
    const netVat = docs.reduce((s, x) => s + x.vat * pure.documentSign(x.type), 0);
    const netGross = docs.reduce((s, x) => s + x.gross * pure.documentSign(x.type), 0);
    expect(netVat).toBe(0);
    expect(netGross).toBe(0);
  }, 90_000);

  it('لا يصدر إشعار مقابل إشعار', async () => {
    const invoice = await inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '09:00:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w1',
    }, { userId: 'u1' });
    const credit = await inv.issueCreditNoteFor(invoice.id, { issueDate: '2026-08-20', reason: 'إلغاء' }, { userId: 'u1' });
    await expect(inv.issueCreditNoteFor(credit.id, { issueDate: '2026-08-22', reason: 'مرة أخرى' }))
      .rejects.toThrow(/فاتورة فقط/);
  }, 90_000);

  it('يرفض الإصدار برقم ضريبي غير صالح قبل أن يمسّ العدّاد', async () => {
    await inv.saveSellerProfile({ ...SELLER, vatNumber: '999' }, { userId: 'u1' });
    await expect(inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '09:00:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w1',
    }, { userId: 'u1' })).rejects.toThrow(/الرقم الضريبي/);

    expect((await getDocs(collection(db, 'sales_documents'))).size).toBe(0);
    expect((await getDoc(doc(db, 'counters', 'documents-invoice-2026'))).exists()).toBe(false);
  }, 90_000);

  it('منشأة غير مسجّلة في الضريبة تصدر مستنداً بلا ضريبة وبلا رمز', async () => {
    await inv.saveSellerProfile({ name: 'مغسلة', vatNumber: '', vatRegistered: false }, { userId: 'u1' });
    const res = await inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '09:00:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w1',
    }, { userId: 'u1' });
    const saved = await inv.fetchDocument(res.id);
    expect(saved.vat).toBe(0);
    expect(saved.gross).toBe(115);
    expect(saved.qrPayload).toBeNull();
  }, 90_000);

  it('المستند الصادر يُلغى بسبب ولا يُحذف', async () => {
    const invoice = await inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '09:00:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w1',
    }, { userId: 'u1' });

    await expect(inv.voidDocument(invoice.id, { reason: '' })).rejects.toThrow(/سبب/);
    await inv.voidDocument(invoice.id, { reason: 'صدرت بالخطأ', userId: 'u1' });

    const saved = await inv.fetchDocument(invoice.id);
    expect(saved).not.toBeNull();                 // still there — the number is spoken for
    expect(saved.status).toBe('cancelled');
    expect(saved.voidReason).toBe('صدرت بالخطأ');
    await expect(inv.voidDocument(invoice.id, { reason: 'مرة أخرى' })).rejects.toThrow(/ملغى بالفعل/);
  }, 90_000);

  it('كل إصدار وإلغاء يترك أثراً في سجل التدقيق', async () => {
    const invoice = await inv.issueSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '09:00:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w1',
    }, { userId: 'u1' });
    await inv.voidDocument(invoice.id, { reason: 'خطأ', userId: 'u1' });

    const logs = (await getDocs(collection(db, 'audit_logs'))).docs.map((s) => s.data());
    expect(logs.filter((l) => l.action === 'issue')).toHaveLength(1);
    expect(logs.filter((l) => l.action === 'void')).toHaveLength(1);
  }, 90_000);

  it('السنة تفصل التسلسل — 2027 تبدأ من واحد', async () => {
    await inv.issueSimplifiedInvoice({
      issueDate: '2026-12-31', issueTime: '23:00:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w-2026',
    }, { userId: 'u1' });
    const next = await inv.issueSimplifiedInvoice({
      issueDate: '2027-01-01', issueTime: '08:00:00', lines: LINES,
      sourceType: 'wash', sourceId: 'w-2027',
    }, { userId: 'u1' });
    expect(next.documentNumber).toBe('INV-2027-000001');
  }, 90_000);
});
