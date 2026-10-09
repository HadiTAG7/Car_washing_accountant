// Operational facts only. No wash, owner assertion, price, tax or ledger writer.
import { hashBody, hashRecord, normalizeRecord, recordProblems, ALLOWED_RECORD_FIELDS } from './record.js';
import { bookingDocId, rawDocId, COL, MAX_BODY_BYTES, SweaterIngestError } from './ingest.js';
import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';

export const OPERATIONS_SOURCE = 'operations_sync_v2';
export const OPERATIONS_MAX_RECORDS = 100; // <= 4 writes/row + run + state, one atomic transaction
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
  if (!exactKeys(payload, ['contractVersion', 'importRunId', 'agentStatus', 'coverage', 'workerLinks', 'records'])
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
  return payload;
}

function rowProblems(raw, coverage) {
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
  if (!docId(raw.sspBookingId) || !day(raw.serviceDate) || raw.serviceDate < coverage.rangeFrom || raw.serviceDate > coverage.rangeTo
    || !sourceUrl(raw.sourceUrl) || !['individual', 'corporate'].includes(raw.bookingKind)) {
    return [{ code: 'invalid_source_scope', ar: 'المعرف أو التاريخ أو نوع الحجز أو رابط المصدر غير موثق ضمن النطاق.' }];
  }
  return [];
}

const identityOf = data => ownerBookingIdentity(data.ssp_booking_id || data.sspBookingId || data.record?.sspBookingId || data.bookingNumber || '');
const financialProtection = b => Boolean(b && (b.postedEntryId || b.postedAt || b.settlementId || b.ownerCollectionConfirmation
  || b.ownerCompletionDecision || b.financialLock || b.locked || b.lockedAt
  || ['posted', 'ready_for_posting', 'matched'].includes(b.processingStatus)
  || b.source === 'staff_owner_confirmation'));
const publicRow = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')));

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
    const problems = rowProblems(raw, payload.coverage);
    if (problems.length) {
      counts.rejected++; rows.push({ sspBookingId: typeof raw?.sspBookingId === 'string' ? raw.sspBookingId : null,
        outcome: 'rejected', reasonCode: problems[0].code, rawSaved: false, bookingSaved: false, washId: null }); continue;
    }
    const record = normalizeRecord(raw), sourceHash = hashRecord(record), identity = ownerBookingIdentity(record.sspBookingId);
    if (seen.has(identity) || multiplicity.get(identity) > 1) {
      counts.rejected++; rows.push({ sspBookingId: record.sspBookingId, outcome: 'rejected', reasonCode: 'duplicate_in_batch', rawSaved: false, bookingSaved: false, washId: null }); continue;
    }
    seen.add(identity);
    const id = bookingDocId(record.sspBookingId), bookingRef = db.collection(COL.BOOKINGS).doc(id);
    const related = documents.filter(d => identityOf(d.data) === identity);
    const existing = documents.find(d => d.collection === COL.BOOKINGS && d.id === id)?.data ?? null;
    const claimRef = db.collection(CLAIMS).doc(bookingDocId(identity));
    const claimSnap = await read(claimRef), claim = claimSnap.exists ? claimSnap.data() : null;
    const candidate = payload.workerLinks[record.driverExternalId] ?? null;
    const workerSnap = candidate ? await read(db.collection('bikers').doc(candidate)) : null;
    const worker = workerSnap?.exists ? workerSnap.data() : null;
    const existingWorkerIds = new Set(documents.filter(d => d.collection === 'washes' && d.data.driver_external_id === record.driverExternalId)
      .map(d => d.data.biker_id).filter(Boolean));
    const established = Boolean(record.driverExternalId && worker?.name && (
      worker.driver_external_id === record.driverExternalId || existingWorkerIds.has(candidate)) && existingWorkerIds.size <= 1);
    const protectedRows = related.filter(d => d.collection !== COL.BOOKINGS || d.id !== id);
    const protectedBooking = financialProtection(existing);
    const alias = related.some(d => (d.data.ssp_booking_id || d.data.sspBookingId || d.data.record?.sspBookingId) !== record.sspBookingId);
    const claimConflict = claim && claim.sspBookingId !== record.sspBookingId;
    const protectedRecord = protectedRows.length > 0 || protectedBooking || claimConflict || alias;
    const unchanged = existing?.sourceHash === sourceHash && existing.record && hashRecord(existing.record) === sourceHash
      && (protectedRecord || existing.operationalWorkerId === (established ? candidate : null));
    const missingService = !record.serviceType;
    // Incomplete new evidence must never erase an already evidenced service.
    const retainKnownService = missingService && Boolean(String(existing?.record?.serviceType ?? '').trim());
    let outcome = unchanged ? 'duplicate' : existing ? 'modified' : 'new';
    let reasonCode = null;
    if (protectedRecord && !unchanged) { outcome = 'needs_review'; reasonCode = 'protected_existing_record'; }
    else if (missingService) { outcome = 'needs_review'; reasonCode = 'unknown_service_type'; }
    else if (!unchanged && !established) { outcome = 'needs_review'; reasonCode = 'unverified_worker_link'; }
    else if (!unchanged && record.normalizedStatus === 'unknown') { outcome = 'needs_review'; reasonCode = 'unknown_status'; }
    const writeBooking = !protectedRecord && !unchanged && !retainKnownService;
    const washId = related.find(d => d.collection === 'washes')?.id
      ?? related.find(d => d.data.washId)?.data.washId ?? null;
    const row = { sspBookingId: record.sspBookingId, bookingNumber: identity, outcome, reasonCode,
      rawSaved: false, bookingSaved: false, bookingId: existing || writeBooking ? id : null,
      bookingMustMatch: Boolean(writeBooking || unchanged),
      washId, washCreated: false, bikerId: established ? candidate : null,
      existingLinkRefs: protectedRows.map(d => ({ collection: d.collection, id: d.id, hash: hashBody(d.data) })),
      rawStatus: record.rawStatus, serviceDate: record.serviceDate, driverExternalId: record.driverExternalId,
      sourceHash, rawId: rawDocId(payload.importRunId, record.sspBookingId),
      _raw: raw, _record: record, _bookingRef: bookingRef, _claimRef: claimRef, _claim: claim,
      _writeBooking: writeBooking, _protected: protectedRecord };
    rows.push(row); counts[outcome === 'needs_review' ? 'needsReview' : outcome]++;
    state.push({ id: record.sspBookingId, related, claim, worker, existingWorkerIds: [...existingWorkerIds].sort() });
  }
  return { payload, run, runRef, rows, counts, reviewedPayloadHash, previewStateHash: hashBody(state) };
}

