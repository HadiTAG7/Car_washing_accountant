import { hashBody, hashRecord, normalizeRecord } from './record.js';
import { COL, rawDocId } from './ingest.js';
import { identityReference, referencesThisIdentity, referenceMetadata, hasProtectedIdentityEffect,
  REFERENCE_FIELDS, FINANCIAL_COLLECTIONS } from './operationsIdentity5596423.js';

// One reviewed owner condition, satisfied by Operations on26Oct. This is NOT
// a client-supplied override or proof that the20Oct worker link existed then.
const A = Object.freeze({ number: '5643311', legacy: 'B-5643311', current: 'S-5643311', date: '2026-10-20',
  driver: '2007', worker: 'mjIi1UW9FlKYmomXxgJE', sourceName: 'Mohammed Amit (2007)', wash: 'ssp__B-5643311',
  legacyRun: 'ops-20261020-oct20-2200-190721', laterRun: 'ops-20261023-late-oct19-20-192552',
  legacyHash: 'e8dd1ce16d18f68fdfae0c474a539eb7117d03c260aba77719331c3b4651a7a5',
  laterHash: 'f704c743244a126e288878e9eeeb145c3863bb22027649d3af3acc1879c2a4ac',
  sourceObservedAt: '2026-10-25T21:32:18.355Z', started: '2026-10-20T21:18:00+03:00', completed: '2026-10-20T22:10:00+03:00' });
const SOURCE = 'operations_sync_v2';
const KIND = 'owner_conditioned_historical_identity_5643311_v1';
const ACCEPTANCE = Object.freeze({ ownerMessageId: '01a17505-ddc8-7571-ada7-2010c7df4937',
  ownerConversationId: '01a126e4-caa2-7a10-bfba-75f13e104eb3',
  condition: 'full_normalized_phone_match', conditionMet: true, verifiedBy: 'operations_4',
  sourceReadAt: '2026-10-25T21:47:29.121Z', internalReadAt: '2026-10-25T21:48:15.147Z',
  sourceExternalId: A.driver, internalWorkerId: A.worker, acceptedSourceName: A.sourceName,
  evidenceFile: 'outputs/operations-20261026/identity-5643311-phone-match.json',
  evidenceHash: 'b48b329faabf8bc8c5b75cd2b504df24fe6413ea09e0afaa68c9b9ed4eac500f',
  sourceEvidenceHash: 'd308b01e11020124bef8933c757718e34c299463ed08ca548b2fa2f6c1d75368',
  serviceClarificationId: 'msg_01a12984-cc77-71d1-8234-eef017d37229',
  serviceClarificationConversationId: '019ff1c9-38ba-7212-8f1a-f26709c33b99',
  serviceClarificationAt: '2026-10-11T05:52:11.383Z', timeZone: 'Asia/Riyadh', timestampPrecision: 'minute',
  bookingObservedAt: A.sourceObservedAt, historicalWorkerLinkAsserted: false, employeeRename: false });

// Reviewed evidence is fixed on the server; never accept phoneMatch or owner
// approval fields from the signed client's body as a substitute for it.
export const acceptedHistoricalIdentity5643311 = value => hashBody(value) === hashBody(ACCEPTANCE);
export const historicalIdentity5643311Record = () => ({ sspBookingId: A.current, bookingKind: 'individual',
  serviceDate: A.date, driverExternalId: A.driver, region: 'Suwaidi', rawStatus: 'Collecting Payment',
  serviceType: 'interior_exterior_wash', startedAt: A.started, completedAt: A.completed,
  sourceUrl: 'https://ssp-portal.sweater.sa/bookings',
  notes: 'Execution observed26Oct00:32 Riyadh, minute precision. Type/timezone per Hadi11Oct. Identity accepted separately after26Oct phone comparison; no collection assertion.' });
const CURRENT_HASH = hashRecord(normalizeRecord(historicalIdentity5643311Record()));
const BOOKING_KEYS = new Set(['sspBookingId', 'bookingNumber', 'record', 'sourceHash', 'schemaVersion', 'source', 'lastImportRunId',
  'serviceDate', 'periodKey', 'normalizedStatus', 'processingStatus', 'reviewReasonCode', 'recognitionEligibility',
  'recognitionReason', 'operationalWorkerId', 'updatedAtIso', 'updatedAt']);
