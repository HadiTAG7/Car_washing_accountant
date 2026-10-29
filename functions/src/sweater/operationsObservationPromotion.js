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
const pendingSource = (prior, current) => Boolean(prior && ['washing_started', 'on_the_way'].includes(prior.normalizedStatus)
  && prior.sspBookingId && ownerBookingIdentity(prior.sspBookingId) === ownerBookingIdentity(current.sspBookingId)
  && prior.driverExternalId === current.driverExternalId && prior.serviceDate === current.serviceDate
  && prior.bookingKind === 'individual' && prior.bookingKind === current.bookingKind && prior.serviceType === current.serviceType
  && !prior.completedAt && (prior.normalizedStatus === 'washing_started'
    ? prior.startedAt === current.startedAt && Boolean(prior.startedAt) : !prior.startedAt));

// A later source observation may complete an unexecuted reservation under a
// different SSP prefix. It is NOT an owner decision or a generic merge: only
// an immutable, unexecuted source chain with the same facts qualifies. The
// natural claim anchors the FIRST observation; the booking points at the LAST.
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
    && legacy.normalizedStatus === legacy.record?.normalizedStatus && pendingSource(legacy.record, record)
    && !legacy.recognitionEligibility && !legacy.recognitionReason && !hasProtectedIdentityEffect(legacy)
    && legacy.serviceDate === record.serviceDate && legacy.periodKey === record.serviceDate.slice(0, 7)
    && legacy.operationalWorkerId === candidate && legacy.record.sspBookingId === legacy.sspBookingId
    && legacy.record.driverExternalId === record.driverExternalId && legacy.record.serviceDate === record.serviceDate
    && legacy.record.bookingKind === record.bookingKind && record.bookingKind === 'individual'
    && !legacy.record.completedAt && legacy.sourceHash === hashRecord(legacy.record)
    && claim.bookingNumber === number && claim.source === SOURCE && !hasProtectedIdentityEffect(claim)
    && claim.washId === `ssp__${legacyId}`
    && [claim.importRunId, legacy.lastImportRunId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,159}$/.test(id))
    && related.length === 1 && related[0] === legacyDoc
    && (!period || period.status === 'open') && !hasProtectedIdentityEffect(period)
    && !hasProtectedIdentityEffect(settlement)
    && !['approved', 'invoiced', 'partially_collected', 'collected', 'closed'].includes(settlement?.status);
  // Do not audit whole financial stores for ordinary or already protected rows.
  if (!basic) return null;
  const runIds = [...new Set([claim.importRunId, legacy.lastImportRunId])];
  const [history, financialSnaps] = await Promise.all([
    Promise.all(runIds.map(async runId => {
      const rawId = rawDocId(runId, legacy.sspBookingId);
      const [rawSnap, runSnap] = await Promise.all([
        read(db.collection(COL.RAW).doc(rawId)), read(db.collection(COL.RUNS).doc(runId)),
      ]);
      return { runId, rawId, raw: rawSnap.exists ? rawSnap.data() : null, run: runSnap.exists ? runSnap.data() : null };
    })),
    Promise.all(FINANCIAL_COLLECTIONS.map(collection => read(db.collection(collection).select(...REFERENCE_FIELDS)))),
  ]);
  const proofs = history.map(({ runId, rawId, raw, run }) => {
    const prior = raw?.normalizedRecord;
    const matchingRows = run?.result?.rows?.filter(row => row.sspBookingId === legacy.sspBookingId) ?? [];
    const historicalRow = matchingRows[0];
    const cut = Date.parse(run?.coverage?.extractedAt);
    return {
      rawMatches: Boolean(raw && raw.source === SOURCE && raw.importRunId === runId
        && raw.sspBookingId === legacy.sspBookingId && pendingSource(prior, record)
        && prior.sspBookingId === legacy.sspBookingId && raw.sourceHash === hashRecord(prior)
        && hashRecord(normalizeRecord(raw.rawPayload ?? {})) === raw.sourceHash && !hasProtectedIdentityEffect(raw)
        && (runId !== legacy.lastImportRunId || raw.sourceHash === legacy.sourceHash)),
      runProvesNoExecution: Boolean(run?.source === SOURCE && run.importRunId === runId
        && ['completed', 'completed_with_gaps'].includes(run.status) && matchingRows.length === 1
        && historicalRow.rawSaved && historicalRow.bookingSaved && !historicalRow.washCreated && !historicalRow.washId
        && historicalRow.bookingId === legacyId && historicalRow.bikerId === candidate
        && historicalRow.rawId === rawId && historicalRow.sourceHash === raw?.sourceHash
        && historicalRow.reasonCode === 'execution_not_final'
        && (prior?.normalizedStatus === 'washing_started' ? cut >= Date.parse(record.startedAt) : cut < Date.parse(record.startedAt))
        && cut < Date.parse(record.completedAt) && Date.parse(payload.coverage.extractedAt) > cut),
    };
  });
  const financialRefs = financialSnaps.flatMap((snap, i) => snap.docs.flatMap(d => {
    const metadata = referenceMetadata(d.data());
    return identityReference(d.id, number) || referencesThisIdentity(metadata, number)
      ? [{ collection: FINANCIAL_COLLECTIONS[i], id: d.id, hash: hashBody(metadata) }] : [];
  }));
  const checks = {
    sourceStartedIdentityMatches: Boolean(basic),
    historicalRawMatches: proofs.every(p => p.rawMatches),
    closedRunProvesNoExecution: proofs.every(p => p.runProvesNoExecution),
    claimAndLatestObservationOrdered: Date.parse(history[0].run?.coverage?.extractedAt)
      <= Date.parse(history.at(-1).run?.coverage?.extractedAt),
    noReferencedFinancialEffect: financialRefs.length === 0,
  };
  const evidenceRefs = [
    { collection: COL.BOOKINGS, id: legacyId, hash: hashBody(legacy) },
    { collection: 'sweater_owner_booking_claims', id: bookingDocId(number), hash: hashBody(claim) },
    ...history.flatMap(({ runId, rawId, raw, run }) => [
      ...(raw ? [{ collection: COL.RAW, id: rawId, hash: hashBody(raw) }] : []),
      ...(run ? [{ collection: COL.RUNS, id: runId, hash: hashBody(run) }] : []),
    ]),
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
