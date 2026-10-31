// Raw facts remain compatible. Hadi's11Oct approval additionally records a
// source-proven wash/commission, NEVER collection, owner confirmation or ledger.
import { hashBody, hashRecord, normalizeRecord, recordProblems, ALLOWED_RECORD_FIELDS } from './record.js';
import { normalizeServiceType, FULL_WASH_SERVICE } from './vocab.js';
import { bookingDocId, sspKey, sspWashDocId, rawDocId, COL, MAX_BODY_BYTES, SweaterIngestError } from './ingest.js';
import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';
import { executionEligibility, executionWash } from './operationsExecution.js';
import { inspectIdentity5596423, preservedResolutionClaimMatches, identityReference, referencesThisIdentity,
  referenceMetadata } from './operationsIdentity5596423.js';
import { inspectObservationPromotion, preservedPromotionClaimMatches } from './operationsObservationPromotion.js';
import { inspectIdentity5643311, preservedHistorical5643311ClaimMatches } from './operationsIdentity5643311.js';

export const OPERATIONS_SOURCE = 'operations_sync_v2';
export const OPERATIONS_MAX_RECORDS = 100; // raw + claim + wash + booking (+ its variance) per row, one atomic transaction
const CLAIMS = 'sweater_owner_booking_claims'; // shared natural-key lock with the existing owner workflow
const PROTECTED_COLLECTIONS = ['washes', COL.BOOKINGS, 'sweater_owner_collection_confirmations',
  'sweater_operational_wash_links', 'sweater_booking_links'];
const fail = (message, code = 'invalid-argument') => { throw new SweaterIngestError(message, { code }); };
const object = x => Boolean(x && typeof x === 'object' && !Array.isArray(x));
const exactKeys = (x, allowed) => object(x) && Object.keys(x).every(k => allowed.includes(k));
const docId = x => typeof x === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,159}$/.test(x) && x !== '__.*__';
const day = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const sourceUrl = x => {
  try { const u = new URL(x); return u.protocol === 'https:' && u.hostname === 'ssp-portal.sweater.sa'
    && !u.username && !u.password && !u.hash && ![...u.searchParams.keys()].some(k => /token|session|auth|cookie|secret/i.test(k)); }
  catch { return false; }
};

export function validateOperationsPayload(payload) {
  if (!exactKeys(payload, ['contractVersion', 'importRunId', 'agentStatus', 'coverage', 'workerLinks', 'records', 'rechecks'])
    || payload.contractVersion !== 2 || !docId(payload.importRunId)
    || !['ok', 'partial'].includes(payload.agentStatus) || !Array.isArray(payload.records)
    || payload.records.length > OPERATIONS_MAX_RECORDS
    || Buffer.byteLength(JSON.stringify(payload)) > MAX_BODY_BYTES) fail('عقد التشغيل v2 أو حجم/معرّف الدفعة غير صالح.');
  const c = payload.coverage;
  if (!exactKeys(c, ['rangeFrom', 'rangeTo', 'extractedAt', 'pageCount', 'pagesFetched', 'recordCount', 'isComplete', 'sourceUrl', 'modules', 'gaps'])
    || !day(c.rangeFrom) || !day(c.rangeTo) || c.rangeFrom > c.rangeTo
    || typeof c.extractedAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(c.extractedAt) || !Number.isFinite(Date.parse(c.extractedAt))
    || !Number.isInteger(c.pageCount) || c.pageCount < 1 || !Number.isInteger(c.pagesFetched) || c.pagesFetched < 0 || c.pagesFetched > c.pageCount
    || c.recordCount !== payload.records.length || typeof c.isComplete !== 'boolean' || !sourceUrl(c.sourceUrl)
    || !exactKeys(c.modules, ['individual', 'corporate'])
    || !['individual', 'corporate'].every(k => ['complete', 'partial', 'unavailable'].includes(c.modules[k]))
    || !Array.isArray(c.gaps) || c.gaps.length > 100 || c.gaps.some(g => typeof g !== 'string' || !g.trim() || g.length > 500)) fail('بيانات التغطية/المصدر ناقصة أو غير صالحة.');
  const hasGaps = c.pagesFetched !== c.pageCount || Object.values(c.modules).some(s => s !== 'complete') || c.gaps.length > 0;
  if ((c.isComplete && hasGaps) || (!c.isComplete && !c.gaps.length)) fail('اكتمال التغطية يناقض الصفحات/الفجوات أو نطاق الشركات.');
  if (!object(payload.workerLinks) || Object.entries(payload.workerLinks).some(([driver, id]) => !docId(driver) || !docId(id))) fail('روابط العمال يجب أن تكون معرّفات ثابتة فقط، لا أسماء أو كائنات.');
  // Optional: bookings outside the window re-read because they were still moving in Sweater (from the `pending` list).
  if (payload.rechecks !== undefined && (!Array.isArray(payload.rechecks) || payload.rechecks.length > OPERATIONS_MAX_RECORDS
    || payload.rechecks.some(id => !docId(id) || !/^\d+$/.test(ownerBookingIdentity(id)))
    || new Set(payload.rechecks.map(ownerBookingIdentity)).size !== payload.rechecks.length)) fail('قائمة إعادة القراءة يجب أن تكون أرقام حجوزات فريدة.');
  return payload;
}
const rechecked = (payload, id) => (payload.rechecks ?? []).some(r => ownerBookingIdentity(r) === ownerBookingIdentity(id));