const CLAIM_KEYS = new Set(['bookingNumber', 'sspBookingId', 'washId', 'source', 'importRunId', 'claimedBy', 'claimedAt']);
const exactKeys = (row, allowed) => Boolean(row && Object.keys(row).every(key => allowed.has(key)));
const relatedToCase = (id, data) => identityReference(id, A.number) || referencesThisIdentity(referenceMetadata(data), A.number);

export async function inspectIdentity5643311({ db, read, payload, record, documents, naturallyRelated, claim, candidate, established, execution, period, settlement }) {
  if (record.sspBookingId !== A.current) return null;
  const legacyDoc = documents.find(d => d.collection === COL.BOOKINGS && d.id === A.legacy);
  const legacy = legacyDoc?.data;
  const related = documents.filter(d => naturallyRelated.includes(d) || relatedToCase(d.id, d.data));
  const [oldRawSnap, laterRawSnap, oldRunSnap, laterRunSnap] = await Promise.all([
    read(db.collection(COL.RAW).doc(rawDocId(A.legacyRun, A.legacy))),
    read(db.collection(COL.RAW).doc(rawDocId(A.laterRun, A.current))),
    read(db.collection(COL.RUNS).doc(A.legacyRun)), read(db.collection(COL.RUNS).doc(A.laterRun)),
  ]);
  const oldRaw = oldRawSnap.exists ? oldRawSnap.data() : null, laterRaw = laterRawSnap.exists ? laterRawSnap.data() : null;
  const oldRun = oldRunSnap.exists ? oldRunSnap.data() : null, laterRun = laterRunSnap.exists ? laterRunSnap.data() : null;
  const oldRow = oldRun?.result?.rows?.find(r => r.sspBookingId === A.legacy);
  const laterRow = laterRun?.result?.rows?.find(r => r.sspBookingId === A.current);
  const fixedScope = payload.records.length === 1 && payload.coverage.recordCount === 1
    && payload.coverage.rangeFrom === A.date && payload.coverage.rangeTo === A.date
    && payload.coverage.extractedAt === A.sourceObservedAt && !payload.coverage.isComplete
    && hashRecord(record) === CURRENT_HASH && established && candidate === A.worker && execution.eligible;
  const financialCollections = [...FINANCIAL_COLLECTIONS, 'payroll_runs'];
  const financialSnaps = fixedScope ? await Promise.all(financialCollections.map(c => read(db.collection(c).select(...REFERENCE_FIELDS)))) : [];
  const financialRefs = financialSnaps.flatMap((snap, i) => snap.docs.flatMap(d => {
    const metadata = referenceMetadata(d.data());
    return relatedToCase(d.id, metadata) || metadata.sourceId === '2026-10' || metadata.reversedSourceId === '2026-10'
      ? [{ collection: financialCollections[i], id: d.id, hash: hashBody(metadata) }] : [];
  }));
  const rawMatches = (raw, run, id, hash) => Boolean(raw && raw.source === SOURCE && raw.importRunId === run
    && raw.sspBookingId === id && raw.sourceHash === hash && hashRecord(raw.normalizedRecord) === hash
    && hashRecord(normalizeRecord(raw.rawPayload ?? {})) === hash && !hasProtectedIdentityEffect(raw));
  const runMatches = (run, row, id, rawId, hash, reason) => Boolean(run?.source === SOURCE
    && ['completed', 'completed_with_gaps'].includes(run.status) && row?.rawSaved && !row.washCreated && !row.washId
    && row.sspBookingId === id && row.rawId === rawId && row.sourceHash === hash && row.reasonCode === reason);
  const checks = {
    approvedSingletonAndCurrentEvidence: Boolean(fixedScope),
    ownerPhoneConditionMet: acceptedHistoricalIdentity5643311(ACCEPTANCE),
    legacyUnverifiedEvidenceIntact: exactKeys(legacy, BOOKING_KEYS) && legacy.sspBookingId === A.legacy
      && legacy.bookingNumber === A.number && legacy.source === SOURCE && legacy.schemaVersion === 1
      && legacy.lastImportRunId === A.legacyRun && legacy.serviceDate === A.date && legacy.periodKey === '2026-10'
      && legacy.processingStatus === 'needs_review' && legacy.reviewReasonCode === 'unverified_worker_link'
      && legacy.operationalWorkerId === null && legacy.recognitionEligibility === null && legacy.recognitionReason === null
      && legacy.sourceHash === A.legacyHash && hashRecord(legacy.record) === A.legacyHash && !hasProtectedIdentityEffect(legacy),
    historicalRawIntact: rawMatches(oldRaw, A.legacyRun, A.legacy, A.legacyHash),
    laterSourceRawIntact: rawMatches(laterRaw, A.laterRun, A.current, A.laterHash),
    originalRunProvesNoExecution: runMatches(oldRun, oldRow, A.legacy, rawDocId(A.legacyRun, A.legacy), A.legacyHash, 'unverified_worker_link')
      && oldRow.bookingSaved === true && oldRow.bikerId === null
      && Date.parse(oldRun.coverage?.extractedAt) >= Date.parse(A.started) && Date.parse(oldRun.coverage?.extractedAt) < Date.parse(A.completed),
    laterRunProvesNoExecution: runMatches(laterRun, laterRow, A.current, rawDocId(A.laterRun, A.current), A.laterHash, 'protected_existing_record')
      && laterRow.bookingSaved === false && Date.parse(laterRun.coverage?.extractedAt) > Date.parse(A.completed)
      && Date.parse(laterRun.coverage?.extractedAt) < Date.parse(A.sourceObservedAt),
    originalClaimIntact: exactKeys(claim, CLAIM_KEYS) && claim.bookingNumber === A.number && claim.sspBookingId === A.legacy
      && claim.washId === A.wash && claim.source === SOURCE && claim.importRunId === A.legacyRun && !hasProtectedIdentityEffect(claim),
    noOtherBookingWashOwnerOrLink: related.length === 1 && related[0] === legacyDoc,
    financialIdentityAuditComplete: Boolean(fixedScope), noReferencedFinancialEffect: Boolean(fixedScope) && financialRefs.length === 0,
    periodAndSettlementOpen: (!period || period.status === 'open') && !hasProtectedIdentityEffect(period)
      && !hasProtectedIdentityEffect(settlement) && !['approved', 'invoiced', 'partially_collected', 'collected', 'closed'].includes(settlement?.status),
  };
  const evidenceRefs = [
    ...(legacyDoc ? [{ collection: COL.BOOKINGS, id: A.legacy, hash: hashBody(legacy) }] : []),
    ...(claim ? [{ collection: 'sweater_owner_booking_claims', id: A.number, hash: hashBody(claim) }] : []),
    ...[[oldRaw, COL.RAW, rawDocId(A.legacyRun, A.legacy)], [laterRaw, COL.RAW, rawDocId(A.laterRun, A.current)],
      [oldRun, COL.RUNS, A.legacyRun], [laterRun, COL.RUNS, A.laterRun]]
      .flatMap(([data, collection, id]) => data ? [{ collection, id, hash: hashBody(data) }] : []),
  ];
  return { public: { kind: KIND, bookingNumber: A.number, legacyBookingId: A.legacy, currentBookingId: A.current,
    canonicalWashId: A.wash, eligible: Object.values(checks).every(Boolean), checks, claimPreserved: true,
    resolutionSaved: false, acceptance: { ...ACCEPTANCE }, evidenceRefs }, state: { checks, evidenceRefs, financialRefs, acceptance: ACCEPTANCE } };
}

export function preservedHistorical5643311ClaimMatches(row, claim) {
  const resolution = row.historicalIdentityResolution;
  const ref = resolution?.evidenceRefs?.find(r => r.collection === 'sweater_owner_booking_claims');
  return Boolean(resolution?.kind === KIND && resolution.eligible && resolution.resolutionSaved
    && acceptedHistoricalIdentity5643311(resolution.acceptance) && resolution.bookingNumber === A.number
    && row.sspBookingId === A.current && row.bookingNumber === A.number && row.washId === A.wash
    && claim?.sspBookingId === A.legacy && claim.washId === A.wash && claim.source === SOURCE && ref?.hash === hashBody(claim));
}
