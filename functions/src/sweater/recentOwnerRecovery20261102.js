import scope from './recentOwnerRecovery20261102.json' with { type: 'json' };
import { isRecentOwnerRecoveryDecision } from '../../../src/lib/sweater/administrativeCompletion.js';
import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';
import { hashBody, hashRecord, normalizeRecord } from './record.js';
import { COL, bookingDocId, sspWashDocId, rawDocId } from './ingest.js';
import { hasProtectedIdentityEffect, identityReference, referencesThisIdentity, referenceMetadata, FINANCIAL_COLLECTIONS, REFERENCE_FIELDS } from './operationsIdentity5596423.js';

export const RECENT_OWNER_RECOVERY_CASE = scope.caseId;
export function retainedRecoveryBookingHash(booking) {
  return hashBody(Object.fromEntries(Object.entries(booking).filter(([key]) => !['ownerCompletionDecision','administrativeCompletionRunId','updatedAt','updatedAtIso'].includes(key))));
}
const CLAIMS = 'sweater_owner_booking_claims';
const CLAIM_KEYS = new Set(['bookingNumber','sspBookingId','washId','source','importRunId','claimedBy','claimedAt']);
const BOOKING_KEYS = new Set(['sspBookingId','bookingNumber','aliases','mergedFrom','identityCleanup','record','sourceHash','schemaVersion','source','lastImportRunId',
  'observedAtIso','serviceDate','periodKey','normalizedStatus','processingStatus','reviewReasonCode','recognitionEligibility','recognitionReason','operationalWorkerId','updatedAtIso','updatedAt']);
const recordKeys = new Set(['sspBookingId','serviceDate','driverExternalId','rawStatus','startedAt','completedAt','sourceUrl','bookingKind','serviceType']);
const exact = (value, keys) => Boolean(value && Object.keys(value).every(key => keys.has(key)));
export const naturallyReferencesRecovery = (doc, number) => identityReference(doc.id, number) || referencesThisIdentity(referenceMetadata(doc.data), number);

export function approvedRecentRecoveryRow(payload, raw) {
  const cut = Date.parse(payload.coverage?.extractedAt);
  if (!isRecentOwnerRecoveryDecision(payload) || payload.decision.statement !== scope.authority.statement
    || !Number.isFinite(cut) || cut < Date.parse(scope.sourceCut) || cut > Date.now() || !exact(raw, recordKeys)) return null;
  const row = scope.rows.find(row => row.record.sspBookingId === raw.sspBookingId);
  return row && Object.entries(row.record).every(([key,value]) => raw[key] === value)
    && payload.workerLinks?.[raw.driverExternalId] === row.workerId ? row : null;
}

export async function readRecentRecoveryProtection(db, read) {
  const [claims, ...financial] = await Promise.all([
    read(db.collection(CLAIMS)),
    ...FINANCIAL_COLLECTIONS.map(name => {
      const query = db.collection(name);
      return read(typeof query.select === 'function' ? query.select(...REFERENCE_FIELDS) : query);
    }),
  ]);
  return {
    claims: claims.docs.map(doc => ({id:doc.id,data:doc.data()})),
    financial: financial.flatMap((snap,index) => snap.docs.map(doc => ({collection:FINANCIAL_COLLECTIONS[index],id:doc.id,data:referenceMetadata(doc.data())}))),
  };
}

