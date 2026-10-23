import { hashBody, hashRecord, normalizeRecord } from './record.js';
import { bookingDocId, rawDocId, COL } from './ingest.js';
import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';
import { hasProtectedIdentityEffect, identityReference, referencesThisIdentity, referenceMetadata,
  REFERENCE_FIELDS, FINANCIAL_COLLECTIONS } from './operationsIdentity5596423.js';

const SOURCE = 'operations_sync_v2';
const KIND = 'source_execution_promotion_v1';
const BOOKING_KEYS = new Set(['sspBookingId', 'bookingNumber', 'record', 'sourceHash', 'schemaVersion', 'source', 'lastImportRunId',
  'serviceDate', 'periodKey', 'normalizedStatus', 'processingStatus', 'reviewReasonCode', 'recognitionEligibility',
  'recognitionReason', 'operationalWorkerId', 'updatedAtIso', 'updatedAt']);
const CLAIM_KEYS = new Set(['bookingNumber', 'sspBookingId', 'washId', 'source', 'importRunId', 'claimedBy', 'claimedAt']);
const exactKeys = (row, allowed) => Boolean(row && Object.keys(row).every(key => allowed.has(key)));

// A later source observation may complete an unexecuted reservation under a
// different SSP prefix. It is NOT an owner decision or a generic merge: only
// an immutable, previously started execution with the same facts qualifies.
export async function inspectObservationPromotion({ db, read, payload, record, documents, claim, candidate,
  established, execution, period, settlement }) {
  const number = ownerBookingIdentity(record.sspBookingId);
  if (!/^\d+$/.test(number) || !claim || claim.sspBookingId === record.sspBookingId) return null;
  const legacyId = bookingDocId(claim.sspBookingId);
  const legacyDoc = documents.find(d => d.collection === COL.BOOKINGS && d.id === legacyId);
  const legacy = legacyDoc?.data;
  const related = documents.filter(d => identityReference(d.id, number) || referencesThisIdentity(referenceMetadata(d.data), number));
  const basic = execution.eligible && established && exactKeys(legacy, BOOKING_KEYS) && exactKeys(claim, CLAIM_KEYS)
    && legacy.sspBookingId === claim.sspBookingId && ownerBookingIdentity(legacy.sspBookingId) === number
    && legacy.bookingNumber === number && legacy.source === SOURCE && legacy.schemaVersion === 1
    && legacy.processingStatus === 'needs_review' && legacy.reviewReasonCode === 'execution_not_final'
    && legacy.normalizedStatus === 'washing_started' && legacy.record?.normalizedStatus === 'washing_started'
    && !legacy.recognitionEligibility && !legacy.recognitionReason && !hasProtectedIdentityEffect(legacy)
    && legacy.serviceDate === record.serviceDate && legacy.periodKey === record.serviceDate.slice(0, 7)
    && legacy.operationalWorkerId === candidate && legacy.record.sspBookingId === legacy.sspBookingId
    && legacy.record.driverExternalId === record.driverExternalId && legacy.record.serviceDate === record.serviceDate
    && legacy.record.bookingKind === record.bookingKind && record.bookingKind === 'individual'
    && legacy.record.serviceType === record.serviceType && legacy.record.startedAt === record.startedAt
    && !legacy.record.completedAt && legacy.sourceHash === hashRecord(legacy.record)
    && claim.bookingNumber === number && claim.source === SOURCE && !hasProtectedIdentityEffect(claim)
    && claim.washId === `ssp__${legacyId}` && claim.importRunId === legacy.lastImportRunId
    && related.length === 1 && related[0] === legacyDoc
    && (!period || period.status === 'open') && !hasProtectedIdentityEffect(period)
    && !hasProtectedIdentityEffect(settlement)
    && !['approved', 'invoiced', 'partially_collected', 'collected', 'closed'].includes(settlement?.status);
  // Do not audit whole financial stores for ordinary or already protected rows.
  if (!basic) return null;
  const historicalRawId = rawDocId(legacy.lastImportRunId, legacy.sspBookingId);
  const [rawSnap, runSnap, ...financialSnaps] = await Promise.all([
    read(db.collection(COL.RAW).doc(historicalRawId)), read(db.collection(COL.RUNS).doc(legacy.lastImportRunId)),
    ...FINANCIAL_COLLECTIONS.map(collection => read(db.collection(collection).select(...REFERENCE_FIELDS))),
  ]);
  const raw = rawSnap.exists ? rawSnap.data() : null;
  const run = runSnap.exists ? runSnap.data() : null;
  const historicalRow = run?.result?.rows?.find(row => row.sspBookingId === legacy.sspBookingId);
  const financialRefs = financialSnaps.flatMap((snap, i) => snap.docs.flatMap(d => {
    const metadata = referenceMetadata(d.data());
    return identityReference(d.id, number) || referencesThisIdentity(metadata, number)
      ? [{ collection: FINANCIAL_COLLECTIONS[i], id: d.id, hash: hashBody(metadata) }] : [];
  }));
  const checks = {
    sourceStartedIdentityMatches: Boolean(basic),
    historicalRawMatches: Boolean(raw && raw.source === SOURCE && raw.importRunId === legacy.lastImportRunId
      && raw.sspBookingId === legacy.sspBookingId && raw.sourceHash === legacy.sourceHash
      && hashRecord(raw.normalizedRecord) === legacy.sourceHash
      && hashRecord(normalizeRecord(raw.rawPayload ?? {})) === legacy.sourceHash && !hasProtectedIdentityEffect(raw)),
    closedRunProvesNoExecution: Boolean(run?.source === SOURCE && ['completed', 'completed_with_gaps'].includes(run.status)
      && historicalRow?.rawSaved && historicalRow.bookingSaved && !historicalRow.washCreated && !historicalRow.washId
      && historicalRow.rawId === historicalRawId && historicalRow.sourceHash === legacy.sourceHash
      && historicalRow.reasonCode === 'execution_not_final'
      && Date.parse(run.coverage?.extractedAt) >= Date.parse(record.startedAt)
      && Date.parse(run.coverage?.extractedAt) < Date.parse(record.completedAt)
      && Date.parse(payload.coverage.extractedAt) > Date.parse(run.coverage?.extractedAt)),
    noReferencedFinancialEffect: financialRefs.length === 0,
  };
  const evidenceRefs = [
    { collection: COL.BOOKINGS, id: legacyId, hash: hashBody(legacy) },
    { collection: 'sweater_owner_booking_claims', id: bookingDocId(number), hash: hashBody(claim) },
    ...(raw ? [{ collection: COL.RAW, id: historicalRawId, hash: hashBody(raw) }] : []),
    ...(run ? [{ collection: COL.RUNS, id: legacy.lastImportRunId, hash: hashBody(run) }] : []),
  ];
  return { public: { kind: KIND, bookingNumber: number, legacyBookingId: legacy.sspBookingId,
    currentBookingId: record.sspBookingId, canonicalWashId: claim.washId, eligible: Object.values(checks).every(Boolean),
    checks, claimPreserved: true, promotionSaved: false, evidenceRefs }, state: { checks, evidenceRefs, financialRefs } };
}

export function preservedPromotionClaimMatches(row, claim) {
  const promotion = row.observationPromotion;
  const ref = promotion?.evidenceRefs?.find(r => r.collection === 'sweater_owner_booking_claims');
  return Boolean(promotion?.kind === KIND && promotion.eligible && promotion.promotionSaved
    && promotion.bookingNumber === row.bookingNumber && promotion.currentBookingId === row.sspBookingId
    && promotion.legacyBookingId === claim?.sspBookingId && promotion.canonicalWashId === row.washId
    && claim?.source === SOURCE && claim.washId === row.washId && ref?.hash === hashBody(claim));
}
