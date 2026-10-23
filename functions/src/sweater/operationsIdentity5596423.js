import { hashBody, hashRecord, normalizeRecord } from './record.js';
import { COL, rawDocId } from './ingest.js';
import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';

// Hadi's direct11Oct approval01a1299e-6982-7b80-a5bb-de93279daffe.
// NOT a generic alias resolver. No new action, credential, principal, input
// flag or collection; the original reserved claim and legacy evidence stay
// byte-for-byte unchanged. Only this one fully evidenced singleton qualifies.
const A = Object.freeze({ approvalId: '01a1299e-6982-7b80-a5bb-de93279daffe', number: '5596423',
  legacy: 'B-5596423', current: 'S-5596423', date: '2026-10-10', driver: '1986',
  worker: 'KehSV5K73zkyWWEE8hE9', legacyRun: 'ops-20261011-oct10-210648',
  wash: 'ssp__B-5596423', started: '2026-10-10T22:42:00+03:00', completed: '2026-10-10T23:35:00+03:00' });
const SOURCE = 'operations_sync_v2';
const BOOKING_KEYS = new Set(['sspBookingId', 'bookingNumber', 'record', 'sourceHash', 'schemaVersion', 'source', 'lastImportRunId',
  'serviceDate', 'periodKey', 'normalizedStatus', 'processingStatus', 'reviewReasonCode', 'recognitionEligibility',
  'recognitionReason', 'operationalWorkerId', 'updatedAtIso', 'updatedAt']);
const CLAIM_KEYS = new Set(['bookingNumber', 'sspBookingId', 'washId', 'source', 'importRunId', 'claimedBy', 'claimedAt']);
const EFFECT = /^(?:posted.*|posting.*|journal.*|ledger.*|settlement.*|financial.*|locked.*|lock|owner.*(?:confirmation|decision)|collection_confirmation|owner_confirmation)$/i;
export function hasProtectedIdentityEffect(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => (EFFECT.test(key) && Boolean(child)) || hasProtectedIdentityEffect(child));
}
export const identityReference = (value, number = A.number) => {
  if (typeof value !== 'string') return false;
  let text = value;
  try { text = decodeURIComponent(text); } catch { /* keep malformed text unmodified */ }
  // Existing link IDs wrap a booking/wash ID; the source's letter prefix is
  // not restricted to B/S/C. This recognizes protection, NEVER another grant.
  return ownerBookingIdentity(text.trim().replace(/^(?:(?:b|w|ssp)__)+/i, '')) === number;
};
const NUMERIC_REFERENCE = /^(?:ssp_?booking_?(?:id|number)|booking_?(?:id|number)|wash_?id|source_?id|reversed_?source_?id)$/i;
export const referenceMetadata = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) throw new Error('Unsupported cyclic identity metadata');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    if (typeof value.path === 'string') return { documentReferencePath: value.path, documentReference: value.path.split('/').at(-1) };
    if (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') return { seconds: value.seconds, nanoseconds: value.nanoseconds };
    if (value instanceof Date) return value.toISOString();
    throw new Error('Unsupported identity metadata');
  }
  seen.add(value);
  const out = Array.isArray(value) ? value.map(child => referenceMetadata(child, seen))
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, referenceMetadata(child, seen)]));
  seen.delete(value); return out;
};
export const referencesThisIdentity = (value, number = A.number) => {
  if (typeof value === 'string') return identityReference(value, number);
  return Boolean(value && typeof value === 'object' && Object.entries(value).some(([key, child]) =>
    (NUMERIC_REFERENCE.test(key) && typeof child === 'number' && String(child) === number) || referencesThisIdentity(child, number)));
};
// Source metadata only: no balances, amounts, customer/worker names or whole
// financial rows. Firestore cannot filter an arbitrary source-prefix suffix.
// This one approved singleton therefore audits the existing identifier columns
// server-side, then retains ONLY references to this natural identity in CAS.
// An in(B,S) probe cannot prove absence of a C/other-prefix orphaned journal.
export const REFERENCE_FIELDS = ['sourceId', 'source_id', 'reversedSourceId', 'sourceRef', 'source_ref',
  'sspBookingId', 'ssp_booking_id', 'sspBookingNumber', 'ssp_booking_number',
  'bookingId', 'booking_id', 'bookingNumber', 'booking_number', 'washId', 'wash_id',
  'record.sspBookingId', 'record.ssp_booking_id', 'evidence.sspBookingId', 'evidence.ssp_booking_id',
  'source.sspBookingId', 'source.bookingNumber', 'source.booking_number', 'source.ref.sspBookingId', 'source.ref.ssp_booking_id'];