function rowProblems(raw, coverage, payload) {
  // Hadi's 10 Oct approval: v2 may retain an otherwise valid observation
  // without a service as pending review. Keep the shared financial/owner
  // contract strict and continue ALL scalar/source/identity checks below.
  const problems = recordProblems(raw).filter(p => p.code !== 'unknown_service_type');
  if (problems.length) return problems;
  // The old general validator coerces objects to strings; v2 never stores nested arbitrary values.
  const numeric = new Set(['platformAmount', 'customerDiscount', 'partnerOperationalDeduction', 'compensationAmount', 'rating']);
  if (ALLOWED_RECORD_FIELDS.some(k => raw[k] != null && (numeric.has(k)
    ? typeof raw[k] !== 'number' || !Number.isFinite(raw[k]) : typeof raw[k] !== 'string' || raw[k].length > 2000))) {
    return [{ code: 'bad_shape', ar: 'حقول السجل يجب أن تكون حقائق نصية/رقمية بسيطة فقط.' }];
  }
  const outside = raw.serviceDate < coverage.rangeFrom || raw.serviceDate > coverage.rangeTo;
  if (!docId(raw.sspBookingId) || !day(raw.serviceDate) || (outside && !rechecked(payload, raw.sspBookingId))
    || !sourceUrl(raw.sourceUrl) || !['individual', 'corporate'].includes(raw.bookingKind)) {
    return [{ code: 'invalid_source_scope', ar: 'المعرف أو التاريخ أو نوع الحجز أو رابط المصدر غير موثق ضمن النطاق.' }];
  }
  return [];
}

const identityOf = data => ownerBookingIdentity(data.ssp_booking_id || data.sspBookingId || data.record?.sspBookingId || data.bookingNumber || '');
export const financialProtection = b => Boolean(b && (b.postedEntryId || b.postedAt || b.settlementId || b.ownerCollectionConfirmation
  || b.ownerCompletionDecision || b.financialLock || b.locked || b.lockedAt
  || ['posted', 'ready_for_posting', 'matched'].includes(b.processingStatus)
  || b.source === 'staff_owner_confirmation'));
// Owner and financial assertions about a booking number, wherever they are filed.
export const ASSERTIONS = ['sweater_owner_collection_confirmations', 'sweater_booking_links'];
const publicRow = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')));

// ── حالة الحجز: «تحتاج مراجعة» لما يحتاج قرارًا فعليًا فقط ──
// الحالات النهائية في سويتر: Collecting Payment و Cancelled by Admin. غيرها
// (Initiated / On the Way / Reached / Washing Started) ينتظر قراءة سويتر التالية.
export const FINAL_STATUSES = Object.freeze(['payment_collection', 'admin_cancelled']);
export const REVIEW = Object.freeze({ DECISION: 'needs_review', PENDING: 'pending_source', DONE: 'validated' });
const PENDING_STATUSES = ['approved', 'on_the_way', 'arrived', 'washing_started'];
export const lockedFinancially = b => Boolean(b && (b.postedEntryId || b.postedAt || b.settlementId || b.financialLock || b.locked || b.lockedAt
  || ['posted', 'ready_for_posting', 'matched'].includes(b.processingStatus)));
/** Is this observation still moving in Sweater (re-read on every sync, whatever its date)? */
export const sourceStillOpen = record => !FINAL_STATUSES.includes(record?.normalizedStatus)
  && String(record?.rawStatus ?? '').trim().toLowerCase() !== 'completed';

/**
 * Where a booking stands, and why. Reason codes are the same the B→S promotion proof
 * reads, so an unexecuted reservation still promotes when its execution arrives.
 */
export function bookingReviewState({ record, hasWash = false, established = false, execution = null,
  awaitingCleanup = false, lockedChange = false, washBlocked = false, washMissing = false }) {
  if (awaitingCleanup) return { processingStatus: REVIEW.DECISION, reasonCode: 'awaiting_identity_cleanup' };
  if (lockedChange) return { processingStatus: REVIEW.DECISION, reasonCode: 'protected_existing_record' };
  const status = record?.normalizedStatus, raw = String(record?.rawStatus ?? '').trim().toLowerCase();
  // Cancelled after a wash was recorded for it: which one stands is the owner's call.
  if (status === 'admin_cancelled') return hasWash ? { processingStatus: REVIEW.DECISION, reasonCode: 'protected_existing_record' }
    : { processingStatus: REVIEW.DONE, reasonCode: null };
  if (PENDING_STATUSES.includes(status)) return { processingStatus: REVIEW.PENDING, reasonCode: 'execution_not_final' };
  if (status === 'unknown' && ['initiated', 'reached'].includes(raw)) return { processingStatus: REVIEW.PENDING, reasonCode: 'unknown_status' };
  if (status === 'unknown' && raw !== 'completed') return { processingStatus: REVIEW.DECISION, reasonCode: 'unknown_status' };
  if (!String(record?.serviceType ?? '').trim()) return { processingStatus: REVIEW.DECISION, reasonCode: 'unknown_service_type' };
  if (hasWash) return { processingStatus: REVIEW.DONE, reasonCode: null };
  // A proven execution whose wash another record stands in the way of.
  if (washBlocked) return { processingStatus: REVIEW.DECISION, reasonCode: 'protected_existing_record' };
  // A proven execution no wash was ever recorded for (only the identity cleanup asks: the writer records it itself).
  if (washMissing && execution?.eligible && established) return { processingStatus: REVIEW.DECISION, reasonCode: 'execution_without_wash' };
  if (status === 'unknown' && !execution?.eligible) return { processingStatus: REVIEW.DECISION, reasonCode: 'unknown_status' };
  if (!established) return { processingStatus: REVIEW.DECISION, reasonCode: 'unverified_worker_link' };
  // A wash Sweater shows as done but whose execution is not proven needs a decision; another service is kept as observed.
  if (execution && !execution.eligible && (record.serviceType === FULL_WASH_SERVICE || record.startedAt || record.completedAt)) {
    return { processingStatus: REVIEW.DECISION, reasonCode: execution.reasonCode };
  }
  return { processingStatus: REVIEW.DONE, reasonCode: null };
}
const outsideWindow = (record, coverage) => record.serviceDate < coverage.rangeFrom || record.serviceDate > coverage.rangeTo;
/** Sweater's latest known reading of a booking (beside an owner-held record, or the record itself). */
const latestReading = booking => booking?.latestObservation ?? booking?.record ?? null;
/** A booking still moving in Sweater: re-read on every sync, whatever its date, until it is final. */
export const stillOpenBooking = booking => Boolean(booking && !lockedFinancially(booking) && latestReading(booking)
  && sourceStillOpen(latestReading(booking)));
