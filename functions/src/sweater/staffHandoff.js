import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';
import { ownerConfirmationTaxSplit } from '../../../src/lib/sweater/ownerConfirmation.js';
import { WASH_COMMISSION_RATE } from '../washCommission.js';
import { reviewSweaterHandoff, ownerHandoffCoverageComplete } from '../../../src/lib/sweater/handoff.js';
import { bookingDocId, rawDocId, classifyRecord, COL, SweaterIngestError } from './ingest.js';
import { hashBody, hashRecord, normalizeRecord, SCHEMA_VERSION } from './record.js';
import { LINKS_COL } from './revenueOrigin.js';

export const OWNER_CONFIRMATIONS = 'sweater_owner_collection_confirmations';
export const OWNER_BOOKING_CLAIMS = 'sweater_owner_booking_claims';
export const OPERATIONAL_LINKS = 'sweater_operational_wash_links';
export const sspWashId = id => `ssp__${bookingDocId(id)}`;
const fail = (message, code = 'failed-precondition') => { throw new SweaterIngestError(message, { code }); };

function reviewedInput(payload) {
  const review = reviewSweaterHandoff(payload);
  if (!review.ready || !review.payload.ownerConfirmation || !ownerHandoffCoverageComplete(review.payload.coverage)) {
    fail('الحفظ يحتاج ملفاً صالحاً بتغطية كاملة للنطاق المعلن وإقرار مالك مستقل.', 'invalid-argument');
  }
  // At most eight writes per booking plus run/state stay below 500 writes.
  if (review.payload.records.length > 50) fail('حد الحفظ الذري ٥٠ غسلة؛ قسّم الدفعة.', 'invalid-argument');
  return review.payload;
}

const evidenceFor = (input, record) => ({
  sspBookingId: record.sspBookingId, serviceDate: record.serviceDate,
  driverExternalId: record.driverExternalId, quantity: 1,
  source: 'owner_statement', ownerName: input.ownerConfirmation.ownerName.trim(),
  statement: input.ownerConfirmation.statement.trim(),
  assertedAmount: input.ownerConfirmation.unitAmount, currency: 'SAR', vatAmount: input.ownerConfirmation.vatAmount,
  ...(input.ownerConfirmation.vatAmount !== null ? { taxSplit: ownerConfirmationTaxSplit(input.ownerConfirmation, `owner-handoff:${record.sspBookingId}`) } : {}),
  collectionStatus: 'confirmed_by_owner', paymentMethod: null, bankAccountId: null,
  // Preserve this instruction without accruing/paying payroll in the import.
  workerCommission: { unitAmount: WASH_COMMISSION_RATE, currency: 'SAR', paymentTiming: 'payroll', paid: false },
});

