/**
 * ربط الفواتير القديمة بقيودها.
 *
 * Invoices issued before the two-path split carry no ledger link, so no note
 * can be raised against them. That is a migration, not a footnote — and the
 * only thing that makes an automated migration safe here is that it refuses to
 * guess: a link is adopted only when the document DECLARES it and the posting
 * lock, the entry and the total all confirm it. Everything else comes back as
 * a review row, and nothing historical is ever rewritten.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  planLegacyInvoiceLinks, runLegacyInvoiceLinks, REVIEW_REASONS, LINK_METHOD,
} from '../src/legacyLinks.js';
import { DOC_COL } from '../src/invoicing.js';
import { COL } from '../src/ledger.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let app, db;

/** A filed invoice with no ledger link, exactly as the old code left them. */
const legacyInvoice = (over = {}) => ({
  type: 'invoice', status: 'issued',
  documentNumber: 'INV-2025-000009', sequence: 9, year: 2025,
  issueDate: '2025-12-01', issueTime: '10:00:00',
  taxable: true, priceMode: 'inclusive', vatRate: 0.15,
  net: 100, vat: 15, gross: 115,
  journalEntryId: null, linkedJournalEntryId: null,
  lines: [{ description: 'غسلة', quantity: 2, unitPrice: 57.5, lineNet: 100, lineVat: 15, lineGross: 115 }],
  seller: { name: 'شركة هادي الغانم', vatNumber: '300000000000003', address: '' },
  ...over,
});

const washRow = (over = {}) => ({
  biker_name: 'أحمد', quantity: 2, price: 57.5, status: 'مكتملة',
  wash_date: '2025-12-01', payment_method: 'cash', ...over,
});

const washEntry = (id, over = {}) => ({
  entryDate: '2025-12-01', periodKey: '2025-12',
  sourceType: 'wash', sourceId: id, sourceKind: 'wash',
  description: 'غسلات', status: 'posted', reversalOf: null, entryNumber: 7,
  lines: [
    { accountId: '1010', debit: 115, credit: 0, description: 'تحصيل' },
    { accountId: '4000', debit: 0, credit: 100, description: 'إيراد' },
    { accountId: '2100', debit: 0, credit: 15, description: 'ضريبة' },
  ],
  lineCount: 3, totalDebit: 115, totalCredit: 115,
  ...over,
});

async function wipe() {
  for (const c of [DOC_COL.DOCUMENTS, DOC_COL.SOURCES, DOC_COL.AUDIT,
    COL.ENTRIES, COL.LOCKS, 'washes']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((s) => s.ref.delete()));
  }
}

/** Sets up one legacy invoice with its wash, entry and lock all in place. */
async function seedMatchedPair({ docOver = {}, washOver = {}, entryOver = {} } = {}) {
  await db.collection('washes').doc('w1').set(washRow(washOver));
  const entryRef = db.collection(COL.ENTRIES).doc('e1');
  await entryRef.set(washEntry('w1', entryOver));
  await db.collection(COL.LOCKS).doc('wash__w1').set({
    kind: 'wash', sourceType: 'wash', sourceId: 'w1', entryId: 'e1', entryNumber: 7,
  });
  const docRef = db.collection(DOC_COL.DOCUMENTS).doc('d1');
  await docRef.set(legacyInvoice({ sourceType: 'wash', sourceId: 'w1', ...docOver }));
  return { docId: docRef.id, entryId: entryRef.id };
}

// ═══ الخطة نفسها، بلا قاعدة بيانات ═════════════════════════════════════════
describe('خطة ربط الفواتير القديمة — دالة نقية', () => {
  const base = {
    documents: [{ id: 'd1', ...legacyInvoice({ sourceType: 'wash', sourceId: 'w1' }) }],
    washes: [{ id: 'w1', ...washRow() }],
    entries: [{ id: 'e1', ...washEntry('w1') }],
    locks: [{ id: 'wash__w1', entryId: 'e1', entryNumber: 7 }],
    claims: [],
  };

  it('تربط ما تعلنه الفاتورة ويؤكده القفل والقيد والمبلغ', () => {
    const plan = planLegacyInvoiceLinks(base);
    expect(plan.linkable).toHaveLength(1);
    expect(plan.review).toHaveLength(0);
    expect(plan.linkable[0]).toMatchObject({
      documentId: 'd1', washId: 'w1', entryId: 'e1', entryNumber: 7,
      entryGross: 115, supplyDate: '2025-12-01', method: LINK_METHOD,
    });
  });

  it('ولا تخمّن رابطاً لفاتورة لا تعلن مصدراً — تعرض المرشّحين فقط', () => {
    const plan = planLegacyInvoiceLinks({
      ...base,
      documents: [{ id: 'd1', ...legacyInvoice() }],   // no sourceType/sourceId
    });
    expect(plan.linkable).toHaveLength(0);
    expect(plan.review[0].reason).toBe(REVIEW_REASONS.NO_DECLARED_SOURCE);
    // The same-total entry is offered as information, never adopted.
    expect(plan.review[0].candidates).toEqual([
      { entryId: 'e1', entryNumber: 7, washId: 'w1', entryDate: '2025-12-01', gross: 115 },
    ]);
  });

  it('وترفض ما لا يطابق: سجل مفقود · بلا قفل · قيد مفقود · قيد معكوس · مبلغ مختلف', () => {
    const reasonFor = (patch) => planLegacyInvoiceLinks({ ...base, ...patch }).review[0].reason;

    expect(reasonFor({ washes: [] })).toBe(REVIEW_REASONS.WASH_MISSING);
    expect(reasonFor({ locks: [] })).toBe(REVIEW_REASONS.NOT_POSTED);
    expect(reasonFor({ entries: [] })).toBe(REVIEW_REASONS.ENTRY_MISSING);
    expect(reasonFor({ entries: [{ id: 'e1', ...washEntry('w1', { status: 'reversed' }) }] }))
      .toBe(REVIEW_REASONS.ENTRY_NOT_POSTED);
    expect(reasonFor({
      documents: [{ id: 'd1', ...legacyInvoice({ sourceType: 'wash', sourceId: 'w1', gross: 230 }) }],
    })).toBe(REVIEW_REASONS.AMOUNT_MISMATCH);
  });

  it('وترفض سجلاً مُطالَباً به من مستند آخر', () => {
    const plan = planLegacyInvoiceLinks({
      ...base,
      claims: [{ id: 'wash__w1', documentId: 'other', documentNumber: 'INV-2025-000001', status: 'held' }],
    });
    expect(plan.linkable).toHaveLength(0);
    expect(plan.review[0].reason).toBe(REVIEW_REASONS.ALREADY_CLAIMED);
    expect(plan.review[0].claimedBy).toBe('INV-2025-000001');
  });

  it('وتتجاهل ما هو مرتبط أصلاً أو ملغى', () => {
    const plan = planLegacyInvoiceLinks({
      ...base,
      documents: [
        { id: 'a', ...legacyInvoice({ linkedJournalEntryId: 'e1' }) },
        { id: 'b', ...legacyInvoice({ journalEntryId: 'x' }) },
        { id: 'c', ...legacyInvoice({ status: 'cancelled' }) },
      ],
    });
    expect(plan.candidates).toBe(0);
    expect(plan.linkable).toHaveLength(0);
    expect(plan.review).toHaveLength(0);
  });
});