/** One open variance per booking (not one per run), carrying its period. */
export const operationsVarianceId = number => `ops__${encodeURIComponent(String(number))}`;

// Facts that decide revenue and commission. A later reading that only adds what was missing is not a conflict.
const MATERIAL_FIELDS = ['normalizedStatus', 'serviceDate', 'driverExternalId', 'serviceType', 'startedAt', 'completedAt'];
const filled = value => value != null && String(value).trim() !== '';
const comparable = (key, value) => key === 'serviceType' ? normalizeServiceType(value) : value;
const done = record => record?.normalizedStatus === 'payment_collection'
  || (record?.normalizedStatus === 'unknown' && String(record.rawStatus ?? '').trim().toLowerCase() === 'completed');
// A booking moving on (still in progress, or now completed) agrees with what was kept; going back, or a
// cancellation against a completion (or the reverse), does not.
const statusConflict = (kept, observed) => kept.normalizedStatus !== observed.normalizedStatus
  && !(sourceStillOpen(kept) && (sourceStillOpen(observed) || done(observed)))
  && !(done(kept) && done(observed));
/** Sweater's newest reading of a booking whose record the owner holds, kept beside that record. */
export const latestObservationOf = (record, { observedAtIso, importRunId }) => ({ sspBookingId: record.sspBookingId,
  rawStatus: record.rawStatus, normalizedStatus: record.normalizedStatus, startedAt: record.startedAt ?? null,
  completedAt: record.completedAt ?? null, observedAtIso, importRunId, sourceHash: hashRecord(record) });
/** Which material facts a kept record and a new reading disagree on (both filled, different). */
export const materialConflicts = (kept, observed) => MATERIAL_FIELDS.filter(key => filled(kept?.[key]) && filled(observed?.[key])
  && (key === 'normalizedStatus' ? statusConflict(kept, observed) : comparable(key, kept[key]) !== comparable(key, observed[key])));

