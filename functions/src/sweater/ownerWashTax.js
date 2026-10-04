import { OWNER_WASH_TAX_PLAN as PLAN } from '../../../src/lib/sweater/ownerWashTaxPlan.js';
import { ownerWashTaxSplit } from '../../../src/lib/sweater/ownerWashTax.js';
import { hashBody } from './record.js';
import { SweaterIngestError, bookingDocId } from './ingest.js';
import { OWNER_CONFIRMATIONS, sspWashId } from './staffHandoff.js';

const RUNS = 'sweater_owner_tax_clarifications';
const fail = message => { throw new SweaterIngestError(message, { code: 'failed-precondition' }); };
const splitFor = () => ({ source: 'owner_statement', ownerName: PLAN.ownerName, statement: PLAN.statement,
  clarificationId: PLAN.id, currency: 'SAR', priceMode: 'exclusive', quantity: 1,
  net: PLAN.net, vat: PLAN.vat, gross: PLAN.gross });

async function review(db, read) {
  const runRef = db.collection(RUNS).doc(PLAN.id); const run = await read(runRef);
  const rows = [];
  for (const [id, serviceDate] of PLAN.bookings) {
    const washRef = db.collection('washes').doc(sspWashId(id));
    const [washSnap, proofSnap, bookingSnap, periodSnap, settlementSnap, posted] = await Promise.all([
      read(washRef), read(db.collection(OWNER_CONFIRMATIONS).doc(bookingDocId(id))),
      read(db.collection('sweater_bookings').doc(bookingDocId(id))),
      read(db.collection('accounting_periods').doc(serviceDate.slice(0, 7))),
      read(db.collection('sweater_settlements').doc(serviceDate.slice(0, 7))),
      read(db.collection('journal_entries').where('sourceId', '==', sspWashId(id))),
    ]);
    const wash = washSnap.exists ? washSnap.data() : null;
    const proof = proofSnap.exists ? proofSnap.data() : null;
    const booking = bookingSnap.exists ? bookingSnap.data() : null;
    if (!wash || wash.ssp_booking_id !== id || wash.wash_date !== serviceDate || wash.quantity !== 1 || wash.price !== 20
      || wash.revenue_origin !== 'sweater' || wash.collection_status !== 'confirmed_by_owner' || wash.status !== 'مكتملة'
      || !proof || proof.assertedAmount !== 20 || proof.quantity !== 1 || proof.collectionStatus !== 'confirmed_by_owner'
      || !booking || booking.sspBookingId !== id || booking.record?.serviceDate !== serviceDate) fail('غسلة من الاثنتي عشرة لا تطابق المصدر المراجع؛ لم يتغير شيء.');
    const expected = splitFor();
    const already = hashBody(wash.owner_tax_snapshot) === hashBody(expected)
      && wash.vat_amount === 3 && wash.net_amount === 20 && wash.gross_amount === 23 && wash.price_mode === 'exclusive' && wash.vat_rate === 0.15;
    if (!already && (wash.owner_tax_snapshot != null || wash.vat_amount != null || wash.net_amount != null || wash.gross_amount != null
      || (wash.price_mode != null && wash.price_mode !== 'exclusive'))) fail('توضيح ضريبي موجود بمحتوى مختلف؛ لا يُستبدل.');
    if (!already && (periodSnap.data()?.status === 'closed' || settlementSnap.data()?.journalEntryId
      || booking.postedEntryId || booking.processingStatus === 'posted'
      || posted.docs.some(doc => ['posted', 'reversed'].includes(doc.data().status)))) fail('غسلة مرحّلة أو فترة مقفلة؛ يلزم تصحيح محاسبي منفصل.');
    if (already && !ownerWashTaxSplit({ quantity: 1, price: wash.price, ownerTaxSnapshot: wash.owner_tax_snapshot })) fail('الفصل الضريبي الموجود غير متسق.');
    rows.push({ washId: washRef.id, sspBookingId: id, serviceDate, net: 20, vat: 3, gross: 23, already,
      _wash: wash, _proof: proof, _booking: booking, _ref: washRef });
  }
  if (run.exists && (!rows.every(row => row.already) || !run.data().result)) fail('سجل التصحيح لا يطابق الغسلات الحالية.');
  return { rows, run, runRef, previewHash: hashBody(rows.map(row => ({ wash: row._wash, proof: row._proof, booking: row._booking }))) };
}
const publicResult = value => ({ clarificationId: PLAN.id, dryRun: true, saved: false, canSave: true,
  previewHash: value.previewHash, count: 12, totals: { net: 240, vat: 36, gross: 276 },
  ownerName: PLAN.ownerName, statement: PLAN.statement,
  ledgerPosted: false, invoiceIssued: false,
  rows: value.rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')))) });

export async function previewOwnerWashTax(db, data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length) fail('معاينة التصحيح ثابتة للاثنتي عشرة غسلة فقط.');
  return publicResult(await review(db, ref => ref.get()));
}

export async function saveOwnerWashTax(db, FieldValue, data, actor) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => key !== 'previewHash') || !/^[a-f0-9]{64}$/.test(data.previewHash ?? '')) fail('معاينة التصحيح نفسه مطلوبة.');
  return db.runTransaction(async tx => {
    const value = await review(db, ref => tx.get(ref));
    if (value.run.exists) return { ...value.run.data().result, replay: true };
    if (data.previewHash !== value.previewHash) fail('تغيّرت البيانات منذ المعاينة؛ أعد معاينة التصحيح.');
    const now = new Date().toISOString();
    for (const row of value.rows) {
      if (row.already) continue;
      tx.set(row._ref, { price_mode: 'exclusive', net_amount: 20, vat_amount: 3, gross_amount: 23,
        vat_rate: 0.15, owner_tax_snapshot: splitFor(), tax_clarified_by: actor, tax_clarified_at: now }, { merge: true });
    }
    const result = { ...publicResult(value), dryRun: false, saved: true, replay: false, updated: value.rows.filter(row => !row.already).length };
    tx.set(value.runRef, { id: PLAN.id, source: 'owner_statement', actor, recordedAtIso: now,
      recordedAt: FieldValue.serverTimestamp(), statement: PLAN.statement, result,
      before: value.rows.map(row => ({ washId: row.washId, vatAmount: row._wash.vat_amount ?? null, price: row._wash.price })),
      after: splitFor() });
    return result;
  });
}
