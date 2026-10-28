import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';
import { bookingDocId, rawDocId, COL } from './ingest.js';
import { hashBody, hashRecord, normalizeRecord } from './record.js';
import { executionWash } from './operationsExecution.js';

const MAX_READBACK_ROWS = 10000;
const numberOf = row => ownerBookingIdentity(row.ssp_booking_id || row.sspBookingId || row.bookingNumber || '');
const same = (a, b) => a !== undefined && b !== undefined && hashBody(a) === hashBody(b);
const problemLabels = {
  oneWash: 'عدد الغسلات أو هويتها لا يطابق.', oneClaim: 'ربط الحجز مفقود أو مكرر.',
  claimMatches: 'ربط الحجز يشير إلى غسلة مختلفة.', sourceEvidence: 'دليل المصدر المحفوظ لا يطابق الملف.',
  decisionMatches: 'قرار المالك الحالي لا يطابق سجل الحفظ.', washFacts: 'تغيرت حقائق الغسلة منذ تسجيلها.',
  commissionUnpaid: 'حالة العمولة أو قيمتها تختلف عن وقت التسجيل.', noCollection: 'حالة التحصيل الحالية تختلف عن التسجيل.',
};

/** Called only inside an authenticated, read-only replay transaction. A saved
 * receipt is not proof that its current claim/wash/commission still matches. */
export async function administrativeCompletionReadback(db, tx, payload, run) {
  const [washSnapshot, claimSnapshot] = await Promise.all([
    tx.get(db.collection('washes').limit(MAX_READBACK_ROWS + 1)),
    tx.get(db.collection('sweater_owner_booking_claims').limit(MAX_READBACK_ROWS + 1)),
  ]);
  const washCoverage = washSnapshot.size <= MAX_READBACK_ROWS, claimCoverage = claimSnapshot.size <= MAX_READBACK_ROWS;
  const rows = [];
  for (const raw of payload.records) {
    const record = normalizeRecord(raw), bookingNumber = ownerBookingIdentity(record.sspBookingId);
    const washId = `ssp__${bookingDocId(record.sspBookingId)}`, bikerId = payload.workerLinks[record.driverExternalId];
    const [booking, source] = await Promise.all([
      tx.get(db.collection(COL.BOOKINGS).doc(bookingDocId(record.sspBookingId))),
      tx.get(db.collection(COL.RAW).doc(rawDocId(payload.importRunId, record.sspBookingId))),
    ]);
    const matchingWashes = washSnapshot.docs.filter(doc => numberOf(doc.data()) === bookingNumber);
    const matchingClaims = claimSnapshot.docs.filter(doc => numberOf(doc.data()) === bookingNumber);
    const wash = matchingWashes.find(doc => doc.id === washId)?.data(), claimDoc = matchingClaims.find(doc => doc.id === bookingDocId(bookingNumber));
    const claim = claimDoc?.data(), b = booking.data(), original = source.data();
    const savedRow = (Array.isArray(run.result?.rows) ? run.result.rows : []).find(row => row.sspBookingId === record.sspBookingId);
    const decision = { ...payload.decision, sspBookingId: record.sspBookingId, bookingNumber,
      driverExternalId: record.driverExternalId, rawStatus: record.rawStatus };
    const expected = { ...executionWash(record, bikerId, savedRow?.bikerName || ''), ssp_booking_number: bookingNumber,
      ssp_raw_status: record.rawStatus, owner_completion_decision: decision, completion_basis: 'owner_administrative_decision' };
    const checks = {
      oneWash: washCoverage && matchingWashes.length === 1 && Boolean(wash),
      oneClaim: claimCoverage && matchingClaims.length === 1 && Boolean(claim),
      claimMatches: Boolean(claim && claim.washId === washId && claim.sspBookingId === record.sspBookingId && ownerBookingIdentity(claim.bookingNumber) === bookingNumber),
      sourceEvidence: Boolean(original?.normalizedRecord && original.rawPayload && original.sourceHash === hashRecord(record)
        && hashRecord(original.normalizedRecord) === hashRecord(record) && same(original.rawPayload, raw)),
      decisionMatches: Boolean(wash && b && same(wash.owner_completion_decision, decision)
        && same(b.ownerCompletionDecision, decision) && b.administrativeCompletionRunId === payload.importRunId),
      washFacts: Boolean(wash && wash.administrativeWashHash === hashBody(expected) && wash.import_run_id === payload.importRunId
        && Object.entries(expected).every(([key, value]) => same(wash[key], value))),
      commissionUnpaid: Boolean(wash && wash.quantity === 1 && wash.worker_commission_per_wash === expected.worker_commission_per_wash
        && wash.worker_commission_paid === false && wash.worker_commission_payment_timing === 'payroll'),
      noCollection: Boolean(wash && wash.collection_status === 'pending' && wash.payment_method === null),
    };
    rows.push({ sspBookingId: record.sspBookingId, bookingNumber, washId, bikerId, driverExternalId: record.driverExternalId,
      serviceDate: record.serviceDate, verified: Object.values(checks).every(Boolean), checks,
      issues: Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => problemLabels[key]),
      washCount: washCoverage ? matchingWashes.length : null, claimCount: claimCoverage ? matchingClaims.length : null,
      claimSource: claim?.source ?? null, claimImportRunId: claim?.importRunId ?? null,
      originalSource: { rawStatus: original?.normalizedRecord?.rawStatus ?? null, startedAt: original?.normalizedRecord?.startedAt ?? null,
        completedAt: original?.normalizedRecord?.completedAt ?? null, sourceHash: original?.sourceHash ?? null },
      currentSource: { rawStatus: b?.record?.rawStatus ?? null, startedAt: b?.record?.startedAt ?? null, completedAt: b?.record?.completedAt ?? null },
      commission: { amountPerWash: wash?.worker_commission_per_wash ?? null, paid: typeof wash?.worker_commission_paid === 'boolean' ? wash.worker_commission_paid : null,
        paymentTiming: wash?.worker_commission_payment_timing ?? null, basis: 'one_wash_attribute_not_a_separate_payment' },
      expectedWashHash: hashBody(expected), actualWashHash: wash?.administrativeWashHash ?? null });
  }
  return { readOnly: true, checkedAt: new Date().toISOString(),
    status: !washCoverage || !claimCoverage ? 'unavailable' : rows.every(row => row.verified) ? 'verified' : 'mismatch',
    coverage: { complete: washCoverage && claimCoverage, washCoverage, claimCoverage, maximumRowsPerCollection: MAX_READBACK_ROWS },
    matched: rows.filter(row => row.verified).length, total: rows.length, rows };
}