async function plan(db, payload, read) {
  validateOperationsPayload(payload);
  const reviewedPayloadHash = hashBody(payload);
  const runRef = db.collection(COL.RUNS).doc(payload.importRunId);
  const snap = await read(runRef), run = snap.exists ? snap.data() : null;
  if (run && (run.source !== OPERATIONS_SOURCE || run.payloadHash !== reviewedPayloadHash)) fail('معرّف الدفعة مستخدم بجسم كامل مختلف أو في مسار آخر.', 'already-exists');
  if (run && (!run.result || !['completed', 'completed_with_gaps'].includes(run.status))) fail('دفعة غير مكتملة؛ تحقق ولا تعاود كتابة عمياء.', 'failed-precondition');
  // Read older manually linked records, including prefix aliases. Transactions
  // reread these queries and the shared per-number claim before ANY write.
  const snapshots = await Promise.all(PROTECTED_COLLECTIONS.map(c => read(db.collection(c))));
  const documents = snapshots.flatMap((s, i) => s.docs.map(d => ({ collection: PROTECTED_COLLECTIONS[i], id: d.id, data: d.data() })));
  const rows = [], seen = new Set(), state = [];
  const multiplicity = new Map();
  for (const raw of payload.records) {
    if (typeof raw?.sspBookingId !== 'string') continue;
    const identity = ownerBookingIdentity(raw.sspBookingId);
    multiplicity.set(identity, (multiplicity.get(identity) ?? 0) + 1);
  }
  const counts = { new: 0, modified: 0, duplicate: 0, rejected: 0, needsReview: 0 };
  for (const raw of payload.records) {
    const problems = rowProblems(raw, payload.coverage, payload);
    if (problems.length) {
      counts.rejected++; rows.push({ sspBookingId: typeof raw?.sspBookingId === 'string' ? raw.sspBookingId : null,
        outcome: 'rejected', reasonCode: problems[0].code, rawSaved: false, bookingSaved: false, washId: null }); continue;
    }
    const record = normalizeRecord(raw), sourceHash = hashRecord(record), identity = ownerBookingIdentity(record.sspBookingId);
    if (seen.has(identity) || multiplicity.get(identity) > 1) {
      counts.rejected++; rows.push({ sspBookingId: record.sspBookingId, outcome: 'rejected', reasonCode: 'duplicate_in_batch', rawSaved: false, bookingSaved: false, washId: null }); continue;
    }
    seen.add(identity);
    // One booking per number: B-, S- and C- are the same booking at different stages. Until the identity cleanup
    // runs, a number still filed under exactly this prefix is updated where it is; other prefixed copies wait for it.
    const numbered = documents.find(d => d.collection === COL.BOOKINGS && d.id === bookingDocId(record.sspBookingId));
    const filedAsSeen = numbered ? null : documents.find(d => d.collection === COL.BOOKINGS && d.id === sspKey(record.sspBookingId)
      && d.id !== bookingDocId(record.sspBookingId));
    const id = (numbered ?? filedAsSeen)?.id ?? bookingDocId(record.sspBookingId), bookingRef = db.collection(COL.BOOKINGS).doc(id);
    const related = documents.filter(d => identityOf(d.data) === identity);
    const existing = (numbered ?? filedAsSeen)?.data ?? null;
    // Copies still stored under another prefixed id: the identity cleanup folds them first.
    const legacyBookings = related.filter(d => d.collection === COL.BOOKINGS && d.id !== id);
    const claimRef = db.collection(CLAIMS).doc(bookingDocId(identity));
    const claimSnap = await read(claimRef), claim = claimSnap.exists ? claimSnap.data() : null;
    const varianceRef = db.collection(COL.VARIANCES).doc(operationsVarianceId(identity));
    const varianceSnap = await read(varianceRef), variance = varianceSnap.exists ? varianceSnap.data() : null;
    // A reading outside the window is only taken for a booking we hold as still moving in Sweater.
    if (outsideWindow(record, payload.coverage) && !stillOpenBooking(existing)) {
      counts.rejected++; rows.push({ sspBookingId: record.sspBookingId, outcome: 'rejected', reasonCode: 'recheck_not_open',
        rawSaved: false, bookingSaved: false, washId: null }); continue;
    }
    // Incomplete new evidence must never erase an already evidenced service.
    const retainKnownService = !record.serviceType && Boolean(String(existing?.record?.serviceType ?? '').trim());
    const stored = retainKnownService ? { ...record, serviceType: existing.record.serviceType,
      serviceTypeLabel: existing.record.serviceTypeLabel ?? record.serviceTypeLabel } : record;
    const storedHash = hashRecord(stored);
    const existingWorkerIds = new Set(documents.filter(d => d.collection === 'washes' && d.data.driver_external_id === record.driverExternalId)
      .map(d => d.data.biker_id).filter(Boolean));
    // Cloud collectors never need a copy of private worker profiles. Reuse only
    // an unambiguous, already-established source ID link from existing washes.
    // New or conflicting driver IDs still require an explicit reviewed link.
    const candidate = payload.workerLinks[record.driverExternalId]
      ?? (record.driverExternalId && existingWorkerIds.size === 1 ? [...existingWorkerIds][0] : null);
    const workerSnap = candidate ? await read(db.collection('bikers').doc(candidate)) : null;
    const worker = workerSnap?.exists ? workerSnap.data() : null;
    const established = Boolean(record.driverExternalId && worker?.name && (
      worker.driver_external_id === record.driverExternalId || existingWorkerIds.has(candidate)) && existingWorkerIds.size <= 1);
    // Everything about this number except its own (canonical) booking.
    const protectedRows = related.filter(d => d.collection !== COL.BOOKINGS || d.id !== id);
    const protectedBooking = financialProtection(existing);
    const alias = protectedRows.some(d => (d.data.ssp_booking_id || d.data.sspBookingId || d.data.record?.sspBookingId) !== record.sspBookingId);
    const execution = executionEligibility(stored, payload.coverage, worker);
    let proposedWashId = sspWashDocId(record.sspBookingId);
    const washCollision = execution.eligible && documents.some(d => d.collection === 'washes' && d.id === proposedWashId);
    const claimConflict = claim && (claim.sspBookingId !== record.sspBookingId
      || (execution.eligible && (claim.washId !== proposedWashId || claim.source !== OPERATIONS_SOURCE)));
    const foreignBooking = execution.eligible && existing && existing.source !== OPERATIONS_SOURCE;
    const month = record.serviceDate.slice(0, 7);
    const periodSnap = await read(db.collection('accounting_periods').doc(month));
    const periodClosed = periodSnap?.data()?.status === 'closed';
    const settlementSnap = await read(db.collection('sweater_settlements').doc(month));
    const settlement = settlementSnap?.data();
    const settlementProtected = Boolean(settlement && (settlement.journalEntryId || settlement.postedEntryId
      || ['approved', 'invoiced', 'partially_collected', 'collected', 'closed'].includes(settlement.status)));
    const resolution = await inspectIdentity5596423({ db, read, payload, record, documents, naturallyRelated: related, claim, candidate, established, execution,
      period: periodSnap?.data(), settlement });
    const historicalResolution = !resolution ? await inspectIdentity5643311({ db, read, payload, record, documents, naturallyRelated: related,
      claim, candidate, established, execution, period: periodSnap?.data(), settlement }) : null;
    const promotion = !resolution && !historicalResolution ? await inspectObservationPromotion({ db, read, payload, record, documents, claim, candidate, established, execution,
      period: periodSnap?.data(), settlement }) : null;
    const resolved = Boolean(resolution?.public.eligible || historicalResolution?.public.eligible || promotion?.public.eligible);
    const awaitingCleanup = legacyBookings.length > 0 && !resolved;
    const protectedRecord = resolution ? !resolution.public.eligible : historicalResolution ? !historicalResolution.public.eligible : promotion ? !promotion.public.eligible
      : protectedRows.length > 0 || protectedBooking || claimConflict || alias || washCollision || foreignBooking || periodClosed || settlementProtected;
    if (resolution?.public.eligible) proposedWashId = resolution.public.canonicalWashId;
    if (historicalResolution?.public.eligible) proposedWashId = historicalResolution.public.canonicalWashId;
    if (promotion?.public.eligible) proposedWashId = promotion.public.canonicalWashId;
    const sameSource = existing?.sourceHash === storedHash && Boolean(existing.record) && hashRecord(existing.record) === storedHash
      && (protectedRecord || existing.operationalWorkerId === (established ? candidate : null));
    // Sweater's latest reading wins; an older one never overwrites it.
    const stale = !sameSource && Boolean(existing?.observedAtIso) && Date.parse(existing.observedAtIso) > Date.parse(payload.coverage.extractedAt);
    // Posted, settled or in a closed month: the observation is kept raw and raised, never written over the booking.
    const locked = lockedFinancially(existing) || periodClosed || settlementProtected;
    // Confirmed by the owner, completed by an owner decision or written by another path: its record stays as the
    // owner left it. A later reading only matters when it contradicts it, and then the owner decides.
    // So is a number whose other records carry an owner or financial assertion (a posted wash, an owner confirmation).
    const linkedHold = protectedRows.some(d => financialProtection(d.data)) || documents.some(d => ASSERTIONS.includes(d.collection)
      && (identityOf(d.data) === identity || identityReference(d.id, identity) || referencesThisIdentity(referenceMetadata(d.data), identity)));
    const held = linkedHold || (Boolean(existing) && (financialProtection(existing) || existing.source !== OPERATIONS_SOURCE));
    const conflictFields = held && existing && !stale ? materialConflicts(existing.record, stored) : [];
    const missingService = !stored.serviceType;
    const writeWash = execution.eligible && established && !protectedRecord && !missingService && !awaitingCleanup && !stale;
    const hasWash = writeWash || related.some(d => d.collection === 'washes');
    const washBlocked = execution.eligible && established && !missingService && !writeWash && !hasWash;
    // Held, the owner decides when the reading contradicts the kept record, or proves a wash something stands in the way of.
    const heldDecision = held && !stale && (existing ? conflictFields.length > 0 || washBlocked : true);
    const review = held ? (heldDecision ? { processingStatus: REVIEW.DECISION, reasonCode: 'protected_existing_record' }
      : { processingStatus: existing?.processingStatus ?? null, reasonCode: existing?.reviewReasonCode ?? null })
      : bookingReviewState({ record: stored, hasWash, established, execution, awaitingCleanup,
        lockedChange: locked && !sameSource && !stale, washBlocked });
    const unchanged = held ? !heldDecision : sameSource && (locked || (existing.processingStatus === review.processingStatus
      && (existing.reviewReasonCode ?? null) === review.reasonCode));
    const writeBooking = !unchanged && !stale && !locked && !held && !awaitingCleanup;
    // A held booking still shows Sweater's latest reading, beside the owner's record and never over it (a contradiction
    // goes to the owner as a variance instead).
    const noteLatest = held && !heldDecision && existing && !stale && !locked && !awaitingCleanup && existing.latestObservation?.sourceHash !== storedHash
      && !(Date.parse(existing.latestObservation?.observedAtIso) > Date.parse(payload.coverage.extractedAt));
    let outcome = unchanged || stale ? 'duplicate' : existing ? 'modified' : 'new';
    let reasonCode = stale ? 'older_observation' : null;
    if (!unchanged && !stale && review.processingStatus === REVIEW.DECISION) { outcome = 'needs_review'; reasonCode = review.reasonCode; }
    // Still moving in Sweater: saved, and the reason it waits for the next reading is kept on the run.
    else if (!unchanged && !stale && review.processingStatus === REVIEW.PENDING) reasonCode = review.reasonCode;
    if (writeWash && outcome === 'duplicate') outcome = 'modified';
    const washId = writeWash ? proposedWashId : related.find(d => d.collection === 'washes')?.id
      ?? related.find(d => d.data.washId)?.data.washId ?? null;
    const row = { sspBookingId: record.sspBookingId, bookingNumber: identity, outcome, reasonCode,
      processingStatus: writeBooking ? review.processingStatus : existing?.processingStatus ?? null,
      ...(conflictFields.length ? { conflictFields } : {}),
      rawSaved: false, bookingSaved: false, bookingId: existing || writeBooking ? id : null,
      bookingMustMatch: Boolean(writeBooking || (unchanged && sameSource)),
      washId, washCreated: false, bikerId: established ? candidate : null,
      existingLinkRefs: protectedRows.map(d => ({ collection: d.collection, id: d.id, hash: hashBody(d.data) })),
      ...(resolution ? { identityResolution: resolution.public } : {}),
      ...(historicalResolution ? { historicalIdentityResolution: historicalResolution.public } : {}),
      ...(promotion ? { observationPromotion: promotion.public } : {}),
      rawStatus: record.rawStatus, serviceDate: record.serviceDate, driverExternalId: record.driverExternalId,
      sourceHash, storedHash, rawId: rawDocId(payload.importRunId, record.sspBookingId),
      _raw: raw, _record: record, _stored: stored, _bookingRef: bookingRef, _claimRef: claimRef, _claim: claim,
      _writeBooking: writeBooking, _noteLatest: noteLatest, _protected: protectedRecord, _writeWash: writeWash, _review: review,
      _existing: existing, _varianceRef: varianceRef, _variance: variance,
      _washRef: writeWash ? db.collection('washes').doc(proposedWashId) : null,
      _wash: writeWash ? { ...executionWash(stored, candidate, historicalResolution?.public.eligible
        ? historicalResolution.public.acceptance.acceptedSourceName : worker.name),
        ...(promotion?.public.eligible && promotion.public.sourceAssignmentReview
          ? { source_assignment_review: promotion.public.sourceAssignmentReview,
            ...(promotion.public.sourceAssignmentReview.workerDecision
              ? { execution_worker_decision: promotion.public.sourceAssignmentReview.workerDecision } : {}) } : {}),
        ...(historicalResolution?.public.eligible ? { historical_identity_acceptance: historicalResolution.public.acceptance } : {}) } : null };
    rows.push(row); counts[outcome === 'needs_review' ? 'needsReview' : outcome]++;
    state.push({ id: record.sspBookingId, related, claim, variance, worker, existingWorkerIds: [...existingWorkerIds].sort(),
      ...(resolution ? { identityResolution: resolution.state } : {}),
      ...(historicalResolution ? { historicalIdentityResolution: historicalResolution.state } : {}),
      ...(promotion ? { observationPromotion: promotion.state } : {}),
      period: periodSnap.data() ?? null, settlement: settlement ?? null });
  }
  return { payload, run, runRef, rows, counts, reviewedPayloadHash, previewStateHash: hashBody(state) };
}