// ═══ التشغيل الفعلي على المحاكي ════════════════════════════════════════════
d('ربط الفواتير القديمة على Firestore', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-sweater-legacy' }, 'legacy-test');
    db = getFirestore(app);
  }, 60_000);

  afterAll(async () => { if (app) await deleteApp(app); });

  beforeEach(async () => { await wipe(); }, 60_000);

  it('الفحص التجريبي لا يكتب شيئاً', async () => {
    const { docId } = await seedMatchedPair();
    const plan = await runLegacyInvoiceLinks(db, FieldValue, { apply: false }, { userId: 'admin1' });

    expect(plan.dryRun).toBe(true);
    expect(plan.applied).toBe(0);
    expect(plan.linkable).toHaveLength(1);

    const doc = (await db.collection(DOC_COL.DOCUMENTS).doc(docId).get()).data();
    expect(doc.linkedJournalEntryId).toBeNull();
    expect((await db.collection(DOC_COL.SOURCES).get()).size).toBe(0);
    expect((await db.collection(DOC_COL.AUDIT).get()).size).toBe(0);
  }, 60_000);

  it('والتطبيق يكتب الرابط فقط ولا يمسّ رقماً ولا تاريخاً ولا مبلغاً', async () => {
    const { docId, entryId } = await seedMatchedPair();
    const before = (await db.collection(DOC_COL.DOCUMENTS).doc(docId).get()).data();

    const plan = await runLegacyInvoiceLinks(db, FieldValue, { apply: true }, { userId: 'admin1' });
    expect(plan.applied).toBe(1);

    const after = (await db.collection(DOC_COL.DOCUMENTS).doc(docId).get()).data();
    expect(after.linkedJournalEntryId).toBe(entryId);
    expect(after.linkedJournalEntryNumber).toBe(7);
    expect(after.washId).toBe('w1');
    expect(after.issueMode).toBe('linked');
    expect(after.supplyDate).toBe('2025-12-01');
    expect(after.linkMethod).toBe(LINK_METHOD);

    // Nothing historical moved.
    for (const key of ['documentNumber', 'sequence', 'year', 'issueDate', 'issueTime',
      'net', 'vat', 'gross', 'vatRate', 'qrPayload', 'seller', 'lines']) {
      expect(after[key]).toEqual(before[key]);
    }

    // The claim is created so the wash cannot be invoiced a second time.
    const claim = (await db.collection(DOC_COL.SOURCES).doc('wash__w1').get()).data();
    expect(claim).toMatchObject({ documentId: docId, status: 'held' });
    expect((await db.collection(DOC_COL.AUDIT).where('action', '==', 'link').get()).size).toBe(1);
  }, 60_000);

  it('وهو قابل للتكرار — التشغيل الثاني لا يجد شيئاً', async () => {
    await seedMatchedPair();
    await runLegacyInvoiceLinks(db, FieldValue, { apply: true }, { userId: 'admin1' });
    const second = await runLegacyInvoiceLinks(db, FieldValue, { apply: true }, { userId: 'admin1' });
    expect(second.candidates).toBe(0);
    expect(second.applied).toBe(0);
    expect((await db.collection(DOC_COL.AUDIT).where('action', '==', 'link').get()).size).toBe(1);
  }, 90_000);

  it('والفاتورة الغامضة تبقى بلا رابط بعد التطبيق', async () => {
    await seedMatchedPair({ docOver: { sourceType: null, sourceId: null } });
    const plan = await runLegacyInvoiceLinks(db, FieldValue, { apply: true }, { userId: 'admin1' });
    expect(plan.applied).toBe(0);
    expect(plan.review).toHaveLength(1);
    const doc = (await db.collection(DOC_COL.DOCUMENTS).doc('d1').get()).data();
    expect(doc.linkedJournalEntryId).toBeNull();
  }, 60_000);
});