async function plan(db, input, read) {
  const runRef = db.collection(COL.RUNS).doc(input.importRunId);
  const runSnap = await read(runRef);
  const run = runSnap.exists ? runSnap.data() : null;
  const reviewedPayloadHash = hashBody(input);
  if (run && (run.bodyHash !== hashBody(input.records)
    || (run.handoffHash && run.handoffHash !== reviewedPayloadHash))) fail('معرّف الدفعة مستخدم بمحتوى مختلف.', 'already-exists');
  if (run && run.source !== 'staff_owner_confirmation') fail('معرّف الدفعة مستخدم في مسار آخر؛ استخدم معرّفاً جديداً.', 'already-exists');

  // Inspect older records once: they predate numeric claims and must not be
  // duplicated or rewritten when the displayed prefix changes.
  const legacyCollections = ['washes', COL.BOOKINGS, OWNER_CONFIRMATIONS, OPERATIONAL_LINKS, LINKS_COL];
  const legacySnaps = await Promise.all(legacyCollections.map(name => read(db.collection(name))));
  const legacyIds = legacySnaps.flatMap((snap, index) => snap.docs.flatMap(doc => {
    const data = doc.data();
    const id = data.ssp_booking_id || data.sspBookingId || data.record?.sspBookingId;
    return id ? [{ id, collection: legacyCollections[index], docId: doc.id }] : [];
  }));
  const rows = [];
  const counts = { new: 0, modified: 0, duplicate: 0, rejected: 0, needsReview: 0 };
  for (const raw of input.records) {
    const record = normalizeRecord(raw);
    const sourceHash = hashRecord(record);
    const id = bookingDocId(record.sspBookingId);
    const bookingRef = db.collection(COL.BOOKINGS).doc(id);
    const identity = ownerBookingIdentity(record.sspBookingId);
    const claimRef = db.collection(OWNER_BOOKING_CLAIMS).doc(bookingDocId(identity));
    const claimSnap = await read(claimRef);
    const claim = claimSnap.exists ? claimSnap.data() : null;
    const aliases = legacyIds.filter(row => ownerBookingIdentity(row.id) === identity && row.id !== record.sspBookingId);
    aliases.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const evidenceRef = db.collection(OWNER_CONFIRMATIONS).doc(id);
    const washId = sspWashId(record.sspBookingId);
    const washRef = db.collection('washes').doc(washId);
    const bikerId = input.workerLinks[record.driverExternalId];
    const bikerRef = db.collection('bikers').doc(bikerId);
    // Financial legacy links mean "already posted via wash" in settlement.
    // Keep operational links separate so importing a wash never claims that.
    const bookingLinkRef = db.collection(OPERATIONAL_LINKS).doc(`b__${id}`);
    const washLinkRef = db.collection(OPERATIONAL_LINKS).doc(`w__${encodeURIComponent(washId)}`);
    const [bookingSnap, evidenceSnap, washSnap, bikerSnap, bookingLinkSnap, washLinkSnap, otherWashes, financialLinkSnap] = await Promise.all([
      read(bookingRef), read(evidenceRef), read(washRef), read(bikerRef), read(bookingLinkRef), read(washLinkRef),
      read(db.collection('washes').where('ssp_booking_id', '==', record.sspBookingId)),
      read(db.collection(LINKS_COL).doc(`b__${id}`)),
    ]);
    const existing = bookingSnap.exists ? bookingSnap.data() : null;
    const existingEvidence = evidenceSnap.exists ? evidenceSnap.data() : null;
    const evidence = evidenceFor(input, record);
    const evidenceHash = hashBody(evidence);
    const bikerName = bikerSnap.exists ? String(bikerSnap.data().name ?? '').trim() : '';
    const wash = { ssp_booking_id: record.sspBookingId, biker_id: bikerId, biker_name: bikerName,
      driver_external_id: record.driverExternalId, quantity: 1, price: evidence.assertedAmount,
      status: 'مكتملة', wash_date: record.serviceDate, payment_method: null,
      revenue_origin: 'sweater', vat_amount: evidence.vatAmount, price_basis: 'owner_statement',
      ...(evidence.taxSplit ? { price_mode: 'exclusive', net_amount: evidence.taxSplit.net, gross_amount: evidence.taxSplit.gross,
        vat_rate: evidence.taxSplit.vat / evidence.taxSplit.net, owner_tax_snapshot: evidence.taxSplit } : {}),
      collection_status: 'confirmed_by_owner', worker_commission_per_wash: WASH_COMMISSION_RATE,
      worker_commission_payment_timing: 'payroll', worker_commission_paid: false };
    const washHash = hashBody(wash);
    let verdict = classifyRecord(record, sourceHash, existing);
    if (existingEvidence && (existingEvidence.evidenceHash !== evidenceHash || existingEvidence.sourceHash !== sourceHash)) {
      verdict = { outcome: 'needs_review', reasonCode: 'owner_confirmation_conflict', reasonAr: 'للحجز إقرار محفوظ بمحتوى مختلف؛ لا يُستبدل.' };
    }
    if (existingEvidence && !existing) verdict = { outcome: 'needs_review', reasonCode: 'orphan_confirmation', reasonAr: 'إقرار دون حجز؛ يحتاج مراجعة.' };
    if (!bikerName) verdict = { outcome: 'needs_review', reasonCode: 'missing_worker', reasonAr: 'سجل العامل الداخلي غير موجود أو بلا اسم؛ لا يُنشأ عامل افتراضي.' };
    if ((washSnap.exists && (washSnap.data().handoffWashHash !== washHash
      || Object.entries(wash).some(([key, expected]) => hashBody(washSnap.data()[key]) !== hashBody(expected))))
      || otherWashes.docs.some(doc => doc.id !== washId)
      || financialLinkSnap.exists
      || (bookingLinkSnap.exists && bookingLinkSnap.data().washId !== washId)
      || (washLinkSnap.exists && washLinkSnap.data().sspBookingId !== record.sspBookingId)) {
      verdict = { outcome: 'needs_review', reasonCode: 'wash_link_conflict', reasonAr: 'غسلة أو ربط موجود للحجز بمحتوى مختلف؛ لا تُنشأ غسلة ثانية ولا يُستبدل الموجود.' };
    }
    if (aliases.length || (claim && (claim.sspBookingId !== record.sspBookingId || claim.washId !== washId))) {
      verdict = { outcome: 'needs_review', reasonCode: 'booking_number_conflict', reasonAr: 'الرقم الأساسي للحجز موجود ببادئة أخرى أو ربط مختلف؛ لا تُنشأ غسلة ثانية.' };
    }
    const key = verdict.outcome === 'needs_review' ? 'needsReview' : verdict.outcome;
    counts[key] += 1;
    rows.push({ sspBookingId: record.sspBookingId, ...verdict,
      collectionStatus: 'confirmed_by_owner', assertedAmount: evidence.assertedAmount,
      vatAmount: evidence.vatAmount, ...(evidence.taxSplit ? { netAmount: evidence.taxSplit.net, grossAmount: evidence.taxSplit.gross, ownerTaxSnapshot: evidence.taxSplit } : {}), quantity: 1, driverExternalId: record.driverExternalId,
      bikerId, bikerName, washId, workerCommission: WASH_COMMISSION_RATE,
      serviceDate: record.serviceDate, rawStatus: record.rawStatus,
      normalizedStatus: record.normalizedStatus, paymentStatus: record.paymentStatus,
      ownerConfirmationOutcome: existingEvidence ? 'duplicate' : 'new',
      _claimRef: claimRef, _claim: claim, _identity: identity, _aliases: aliases,
      _record: record, _sourceHash: sourceHash, _evidence: evidence, _evidenceHash: evidenceHash,
      _existing: existing, _existingEvidence: existingEvidence, _bookingRef: bookingRef, _evidenceRef: evidenceRef,
      _wash: wash, _washHash: washHash, _washRef: washRef, _existingWash: washSnap.exists ? washSnap.data() : null,
      _bikerName: bikerName, _bookingLinkRef: bookingLinkRef, _washLinkRef: washLinkRef,
      _bookingLink: bookingLinkSnap.exists ? bookingLinkSnap.data() : null,
      _washLink: washLinkSnap.exists ? washLinkSnap.data() : null,
      _otherWashIds: otherWashes.docs.map(doc => doc.id).sort(),
      _financialLink: financialLinkSnap.exists ? financialLinkSnap.data() : null,
    });
  }
  const previewStateHash = hashBody(rows.map(row => ({
    id: row.sspBookingId, existingSourceHash: row._existing?.sourceHash ?? null,
    postedEntryId: row._existing?.postedEntryId ?? null,
    processingStatus: row._existing?.processingStatus ?? null,
    evidenceHash: row._existingEvidence?.evidenceHash ?? null,
    evidenceSourceHash: row._existingEvidence?.sourceHash ?? null,
    wash: row._existingWash, bikerName: row._bikerName,
    bookingLink: row._bookingLink, washLink: row._washLink, otherWashIds: row._otherWashIds,
    financialLink: row._financialLink, identityClaim: row._claim, aliases: row._aliases,
  })));
  return { input, run, runRef, rows, counts, reviewedPayloadHash, previewStateHash };
}