const resultFor = value => ({ importRunId: value.payload.importRunId, reviewedPayloadHash: value.reviewedPayloadHash,
  previewStateHash: value.previewStateHash, counts: value.counts, coverage: value.payload.coverage,
  status: value.payload.coverage.isComplete ? 'completed' : 'completed_with_gaps',
  rows: value.rows.map(publicRow), rawSavedCount: value.rows.filter(r => r.rawSaved).length,
  bookingSavedCount: value.rows.filter(r => r.bookingSaved).length,
  washesCreated: value.rows.filter(r => r.washCreated).length, ledgerPosted: false, payrollPaid: false,
  limitation: 'Raw observations are retained. Only evidenced wash executions may create a wash and commission entitlement with owner-approved pricing. No collection, payroll payment, owner collection assertion or journal is created.' });

export async function previewOperations(db, payload) {
  const value = await plan(db, payload, ref => ref.get());
  return { ...resultFor(value), dryRun: true, saved: false, replay: false, previousRun: value.run ? { status: value.run.status } : null };
}

/**
 * The booking's one variance: opened (or refreshed) while it needs the owner's decision, superseded once a later
 * reading settles it. A variance the owner already decided on this same evidence is left as decided.
 */
export function operationsVarianceWrite(row, payload, now) {
  const current = row._variance, open = current?.resolution === 'unresolved';
  if (row.outcome === 'needs_review') {
    const decided = current && !['unresolved', 'superseded'].includes(current.resolution) && current.sourceHash === row.storedHash;
    if (decided) return null;
    return { kind: 'operational_sync_review', sspBookingId: row.sspBookingId, bookingNumber: row.bookingNumber,
      periodKey: row.serviceDate.slice(0, 7), serviceDate: row.serviceDate, rawId: row.rawId, importRunId: payload.importRunId,
      sourceHash: row.storedHash, reasonCode: row.reasonCode, conflictFields: row.conflictFields ?? null,
      resolution: 'unresolved', detectedAtIso: open ? current.detectedAtIso ?? now : now, lastSeenAtIso: now,
      ...(current && !open ? { previousResolution: current.resolution } : {}) };
  }
  // An older reading never settles a question a newer one raised.
  if (!open || !row._review || row._review.processingStatus === REVIEW.DECISION || row.reasonCode === 'older_observation') return null;
  return { resolution: 'superseded', supersededAtIso: now, supersededByRunId: payload.importRunId,
    supersededBecause: row._review?.processingStatus ?? null };
}