// The owner's new decision supplies completion/attribution. Original raw rows,
// claim, source dates, worker assignments and batch cuts remain untouched. The
// historical receipts still must prove no application wash was created.
export async function inspectRecentOwnerRecovery({ db, read, approved, bookingDoc, related, claim, protection }) {
  const number = approved.bookingNumber, booking = bookingDoc?.data;
  const claims = protection.claims.filter(doc => naturallyReferencesRecovery(doc, number));
  const financial = protection.financial.filter(doc => naturallyReferencesRecovery(doc, number));
  const aliasesMatch = ['aliases','mergedFrom'].every(key => booking?.[key] == null
    || (Array.isArray(booking[key]) && booking[key].every(value => typeof value === 'string' && ownerBookingIdentity(value) === number)));
  const checks = {
    oneOriginalClaim: claims.length === 1 && claims[0].id === bookingDocId(number) && exact(claim,CLAIM_KEYS)
      && claim.source === 'operations_sync_v2' && claim.bookingNumber === number && ownerBookingIdentity(claim.sspBookingId) === number
      && claim.washId === sspWashDocId(claim.sspBookingId) && !hasProtectedIdentityEffect(claim),
    oneUnexecutedSourceBooking: related.length === 1 && related[0] === bookingDoc && exact(booking,BOOKING_KEYS) && aliasesMatch
      && booking.source === 'operations_sync_v2' && booking.schemaVersion === 1 && !hasProtectedIdentityEffect(booking)
      && ['needs_review','pending_source'].includes(booking.processingStatus) && !booking.recognitionEligibility && !booking.recognitionReason
      && ownerBookingIdentity(booking.sspBookingId) === number && booking.record?.sspBookingId === booking.sspBookingId
      && booking.sourceHash === hashRecord(booking.record) && typeof booking.record.serviceDate === 'string' && booking.serviceDate === booking.record.serviceDate
      && booking.periodKey === booking.record.serviceDate.slice(0,7),
    noReferencedFinancialEffect: financial.length === 0,
  };
  const history = [];
  if (checks.oneOriginalClaim && checks.oneUnexecutedSourceBooking) {
    const refs = [{runId:claim.importRunId,sspBookingId:claim.sspBookingId},{runId:booking.lastImportRunId,sspBookingId:booking.record.sspBookingId}];
    for (const ref of refs.filter((value,index,all) => all.findIndex(other => other.runId === value.runId && other.sspBookingId === value.sspBookingId) === index)) {
      if (!/^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,159}$/.test(ref.runId || '')) { history.push({valid:false}); continue; }
      const rawId = rawDocId(ref.runId,ref.sspBookingId);
      const [sourceSnap,runSnap] = await Promise.all([read(db.collection(COL.RAW).doc(rawId)),read(db.collection(COL.RUNS).doc(ref.runId))]);
      const source = sourceSnap.data(), run = runSnap.data();
      const prior = source?.normalizedRecord, matches = run?.result?.rows?.filter(row => row.sspBookingId === ref.sspBookingId) || [], row = matches[0];
      const valid = Boolean(source && run && prior && source.source === 'operations_sync_v2' && run.source === 'operations_sync_v2'
        && source.importRunId === ref.runId && run.importRunId === ref.runId && source.sspBookingId === ref.sspBookingId
        && prior.sspBookingId === ref.sspBookingId && ownerBookingIdentity(prior.sspBookingId) === number
        && source.sourceHash === hashRecord(prior) && hashRecord(normalizeRecord(source.rawPayload || {})) === source.sourceHash
        && !hasProtectedIdentityEffect(source) && ['completed','completed_with_gaps'].includes(run.status) && matches.length === 1
        && row.rawSaved === true && row.bookingSaved === true && row.washCreated === false && !row.washId
        && row.rawId === rawId && row.sourceHash === source.sourceHash && row.driverExternalId === prior.driverExternalId
        && [bookingDocId(number),ref.sspBookingId].includes(row.bookingId)
        && (ref.runId !== booking.lastImportRunId || ref.sspBookingId !== booking.record.sspBookingId || source.sourceHash === booking.sourceHash));
      history.push({valid,runId:ref.runId,sspBookingId:ref.sspBookingId,rawId,sourceServiceDate:prior?.serviceDate ?? null,sourceHash:source ? hashBody(source) : null,runHash:run ? hashBody(run) : null});
    }
  }
  checks.closedReceiptsCreatedNoAppWash = history.length > 0 && history.every(item => item.valid);
  const originalPeriods = [...new Set([booking?.record?.serviceDate,...history.map(item => item.sourceServiceDate)]
    .filter(day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)).map(day => day.slice(0,7)))]
    .filter(period => period !== approved.record.serviceDate.slice(0,7));
  const periodEvidence = [];
  for (const period of originalPeriods) {
    const [periodSnap,settlementSnap] = await Promise.all([read(db.collection('accounting_periods').doc(period)),read(db.collection('sweater_settlements').doc(period))]);
    const periodRow=periodSnap.data(),settlement=settlementSnap.data();
    periodEvidence.push({period,periodHash:hashBody(periodRow || null),settlementHash:hashBody(settlement || null),
      unprotected:(!periodSnap.exists || periodRow?.status === 'open') && !hasProtectedIdentityEffect(periodRow) && !hasProtectedIdentityEffect(settlement)
        && !['approved','invoiced','partially_collected','collected','closed'].includes(settlement?.status)});
  }
  checks.originalSourcePeriodsUnprotected = periodEvidence.every(item => item.unprotected);
  const proof = { caseId:scope.caseId, basis:'owner_administrative_decision',
    claim:claim ? {id:bookingDocId(number),sspBookingId:claim.sspBookingId,washId:claim.washId,hash:hashBody(claim)} : null,
    booking:bookingDoc ? {id:bookingDoc.id,hash:hashBody(bookingDoc.data),retainedHash:retainedRecoveryBookingHash(bookingDoc.data)} : null,
    sourceObservation:{detailReadAt:approved.detailReadAt,timePrecision:approved.timePrecision,sourceCut:scope.sourceCut},
    history, originalPeriods:periodEvidence, checks, eligible:Object.values(checks).every(Boolean) };
  return proof;
}

export function isSavedRecentRecovery(payload, row) {
  return Boolean(isRecentOwnerRecoveryDecision(payload) && row?.sourceRecovery?.caseId === scope.caseId && approvedRecentRecoveryRow(payload,payload.records.find(r => r.sspBookingId === row.sspBookingId)));
}
