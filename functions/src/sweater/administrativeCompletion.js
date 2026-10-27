import { reviewAdministrativeCompletion, ADMIN_COMPLETION_WARNING, isApprovedMissingStartCompletion, isApprovedOngoingCompletion } from '../../../src/lib/sweater/administrativeCompletion.js';
import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';
import { COL, bookingDocId, rawDocId, SweaterIngestError } from './ingest.js';
import { hashBody, hashRecord, normalizeRecord } from './record.js';
import { executionWash } from './operationsExecution.js';
import { WASH_COMMISSION_EFFECTIVE_MONTH } from '../washCommission.js';

export const ADMIN_COMPLETION_SOURCE = 'staff_owner_administrative_completion_v1';
const CLAIMS = 'sweater_owner_booking_claims', LINKS = 'sweater_operational_wash_links';
const collections = ['washes', COL.BOOKINGS, 'sweater_owner_collection_confirmations', LINKS, 'sweater_booking_links'];
const fail = (message, code = 'failed-precondition') => { throw new SweaterIngestError(message, { code }); };
const publicRow = row => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_')));
const identity = row => ownerBookingIdentity(row.ssp_booking_id || row.sspBookingId || row.record?.sspBookingId || row.bookingNumber || '');
function validated(payload) {
  const review = reviewAdministrativeCompletion(payload);
  if (!review.ready) throw new SweaterIngestError('ملف قرار الاكتمال الإداري غير جاهز.', { code: 'invalid-argument', details: { errors: review.errors, rows: review.rows } });
  return payload;
}
async function plan(db, payload, read, actor) {
  validated(payload);
  // Re-read actual membership, including on transactional retries. Never trust a payload role.
  const [member, marker] = await Promise.all([read(db.collection('users').doc(actor)), read(db.collection('app_admins').doc(actor))]);
  const role = member.data()?.role;
  if (!(role === 'admin' || (marker.exists && (!member.exists || ['accountant', 'operator', 'partner'].includes(role))))) fail('قرار الاكتمال الإداري للمدير فقط.', 'permission-denied');
  const runRef = db.collection(COL.RUNS).doc(payload.importRunId), payloadHash = hashBody(payload), runSnap = await read(runRef), run = runSnap.data();
  if (run && (run.source !== ADMIN_COMPLETION_SOURCE || run.payloadHash !== payloadHash || !run.result)) fail('معرف الدفعة مستخدم بمحتوى أو مسار مختلف.', 'already-exists');
  if (run) return { run, runRef, payloadHash };
  const period = payload.decision.serviceDate.slice(0,7);
  if (period < WASH_COMMISSION_EFFECTIVE_MONTH || payload.decision.serviceDate > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())) fail('تاريخ القرار خارج سياسة العمولة القائمة أو في المستقبل.');
  const [periodSnap, settlementSnap, ...snaps] = await Promise.all([
    read(db.collection('accounting_periods').doc(period)), read(db.collection('sweater_settlements').doc(period)), ...collections.map(c => read(db.collection(c))),
  ]);
  if (periodSnap.data()?.status === 'closed' || settlementSnap.data()?.journalEntryId || settlementSnap.data()?.postedEntryId
    || ['approved', 'invoiced', 'partially_collected', 'collected', 'closed'].includes(settlementSnap.data()?.status)) fail('الفترة أو تسوية الشهر محمية؛ لا تُضاف غسلات بهذا المسار.');
  const docs = snaps.flatMap((s,i) => s.docs.map(d => ({ collection: collections[i], id: d.id, data: d.data() })));
  const rows = [], state = [], counts = { new: 0, modified: 0, duplicate: 0, rejected: 0, needsReview: 0 };
  for (const raw of payload.records) {
    const record = normalizeRecord(raw), number = ownerBookingIdentity(record.sspBookingId), id = bookingDocId(record.sspBookingId), washId = `ssp__${id}`;
    const related = docs.filter(d => identity(d.data) === number), booking = related.find(d => d.collection === COL.BOOKINGS && d.id === id)?.data;
    const claimRef = db.collection(CLAIMS).doc(bookingDocId(number)), claim = (await read(claimRef)).data();
    const bikerId = payload.workerLinks[record.driverExternalId], worker = (await read(db.collection('bikers').doc(bikerId))).data();
    const linkedWorkers = new Set(docs.filter(d => d.collection === 'washes' && d.data.driver_external_id === record.driverExternalId).map(d => d.data.biker_id).filter(Boolean));
    const workerOK = Boolean(worker?.name && (worker.driver_external_id === record.driverExternalId || linkedWorkers.has(bikerId)) && linkedWorkers.size <= 1
      && (!worker.start_date || worker.start_date <= record.serviceDate) && (!worker.end_date || worker.end_date >= record.serviceDate));
    const decision = { ...payload.decision, sspBookingId: record.sspBookingId, bookingNumber: number, driverExternalId: record.driverExternalId, rawStatus: record.rawStatus };
    const wash = { ...executionWash(record, bikerId, worker?.name || ''), ssp_booking_number: number, ssp_raw_status: record.rawStatus,
      owner_completion_decision: decision, completion_basis: 'owner_administrative_decision' };
    const hash = hashBody(wash), existingWash = related.find(d => d.collection === 'washes' && d.id === washId)?.data;
    const expectedLinks = [`b__${id}`, `w__${encodeURIComponent(washId)}`];
    const foreignRelated = related.some(d => (d.data.ssp_booking_id || d.data.sspBookingId || d.data.record?.sspBookingId) !== record.sspBookingId
      || d.collection === 'sweater_owner_collection_confirmations' || d.collection === 'sweater_booking_links'
      || (d.collection === 'washes' && d.id !== washId)
      || (d.collection === LINKS && (!expectedLinks.includes(d.id) || d.data.washId !== washId)));
    const protectedBooking = Boolean(booking && (booking.postedEntryId || booking.postedAt || booking.settlementId || booking.ownerCollectionConfirmation
      || booking.financialLock || booking.locked || booking.lockedAt || ['posted','ready_for_posting','matched'].includes(booking.processingStatus)
      || (booking.ownerCompletionDecision && hashBody(booking.ownerCompletionDecision) !== hashBody(decision))
      || (booking.source !== 'operations_sync_v2' && booking.source !== ADMIN_COMPLETION_SOURCE)
      || ['sspBookingId', 'serviceDate', 'driverExternalId', 'rawStatus'].some(k => booking.record?.[k] !== record[k])
      || ['startedAt', 'completedAt'].some(k => booking.record?.[k] != null && record[k] != null && booking.record[k] !== record[k])));
    // This one-time missing-start decision must match the already observed source
    // and its verified worker. It may not seed new evidence or erase a real Start.
    const missingStartEvidenceConflict = isApprovedMissingStartCompletion(payload, raw) && (!booking
      || booking.source !== 'operations_sync_v2' || booking.operationalWorkerId !== bikerId
      || booking.record?.startedAt !== null
      || ['sspBookingId', 'serviceDate', 'driverExternalId', 'rawStatus', 'completedAt', 'serviceType'].some(k => booking.record?.[k] !== record[k]));
    // An ongoing decision must attach to the already saved, worker-linked
    // actual Start observation. A caller cannot seed or rewrite source facts.
    const ongoingEvidenceConflict = isApprovedOngoingCompletion(payload, raw) && (!booking
      || booking.source !== 'operations_sync_v2' || booking.operationalWorkerId !== bikerId
      || ['sspBookingId', 'serviceDate', 'driverExternalId', 'rawStatus', 'startedAt', 'completedAt', 'serviceType'].some(k => booking.record?.[k] !== record[k]));
    const existingMatches = existingWash && existingWash.administrativeWashHash === hash && Object.entries(wash).every(([k,v]) => hashBody(existingWash[k]) === hashBody(v));
    const conflict = !workerOK || foreignRelated || protectedBooking || missingStartEvidenceConflict || ongoingEvidenceConflict || (existingWash && !existingMatches)
      || (claim && (claim.sspBookingId !== record.sspBookingId || claim.washId !== washId))
      || Boolean(existingWash) !== Boolean(booking?.ownerCompletionDecision);
    const outcome = conflict ? 'needs_review' : existingWash ? 'duplicate' : booking ? 'modified' : 'new';
    counts[outcome === 'needs_review' ? 'needsReview' : outcome]++;
    const links = related.filter(d => d.collection === LINKS);
    const row = { sspBookingId: record.sspBookingId, bookingNumber: number, washId, bikerId, bikerName: worker?.name || '', serviceDate: record.serviceDate,
      rawStatus: record.rawStatus, normalizedStatus: record.normalizedStatus, collectionStatus: 'pending', outcome,
      reasonAr: conflict ? 'تعارض في الهوية أو العامل أو سجل محمي؛ لا يُستبدل الموجود.' : 'قرار اكتمال إداري مستقل؛ التحصيل غير مثبت.',
      assertedAmount: wash.net_amount, vatAmount: wash.vat_amount, grossAmount: wash.gross_amount, workerCommission: wash.worker_commission_per_wash,
      _raw: raw, _record: record, _decision: decision, _wash: wash, _washHash: hash, _claimRef: claimRef, _claim: claim,
      _bookingRef: db.collection(COL.BOOKINGS).doc(id), _booking: booking, _washRef: db.collection('washes').doc(washId), _links: links, _existingWash: existingWash };
    rows.push(row); state.push({ number, related, claim, worker, period: periodSnap.data() || null, settlement: settlementSnap.data() || null });
  }
  return { runRef, payloadHash, rows, counts, stateHash: hashBody(state) };
}
function resultFor(value, payload) {
  if (value.run) return { ...value.run.result, saved: false, dryRun: true, replay: true, previousRun: { sameRecords: true, status: value.run.status } };
  return { importRunId: payload.importRunId, dryRun: true, saved: false, replay: false, canSave: value.counts.needsReview === 0,
    reviewedPayloadHash: value.payloadHash, previewStateHash: value.stateHash, counts: value.counts, rows: value.rows.map(publicRow),
    coverage: payload.coverage, coverageIssues: [], reviewWarnings: [ADMIN_COMPLETION_WARNING], administrativeDecision: payload.decision, ledgerPosted: false, payrollPaid: false };
}
export async function previewAdministrativeCompletion(db, payload, actor) { return resultFor(await plan(db, payload, r => r.get(), actor), payload); }
export async function saveAdministrativeCompletion(db, FieldValue, request, actor) {
  if (!request || Object.keys(request).some(k => !['payload','reviewedPayloadHash','previewStateHash'].includes(k))) fail('حقول طلب الحفظ غير مسموحة.', 'invalid-argument');
  validated(request.payload);
  if (hashBody(request.payload) !== request.reviewedPayloadHash || !/^[a-f0-9]{64}$/.test(request.previewStateHash || '')) fail('معاينة الملف نفسه مطلوبة.', 'invalid-argument');
  return db.runTransaction(async tx => {
    const p = request.payload, v = await plan(db, p, r => tx.get(r), actor);
    if (v.run) return { ...v.run.result, replay: true };
    if (v.counts.needsReview || v.stateHash !== request.previewStateHash) fail('تعارض أو تغير منذ المعاينة؛ أعد المعاينة دون استبدال الموجود.');
    const now = new Date().toISOString();
    for (const r of v.rows) {
      if (r.outcome === 'duplicate') continue;
      if (!r._claim) tx.set(r._claimRef, { bookingNumber: r.bookingNumber, sspBookingId: r.sspBookingId, washId: r.washId, source: ADMIN_COMPLETION_SOURCE,
        importRunId: p.importRunId, claimedBy: actor, claimedAt: FieldValue.serverTimestamp() });
      tx.set(r._washRef, { ...r._wash, administrativeWashHash: r._washHash, created_at: now, import_run_id: p.importRunId, created_by: actor });
      tx.set(db.collection(COL.RAW).doc(rawDocId(p.importRunId, r.sspBookingId)), { importRunId: p.importRunId, sspBookingId: r.sspBookingId,
        source: ADMIN_COMPLETION_SOURCE, rawPayload: r._raw, normalizedRecord: r._record, sourceHash: hashRecord(r._record), fetchedAtIso: p.coverage.extractedAt, recordedAtIso: now, actor });
      tx.set(r._bookingRef, { ...(!r._booking ? { sspBookingId: r.sspBookingId, bookingNumber: r.bookingNumber, record: r._record, sourceHash: hashRecord(r._record),
        source: ADMIN_COMPLETION_SOURCE, lastImportRunId: p.importRunId, serviceDate: r.serviceDate, periodKey: r.serviceDate.slice(0,7),
        normalizedStatus: r.normalizedStatus, processingStatus: 'needs_review', recognitionEligibility: null, recognitionReason: null } : {}),
        ownerCompletionDecision: r._decision, administrativeCompletionRunId: p.importRunId, updatedAtIso: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      for (const [key, side] of [[`b__${bookingDocId(r.sspBookingId)}`, 'booking'], [`w__${encodeURIComponent(r.washId)}`, 'wash']]) {
        if (!r._links.some(l => l.id === key)) tx.set(db.collection(LINKS).doc(key), { washId: r.washId, sspBookingId: r.sspBookingId, side, linkedBy: actor, linkedAtIso: now, linkedAt: FieldValue.serverTimestamp() });
      }
    }
    const result = { ...resultFor(v,p), dryRun: false, saved: true, washIds: v.rows.map(r => r.washId), washesCreated: v.rows.filter(r => r.outcome !== 'duplicate').length };
    tx.set(v.runRef, { importRunId: p.importRunId, source: ADMIN_COMPLETION_SOURCE, payloadHash: v.payloadHash, status: 'completed_with_gaps',
      actor, coverage: p.coverage, decision: p.decision, recordCount: p.records.length, startedAtIso: now, finishedAtIso: now, result });
    tx.set(db.collection('audit_logs').doc(), { action: 'owner-administrative-completion', collectionName: COL.RUNS, documentId: p.importRunId,
      userId: actor, reason: p.decision.statement, after: { decision: p.decision, washIds: result.washIds, washesCreated: result.washesCreated, ledgerPosted: false, collectionConfirmed: false }, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
}