export async function saveOperations(db, FieldValue, request, actor) {
  if (!exactKeys(request, ['payload', 'reviewedPayloadHash', 'previewStateHash'])) fail('حقول طلب الحفظ غير مسموحة.');
  validateOperationsPayload(request.payload);
  if (request.reviewedPayloadHash !== hashBody(request.payload) || !/^[a-f0-9]{64}$/.test(request.previewStateHash ?? '')) fail('معاينة الجسم الكامل مطلوبة.');
  return db.runTransaction(async tx => {
    const value = await plan(db, request.payload, ref => tx.get(ref));
    if (value.run) return { ...value.run.result, replay: true };
    if (value.previewStateHash !== request.previewStateHash) fail('تغيّرت البيانات منذ المعاينة؛ أعد المعاينة.', 'failed-precondition');
    const now = new Date().toISOString();
    for (const row of value.rows) {
      if (!row._record) continue;
      // Exact whitelisted source observation, even when protected/unknown. Never overwrite history.
      tx.set(db.collection(COL.RAW).doc(row.rawId), { importRunId: value.payload.importRunId, sspBookingId: row.sspBookingId,
        rawPayload: row._raw, normalizedRecord: row._record, sourceHash: row.sourceHash,
        source: OPERATIONS_SOURCE, actor, fetchedAtIso: now, fetchedAt: FieldValue.serverTimestamp(),
        processingStatus: row.outcome === 'needs_review' ? 'needs_review' : 'normalized' });
      row.rawSaved = true;
      if (!row._claim && (row._writeBooking || row._writeWash)) tx.set(row._claimRef, { bookingNumber: row.bookingNumber, sspBookingId: row.sspBookingId,
          washId: sspWashDocId(row.sspBookingId), source: OPERATIONS_SOURCE,
          importRunId: value.payload.importRunId, claimedBy: actor, claimedAt: FieldValue.serverTimestamp() });
      if (row._writeWash) {
        const wash = { ...row._wash, handoffWashHash: hashBody(row._wash), created_at: now,
          import_run_id: value.payload.importRunId, created_by: actor };
        tx.set(row._washRef, wash);
        row.washCreated = true;
        if (row.identityResolution?.eligible) {
          row.identityResolution.resolutionSaved = true;
          // Historical raw, B booking and original reserved claim are kept
          // intact and hash-verified alongside the one new execution.
          for (const ref of row.identityResolution.evidenceRefs) {
            if (!row.existingLinkRefs.some(link => link.collection === ref.collection && link.id === ref.id)) row.existingLinkRefs.push(ref);
          }
        }
        if (row.observationPromotion?.eligible) {
          row.observationPromotion.promotionSaved = true;
          for (const ref of row.observationPromotion.evidenceRefs) {
            if (!row.existingLinkRefs.some(link => link.collection === ref.collection && link.id === ref.id)) row.existingLinkRefs.push(ref);
          }
        }
        if (row.historicalIdentityResolution?.eligible) {
          row.historicalIdentityResolution.resolutionSaved = true;
          row.historicalIdentityResolution.recordedAt = now;
          for (const ref of row.historicalIdentityResolution.evidenceRefs) {
            if (!row.existingLinkRefs.some(link => link.collection === ref.collection && link.id === ref.id)) row.existingLinkRefs.push(ref);
          }
        }
        row.existingLinkRefs.push({ collection: 'washes', id: row.washId, hash: hashBody(wash) });
      }
      if (row._writeBooking) {
        const aliases = [...new Set([...(row._existing?.aliases ?? []), row._existing?.sspBookingId, row.sspBookingId].filter(Boolean))].sort();
        tx.set(row._bookingRef, { sspBookingId: row.sspBookingId, bookingNumber: row.bookingNumber, aliases,
          record: row._stored, sourceHash: row.storedHash, schemaVersion: 1, source: OPERATIONS_SOURCE,
          lastImportRunId: value.payload.importRunId, observedAtIso: value.payload.coverage.extractedAt,
          serviceDate: row.serviceDate, periodKey: row.serviceDate.slice(0, 7),
          normalizedStatus: row._stored.normalizedStatus, processingStatus: row._review.processingStatus,
          reviewReasonCode: row._review.reasonCode, recognitionEligibility: null, recognitionReason: null,
          operationalWorkerId: row.bikerId, updatedAtIso: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        row.bookingSaved = true;
      }
      if (row._noteLatest) {
        tx.set(row._bookingRef, { latestObservation: latestObservationOf(row._stored, { observedAtIso: value.payload.coverage.extractedAt,
          importRunId: value.payload.importRunId }) }, { merge: true });
        row.latestObservationSaved = true;
      }
      const variance = operationsVarianceWrite(row, value.payload, now);
      if (variance) tx.set(row._varianceRef, variance, { merge: true });
    }
    const result = { ...resultFor(value), dryRun: false, saved: true, replay: false };
    tx.set(value.runRef, { importRunId: value.payload.importRunId, payloadHash: value.reviewedPayloadHash,
      bodyHash: hashBody(value.payload.records), source: OPERATIONS_SOURCE, actor, status: result.status,
      coverage: value.payload.coverage, startedAtIso: now, finishedAtIso: now, result });
    tx.set(db.collection(COL.STATE).doc('current'), { lastOperationalRunId: value.payload.importRunId,
      lastOperationalSuccessAtIso: now, lastOperationalCoverage: value.payload.coverage, lastOperationalCounts: value.counts }, { merge: true });
    return result;
  });
}

// A status response confirms historical raw persistence separately from current
// booking state. Later legitimate changes are not falsely called data loss.
export async function operationsStatus(db, payload) {
  validateOperationsPayload(payload);
  const snap = await db.collection(COL.RUNS).doc(payload.importRunId).get();
  if (!snap.exists) return { found: false, verified: false, importRunId: payload.importRunId };
  const run = snap.data();
  if (run.source !== OPERATIONS_SOURCE || run.payloadHash !== hashBody(payload)) fail('معرّف الدفعة مستخدم بجسم مختلف.', 'already-exists');
  if (!run.result || !['completed', 'completed_with_gaps'].includes(run.status)) return { found: true, verified: false, status: run.status };
  const verification = await Promise.all(run.result.rows.map(async row => {
    if (!row.rawSaved) return { sspBookingId: row.sspBookingId, rawVerified: false, notSaved: true, reasonCode: row.reasonCode };
    const rawSnap = await db.collection(COL.RAW).doc(row.rawId).get();
    const raw = rawSnap.exists ? rawSnap.data() : null;
    const rawVerified = raw?.sourceHash === row.sourceHash && raw?.sspBookingId === row.sspBookingId
      && hashBody(raw.rawPayload) === hashBody(payload.records.find(r => r.sspBookingId === row.sspBookingId));
    // Runs before the identity cleanup recorded the prefixed id; the booking now lives under its number.
    const bookingSnap = row.bookingId ? await db.collection(COL.BOOKINGS).doc(row.bookingId).get() : null;
    const foldedSnap = row.bookingId && !bookingSnap.exists && bookingDocId(row.bookingId) !== row.bookingId
      ? await db.collection(COL.BOOKINGS).doc(bookingDocId(row.bookingId)).get() : null;
    const booking = bookingSnap?.exists ? bookingSnap.data() : foldedSnap?.exists ? foldedSnap.data() : null;
    const washSnap = row.washId ? await db.collection('washes').doc(row.washId).get() : null;
    const wash = washSnap?.exists ? washSnap.data() : null;
    const claimSnap = await db.collection(CLAIMS).doc(bookingDocId(row.bookingNumber)).get();
    const claim = claimSnap.exists ? claimSnap.data() : null;
    const linkChecks = await Promise.all((row.existingLinkRefs ?? []).map(async link => {
      const current = await db.collection(link.collection).doc(link.id).get();
      return { collection: link.collection, id: link.id, unchanged: current.exists && hashBody(current.data()) === link.hash };
    }));
    // A later run that replaced this reading is the booking moving on, not data loss; this run's raw row is the proof.
    const supersededBy = booking && booking.lastImportRunId !== run.importRunId && Date.parse(booking.observedAtIso) >= Date.parse(run.coverage.extractedAt)
      ? booking.lastImportRunId : null;
    return { sspBookingId: row.sspBookingId, rawVerified, bookingId: row.bookingId, ...(supersededBy ? { currentBookingSupersededBy: supersededBy } : {}),
      currentBookingMatches: booking?.sourceHash === (row.storedHash ?? row.sourceHash) && Boolean(booking?.record)
        && hashRecord(booking.record) === (row.storedHash ?? row.sourceHash),
      currentWorkerId: booking?.operationalWorkerId ?? null,
      currentNaturalClaimMatches: claim?.sspBookingId === row.sspBookingId || preservedResolutionClaimMatches(row, claim)
        || preservedPromotionClaimMatches(row, claim) || preservedHistorical5643311ClaimMatches(row, claim),
      ...(row.historicalIdentityResolution ? { historicalIdentityResolutionSaved: row.historicalIdentityResolution.resolutionSaved === true,
        historicalIdentityResolutionVerified: preservedHistorical5643311ClaimMatches(row, claim) && linkChecks.every(link => link.unchanged) } : {}),
      ...(row.identityResolution ? { identityResolutionSaved: row.identityResolution.resolutionSaved === true,
        identityResolutionVerified: preservedResolutionClaimMatches(row, claim) && linkChecks.every(link => link.unchanged) } : {}),
      ...(row.observationPromotion ? { observationPromotionSaved: row.observationPromotion.promotionSaved === true,
        observationPromotionVerified: preservedPromotionClaimMatches(row, claim) && linkChecks.every(link => link.unchanged) } : {}),
      existingLinks: linkChecks,
      washId: row.washId, existingWashVerified: row.washId ? identityOf(wash ?? {}) === row.bookingNumber : null,
      washCreated: row.washCreated === true };
  }));
  const rawVerified = verification.every(r => r.notSaved || r.rawVerified);
  const linksVerified = verification.every((r, i) => r.notSaved || (
    (!run.result.rows[i].bookingMustMatch || r.currentBookingMatches || Boolean(r.currentBookingSupersededBy))
    && (!(run.result.rows[i].bookingSaved || run.result.rows[i].washCreated) || r.currentNaturalClaimMatches)
    && r.existingLinks.every(link => link.unchanged) && r.existingWashVerified !== false));
  return { found: true, importRunId: payload.importRunId, verified: rawVerified && linksVerified,
    rawVerified, linksVerified,
    status: run.status, payloadHash: run.payloadHash, coverage: run.coverage, result: run.result, verification };
}

// ── «ما زال مفتوحًا في سويتر»: ما يعيد الوكيل قراءته في كل مزامنة مهما كان تاريخه ──
export const PENDING_CONTRACT = 'sweater-pending-v1';
export function validatePendingRequest(payload) {
  if (!exactKeys(payload, ['contract', 'importRunId']) || payload.contract !== PENDING_CONTRACT || !docId(payload.importRunId)) {
    fail('طلب قائمة المفتوح غير صالح.');
  }
  return payload;
}
/** Every booking still moving in Sweater (Initiated / On the Way / Reached / Washing Started, or an unknown open label). */
export async function pendingBookings(db) {
  const snap = await db.collection(COL.BOOKINGS).get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => /^\d+$/.test(b.id) && stillOpenBooking(b)).map(b => {
    const reading = latestReading(b);
    return { bookingNumber: b.id, sspBookingId: reading.sspBookingId ?? b.sspBookingId, serviceDate: reading.serviceDate ?? b.serviceDate,
      rawStatus: reading.rawStatus ?? null, normalizedStatus: reading.normalizedStatus ?? null, processingStatus: b.processingStatus ?? null,
      observedAtIso: reading.observedAtIso ?? b.observedAtIso ?? null };
  }).sort((a, b) => String(a.serviceDate).localeCompare(String(b.serviceDate)) || a.bookingNumber.localeCompare(b.bookingNumber, undefined, { numeric: true }));
  return { contract: PENDING_CONTRACT, generatedAtIso: new Date().toISOString(), count: rows.length, bookings: rows,
    finalStatuses: ['Collecting Payment', 'Cancelled by Admin'] };
}