export const FINANCIAL_COLLECTIONS = ['journal_entries', 'posting_locks', 'transactions', 'sweater_collections', 'sweater_adjustments'];
const allowedKeys = (value, keys) => Boolean(value && Object.keys(value).every(key => keys.has(key)));

export async function inspectIdentity5596423({ db, read, payload, record, documents, naturallyRelated, claim, candidate, established, execution, period, settlement }) {
  if (record.sspBookingId !== A.current) return null;
  const legacyDoc = documents.find(d => d.collection === COL.BOOKINGS && d.id === A.legacy);
  const legacy = legacyDoc?.data;
  const historicalRawId = rawDocId(A.legacyRun, A.legacy);
  const rawSnap = await read(db.collection(COL.RAW).doc(historicalRawId));
  const oldRaw = rawSnap.exists ? rawSnap.data() : null;
  const approvedScope = payload.records.length === 1 && payload.coverage.recordCount === 1
    && payload.coverage.rangeFrom === A.date && payload.coverage.rangeTo === A.date
    && record.serviceDate === A.date && record.driverExternalId === A.driver
    && record.bookingKind === 'individual' && record.serviceType === 'interior_exterior_wash'
    && record.startedAt === A.started && record.completedAt === A.completed && execution.eligible
    && established && candidate === A.worker;
  // Preserve ALL naturally related rows already established by the planner,
  // including arbitrary prefixes. Also reject malformed/orphan link IDs and
  // nested owner references that the legacy top-level matcher cannot inspect.
  const related = documents.filter(d => naturallyRelated.includes(d) || identityReference(d.id) || referencesThisIdentity(referenceMetadata(d.data)));
  const financialSnaps = approvedScope ? await Promise.all(FINANCIAL_COLLECTIONS.map(collection =>
    read(db.collection(collection).select(...REFERENCE_FIELDS)))) : [];
  const financialRefs = financialSnaps.flatMap((snap, i) => snap.docs.flatMap(d => {
    const metadata = referenceMetadata(d.data());
    const periodReference = metadata.sourceId === '2026-10' || metadata.reversedSourceId === '2026-10';
    return identityReference(d.id) || referencesThisIdentity(metadata) || periodReference
      ? [{ collection: FINANCIAL_COLLECTIONS[i], id: d.id, hash: hashBody(metadata) }] : [];
  }));
  const checks = {
    approvedSingleton: payload.records.length === 1 && payload.coverage.recordCount === 1
      && payload.coverage.rangeFrom === A.date && payload.coverage.rangeTo === A.date,
    currentEvidenceMatches: record.serviceDate === A.date && record.driverExternalId === A.driver
      && record.bookingKind === 'individual' && record.serviceType === 'interior_exterior_wash'
      && record.startedAt === A.started && record.completedAt === A.completed && execution.eligible,
    establishedWorkerMatches: established && candidate === A.worker,
    legacyRawOnly: allowedKeys(legacy, BOOKING_KEYS) && legacy.sspBookingId === A.legacy
      && legacy.bookingNumber === A.number && legacy.source === SOURCE && legacy.schemaVersion === 1
      && legacy.lastImportRunId === A.legacyRun && legacy.serviceDate === A.date && legacy.periodKey === '2026-10'
      && legacy.processingStatus === 'needs_review' && legacy.reviewReasonCode === 'unknown_service_type'
      && legacy.recognitionEligibility === null && legacy.recognitionReason === null && legacy.operationalWorkerId === null
      && legacy.record?.sspBookingId === A.legacy && legacy.record.serviceDate === A.date
      && legacy.record.driverExternalId === A.driver && legacy.record.bookingKind === 'individual'
      && legacy.record.rawStatus === 'completed' && legacy.record.normalizedStatus === 'unknown'
      && legacy.normalizedStatus === legacy.record.normalizedStatus && !legacy.record.serviceType
      && !legacy.record.startedAt && !legacy.record.completedAt && !hasProtectedIdentityEffect(legacy)
      && legacy.sourceHash === hashRecord(legacy.record),
    historicalRawMatches: Boolean(oldRaw && oldRaw.source === SOURCE && oldRaw.importRunId === A.legacyRun
      && oldRaw.sspBookingId === A.legacy && oldRaw.sourceHash === legacy?.sourceHash
      && hashRecord(oldRaw.normalizedRecord) === legacy?.sourceHash
      && hashRecord(normalizeRecord(oldRaw.rawPayload ?? {})) === legacy?.sourceHash
      && !hasProtectedIdentityEffect(oldRaw)),
    reservedClaimMatches: allowedKeys(claim, CLAIM_KEYS) && claim.bookingNumber === A.number
      && claim.sspBookingId === A.legacy && claim.washId === A.wash && claim.source === SOURCE
      && claim.importRunId === A.legacyRun && !hasProtectedIdentityEffect(claim),
    noRelatedWashOwnerOrLink: related.length === 1 && related[0] === legacyDoc,
    financialIdentityAuditComplete: Boolean(approvedScope),
    noReferencedFinancialEffect: Boolean(approvedScope) && financialRefs.length === 0,
    periodAndSettlementOpen: (!period || period.status === 'open') && !hasProtectedIdentityEffect(period)
      && !hasProtectedIdentityEffect(settlement)
      && !['approved', 'invoiced', 'partially_collected', 'collected', 'closed'].includes(settlement?.status),
  };
  const eligible = Object.values(checks).every(Boolean);
  const evidenceRefs = [
    ...(legacyDoc ? [{ collection: COL.BOOKINGS, id: A.legacy, hash: hashBody(legacy) }] : []),
    ...(oldRaw ? [{ collection: COL.RAW, id: historicalRawId, hash: hashBody(oldRaw) }] : []),
    ...(claim ? [{ collection: 'sweater_owner_booking_claims', id: A.number, hash: hashBody(claim) }] : []),
  ];
  return { public: { approvalId: A.approvalId, bookingNumber: A.number, legacyBookingId: A.legacy,
    currentBookingId: A.current, canonicalWashId: A.wash, eligible, checks,
    reasonCode: eligible ? null : 'identity_resolution_guard_failed', claimPreserved: true, resolutionSaved: false,
    evidenceRefs },
  state: { financialRefs, related: related.map(d => ({ collection: d.collection, id: d.id, hash: hashBody(referenceMetadata(d.data)) })), evidenceRefs, checks } };
}

export function preservedResolutionClaimMatches(row, claim) {
  const resolution = row.identityResolution;
  const evidence = resolution?.evidenceRefs?.find(ref => ref.collection === 'sweater_owner_booking_claims');
  return Boolean(resolution?.eligible && resolution.resolutionSaved && resolution.approvalId === A.approvalId
    && row.sspBookingId === A.current && row.bookingNumber === A.number && row.washId === A.wash
    && claim?.sspBookingId === A.legacy && claim.washId === A.wash && claim.source === SOURCE
    && evidence?.hash === hashBody(claim));
}