const publicResult = value => ({
  importRunId: value.input.importRunId, dryRun: true, replay: false,
  reviewedPayloadHash: value.reviewedPayloadHash, previewStateHash: value.previewStateHash,
  counts: value.counts, coverage: value.input.coverage, coverageIssues: [],
  reviewWarnings: reviewSweaterHandoff(value.input).warnings, statusReviewRows: [],
  canSave: value.counts.needsReview === 0 && value.counts.rejected === 0,
  ownerConfirmation: value.input.ownerConfirmation,
  rows: value.rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')))),
});

export async function previewOwnerHandoff(db, payload) {
  const input = reviewedInput(payload);
  const value = await plan(db, input, ref => ref.get());
  return { ...publicResult(value), previousRun: value.run ? { sameRecords: true, status: value.run.status } : null };
}

// One transaction claims the batch and the natural booking/evidence IDs.
// This path intentionally never imports a ledger, pricing or payroll writer.
export async function saveOwnerHandoff(db, FieldValue, data, actor) {
  if (!data || Object.keys(data).some(key => !['payload', 'reviewedPayloadHash', 'previewStateHash'].includes(key))) fail('حقول طلب الحفظ غير مسموحة.', 'invalid-argument');
  const input = reviewedInput(data.payload);
  if (data.reviewedPayloadHash !== hashBody(input) || !/^[a-f0-9]{64}$/.test(data.previewStateHash ?? '')) fail('معاينة الدفعة نفسها مطلوبة قبل الحفظ.', 'invalid-argument');
  return db.runTransaction(async tx => {
    const value = await plan(db, input, ref => tx.get(ref));
    if (value.run) {
      if (!['completed', 'completed_with_gaps'].includes(value.run.status) || !value.run.result) fail('دفعة سابقة غير مكتملة؛ تحتاج مراجعة.');
      return { ...value.run.result, replay: true };
    }
    if (value.counts.needsReview || value.counts.rejected) fail('تعارض في الحجوزات أو الإقرار؛ أعد المراجعة دون استبدال البيانات.');
    if (value.previewStateHash !== data.previewStateHash) fail('تغيّرت البيانات منذ المعاينة؛ أعد المعاينة قبل الحفظ.');
    const now = new Date().toISOString();
    for (const row of value.rows) {
      if (!row._claim && !row._existingWash) tx.set(row._claimRef, { bookingNumber: row._identity, sspBookingId: row.sspBookingId, washId: row.washId,
        importRunId: input.importRunId, claimedBy: actor, claimedAt: FieldValue.serverTimestamp() });
      if (!row._existingWash) tx.set(row._washRef, { ...row._wash, handoffWashHash: row._washHash,
        created_at: now, import_run_id: input.importRunId, created_by: actor });
      const link = { washId: row.washId, sspBookingId: row.sspBookingId, linkedBy: actor,
        linkedAt: FieldValue.serverTimestamp(), linkedAtIso: now };
      if (!row._bookingLink) tx.set(row._bookingLinkRef, { ...link, side: 'booking' });
      if (!row._washLink) tx.set(row._washLinkRef, { ...link, side: 'wash' });
      if (row.outcome !== 'duplicate') {
        tx.set(db.collection(COL.RAW).doc(rawDocId(input.importRunId, row.sspBookingId)), {
          importRunId: input.importRunId, sspBookingId: row.sspBookingId, source: 'staff_owner_confirmation',
          actor, rawPayload: row._record, sourceHash: row._sourceHash, schemaVersion: SCHEMA_VERSION,
          fetchedAt: FieldValue.serverTimestamp(), fetchedAtIso: now, processingStatus: 'normalized',
        });
        tx.set(row._bookingRef, {
          sspBookingId: row.sspBookingId, record: row._record, sourceHash: row._sourceHash,
          schemaVersion: SCHEMA_VERSION, source: 'staff_owner_confirmation', lastImportRunId: input.importRunId,
          serviceDate: row.serviceDate, periodKey: row.serviceDate.slice(0, 7),
          normalizedStatus: row.normalizedStatus, processingStatus: 'validated',
          recognitionEligibility: null, recognitionReason: null,
          updatedAt: FieldValue.serverTimestamp(), updatedAtIso: now,
        }, { merge: true });
      }
      if (!row._existingEvidence) {
        tx.set(row._evidenceRef, { ...row._evidence, sourceHash: row._sourceHash, evidenceHash: row._evidenceHash,
          importRunId: input.importRunId, recordedBy: actor,
          recordedAt: FieldValue.serverTimestamp(), recordedAtIso: now });
        tx.set(row._bookingRef, {
          ownerCollectionConfirmation: { ...row._evidence, confirmationId: bookingDocId(row.sspBookingId), recordedBy: actor, recordedAtIso: now },
        }, { merge: true });
      }
    }
    const result = { ...publicResult(value), dryRun: false, replay: false, saved: true,
      bookingIds: value.rows.map(row => row.sspBookingId), confirmationIds: value.rows.map(row => bookingDocId(row.sspBookingId)),
      washIds: value.rows.map(row => row.washId),
      ledgerPosted: false, payrollPaid: false };
    tx.set(value.runRef, {
      importRunId: input.importRunId, bodyHash: hashBody(input.records), handoffHash: value.reviewedPayloadHash,
      source: 'staff_owner_confirmation', actor, status: input.coverage.isComplete ? 'completed' : 'completed_with_gaps', coverage: input.coverage,
      ownerConfirmation: input.ownerConfirmation, recordCount: input.records.length,
      startedAt: FieldValue.serverTimestamp(), startedAtIso: now, finishedAtIso: now, result,
    });
    tx.set(db.collection(COL.STATE).doc('current'), { lastRunId: input.importRunId, lastSuccessAtIso: now,
      lastSuccessAt: FieldValue.serverTimestamp(), lastAgentStatus: 'ok', lastCoverage: input.coverage,
      lastCounts: value.counts, source: 'staff_owner_confirmation' }, { merge: true });
    return result;
  });
}