const resultFor = value => ({ importRunId: value.payload.importRunId, reviewedPayloadHash: value.reviewedPayloadHash,
  previewStateHash: value.previewStateHash, counts: value.counts, coverage: value.payload.coverage,
  status: value.payload.coverage.isComplete ? 'completed' : 'completed_with_gaps',
  rows: value.rows.map(publicRow), rawSavedCount: value.rows.filter(r => r.rawSaved).length,
  bookingSavedCount: value.rows.filter(r => r.bookingSaved).length, washesCreated: 0, ledgerPosted: false, payrollPaid: false,
  limitation: 'Raw operational facts only. No completed wash, price, tax, payment or owner assertion is created.' });

export async function previewOperations(db, payload) {
  const value = await plan(db, payload, ref => ref.get());
  return { ...resultFor(value), dryRun: true, saved: false, replay: false, previousRun: value.run ? { status: value.run.status } : null };
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
      if (row._writeBooking) {
        if (!row._claim) tx.set(row._claimRef, { bookingNumber: row.bookingNumber, sspBookingId: row.sspBookingId,
          washId: `ssp__${bookingDocId(row.sspBookingId)}`, source: OPERATIONS_SOURCE,
          importRunId: value.payload.importRunId, claimedBy: actor, claimedAt: FieldValue.serverTimestamp() });
        tx.set(row._bookingRef, { sspBookingId: row.sspBookingId, bookingNumber: row.bookingNumber,
          record: row._record, sourceHash: row.sourceHash, schemaVersion: 1, source: OPERATIONS_SOURCE,
          lastImportRunId: value.payload.importRunId, serviceDate: row.serviceDate, periodKey: row.serviceDate.slice(0, 7),
          normalizedStatus: row._record.normalizedStatus, processingStatus: 'needs_review',
          reviewReasonCode: row.reasonCode || 'raw_only_not_wash_eligible', recognitionEligibility: null, recognitionReason: null,
          operationalWorkerId: row.bikerId, updatedAtIso: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        row.bookingSaved = true;
      }
      if (row.outcome === 'needs_review') tx.set(db.collection(COL.VARIANCES).doc(row.rawId), {
        kind: 'operational_sync_review', sspBookingId: row.sspBookingId, rawId: row.rawId,
        importRunId: value.payload.importRunId, reasonCode: row.reasonCode, resolution: 'unresolved', detectedAtIso: now });
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
    const bookingSnap = row.bookingId ? await db.collection(COL.BOOKINGS).doc(row.bookingId).get() : null;
    const booking = bookingSnap?.exists ? bookingSnap.data() : null;
    const washSnap = row.washId ? await db.collection('washes').doc(row.washId).get() : null;
    const wash = washSnap?.exists ? washSnap.data() : null;
    const claimSnap = await db.collection(CLAIMS).doc(bookingDocId(row.bookingNumber)).get();
    const claim = claimSnap.exists ? claimSnap.data() : null;
    const linkChecks = await Promise.all((row.existingLinkRefs ?? []).map(async link => {
      const current = await db.collection(link.collection).doc(link.id).get();
      return { collection: link.collection, id: link.id, unchanged: current.exists && hashBody(current.data()) === link.hash };
    }));
    return { sspBookingId: row.sspBookingId, rawVerified, bookingId: row.bookingId,
      currentBookingMatches: booking?.sourceHash === row.sourceHash && Boolean(booking?.record)
        && hashRecord(booking.record) === row.sourceHash,
      currentWorkerId: booking?.operationalWorkerId ?? null,
      currentNaturalClaimMatches: claim?.sspBookingId === row.sspBookingId,
      existingLinks: linkChecks,
      washId: row.washId, existingWashVerified: row.washId ? identityOf(wash ?? {}) === row.bookingNumber : null,
      washCreated: false };
  }));
  const rawVerified = verification.every(r => r.notSaved || r.rawVerified);
  const linksVerified = verification.every((r, i) => r.notSaved || (
    (!run.result.rows[i].bookingMustMatch || r.currentBookingMatches)
    && (!run.result.rows[i].bookingSaved || r.currentNaturalClaimMatches)
    && r.existingLinks.every(link => link.unchanged) && r.existingWashVerified !== false));
  return { found: true, importRunId: payload.importRunId, verified: rawVerified && linksVerified,
    rawVerified, linksVerified,
    status: run.status, payloadHash: run.payloadHash, coverage: run.coverage, result: run.result, verification };
}
