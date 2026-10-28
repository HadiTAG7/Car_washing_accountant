// Internal source-event follow-up in the existing admin-only case store.
// Never a payroll adjustment, settlement adjustment, payment or journal entry.
import { createHash } from 'node:crypto';
import { LedgerError } from './ledger.js';
import { hashBody } from './sweater/record.js';
import { SWEATER_METRICS } from './sweater/metricsContract.js';
import { composeSweaterMetricReadings } from '../../src/lib/sweaterMetricReadings.js';
import { bikerDeductionIdentity, BIKER_DEDUCTION_TYPE, BIKER_DEDUCTION_AUTHORITY, isBikerDeduction } from '../../src/lib/sweater/bikerDeductions.js';
import { qualityObjectionId } from './qualityObjections.js';
import { COL, bookingDocId, rawDocId } from './sweater/ingest.js';
import { hashRecord } from './sweater/record.js';
import { compensationGroup } from './sweater/compensationEvents.js';
import { COMPENSATION_KEYS } from './sweater/metricsContract.js';
import { bookingInvoiceDeduction } from './sweater/bookingInvoiceDeduction.js';
import { deductionBookingBinding } from './sweater/deductionBookingBinding.js';

const COLLECTION = 'quality_objections', CAP = 10000;
const fail = (message, code = 'failed-precondition') => { throw new LedgerError(message, { code }); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,159}$/.test(v);
const hex = v => /^[a-f0-9]{64}$/.test(v || '');
const text = v => typeof v === 'string' && v.trim().length >= 3 && v.length <= 1000;
const fields = ['sourceKind', 'periodKey', 'metricKey', 'sourceId', 'snapshotId', 'bikerId', 'expectedRevision', 'reason', 'decisionReference'];
const rows = snap => snap.docs.map(d => ({ ...d.data(), id: d.id }));
const protectedRecord = v => v && (v.locked || v.financialLock || v.lockedAt || v.appliedAt || v.payrollApplied || v.ledgerPosted
  || v.payrollRunId || v.paymentId || v.journalEntryId
  || ['applied', 'paid', 'posted', 'closed'].includes(v.status));
function validate(input) {
  if (!exact(input, fields) || !['metrics', 'booking'].includes(input.sourceKind) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.periodKey)
    || !['violations', 'damages', 'compensations', 'cancelledByBiker'].includes(input.metricKey)
    || ![input.sourceId, input.snapshotId, input.bikerId].every(id)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || !text(input.reason) || input.decisionReference !== BIKER_DEDUCTION_AUTHORITY) fail('بيانات إسناد خصم سويتر أو مرجع قرار هادي غير صحيحة.', 'invalid-argument');
}
async function bounded(read, db, name, query = db.collection(name)) {
  const result = rows(await read(query.limit(CAP)));
  if (result.length >= CAP) fail('لم تكتمل تغطية فحص التكرار؛ الحفظ متوقف.');
  return result;
}
async function plan(db, input, read, userId) {
  validate(input);
  const [member, marker] = await Promise.all([read(db.collection('users').doc(userId)), read(db.collection('app_admins').doc(userId))]);
  const role = member.data()?.role;
  if (role !== 'admin' && !(marker.exists && (!member.exists || ['operator', 'partner'].includes(role)))) fail('إسناد خصم سويتر للمدير فقط.', 'permission-denied');
  const [readings, workers, cases, period, settlement, payrollPeriod] = await Promise.all([
    bounded(read, db, 'sweater_metric_snapshots', db.collection('sweater_metric_snapshots').where('periodKey', '==', input.periodKey)),
    bounded(read, db, 'bikers'), bounded(read, db, COLLECTION),
    read(db.collection('accounting_periods').doc(input.periodKey)), read(db.collection('sweater_settlements').doc(input.periodKey)),
    read(db.collection('payroll_periods').doc(input.periodKey)),
  ]);
  const snapshot = composeSweaterMetricReadings(readings, input.periodKey);
  const group = snapshot?.eventGroups?.[input.metricKey];
  let event = group?.rows.find(r => r.sourceId === input.sourceId), sourceReadAt = snapshot?.metricSources?.[input.metricKey]?.extractedAtIso;
  let bookingEvidence = null;
  if (input.sourceKind === 'metrics') {
    if (!event || snapshot.metricSources[input.metricKey].snapshotId !== input.snapshotId) fail('تفاصيل الواقعة غير متاحة في القراءة الحالية؛ لا يكفي مجموع الشهر.', 'aborted');
  } else {
    // Narrow owner-approved retrospective classification. The booking reason
    // is evidence, not a claim that Compensations matched or charged money.
    if (input.metricKey !== 'cancelledByBiker') fail('تصنيف الحجز بقرار هادي للإلغاء بسبب البايكر فقط.');
    const [rawSnap, bookingSnap, runSnap] = await Promise.all([
      read(db.collection(COL.RAW).doc(rawDocId(input.snapshotId, input.sourceId))),
      read(db.collection(COL.BOOKINGS).doc(bookingDocId(input.sourceId))), read(db.collection(COL.RUNS).doc(input.snapshotId)),
    ]);
    const raw = rawSnap.data(), booking = bookingSnap.data(), run = runSnap.data(), record = raw?.normalizedRecord;
    const reason = record?.notes?.match(/\nReason\n([^;]+);/)?.[1]?.trim();
    const verifiedRow = run?.result?.rows?.find(r => r.sspBookingId === input.sourceId && r.rawSaved === true
      && r.sourceHash === raw?.sourceHash && r.rawId === rawSnap.id);
    if (raw?.source !== 'operations_sync_v2' || !record || raw.importRunId !== input.snapshotId
      || record.sspBookingId !== input.sourceId || raw.sourceHash !== hashRecord(record)
      || run?.source !== 'operations_sync_v2' || !verifiedRow || !['completed', 'completed_with_gaps'].includes(run?.status)
      || !['Biker Refused Wash', 'Biker delay caused cancellation or postponement'].includes(reason)
      || !['Cancelled by Admin', 'Cancelled by Biker'].includes(record.rawStatus)
      || record.serviceDate?.slice(0, 7) !== input.periodKey || !run.coverage?.extractedAt) fail('لا يوجد سبب بايكر صريح محفوظ ومطابق للقراءة الخام؛ لا يُستنتج من حالة الإلغاء وحدها.');
    const binding = await deductionBookingBinding(db, read, { booking, record, verifiedRow, isProtected: protectedRecord });
    if (!binding) fail('الحجز الحالي أو روابطه المحمية لا تطابق دليل الخصم؛ لن نغيّر السجل القديم.');
    let invoice;
    try { invoice = bookingInvoiceDeduction(record, reason, run.coverage.extractedAt); }
    catch (error) { fail(error.message); }
    event = { metricKey: input.metricKey, sourceId: input.sourceId, bookingId: record.sspBookingId,
      date: record.serviceDate, time: record.serviceTime || null, driverExternalId: record.driverExternalId,
      reason, quantity: 1, amount: invoice ? -invoice.signedDeductionSAR : null, sourceUrl: record.sourceUrl };
    sourceReadAt = invoice?.sourceReadAt || run.coverage.extractedAt;
    bookingEvidence = { rawId: rawSnap.id, rawSourceHash: raw.sourceHash, rawStatus: record.rawStatus,
      notes: record.notes, invoice, binding, workerId: verifiedRow.bikerId && verifiedRow.bikerId === booking.operationalWorkerId ? verifiedRow.bikerId : null,
      classificationBasis: 'owner_decision_from_explicit_booking_reason', matchedToCompensations: false };
  }
  if (!event.date || event.date < '2026-08-29' || event.date > '2026-10-28' || !event.reason?.trim()) fail('الواقعة خارج الفترة المفوضة أو ينقصها تاريخ أو سبب المصدر.');
  const unit = SWEATER_METRICS[input.metricKey].unit;
  if (unit === 'sar' && (event.amount == null || !Number.isFinite(event.amount) || event.amount <= 0)) fail('لا يوجد مبلغ خصم فعلي موجب من سويتر؛ المفقود ليس صفرًا.');
  if (unit === 'count' && event.quantity !== 1) fail('إلغاء الحجز يحتاج واقعة عددية واحدة مثبتة.');
  const matches = workers.filter(w => w.driver_external_id && String(w.driver_external_id) === event.driverExternalId);
  const establishedWorker = matches.length === 0 && bookingEvidence?.workerId === input.bikerId
    ? workers.find(w => w.id === input.bikerId && !w.driver_external_id) : null;
  const worker = matches.length === 1 && matches[0].id === input.bikerId ? matches[0] : establishedWorker;
  if (!worker?.name || (worker.start_date && worker.start_date > event.date) || (worker.end_date && worker.end_date < event.date)) fail('ربط العامل غير محسوم أو خارج فترة عمله؛ لا يُسند الخصم بالاسم فقط.');
  const eventIdentity = bikerDeductionIdentity(event);
  if (!eventIdentity) fail('لا توجد هوية طبيعية ثابتة للواقعة.');
  const documentId = `biker-deduction-${createHash('sha256').update(eventIdentity).digest('hex')}`;
  const ref = db.collection(COLLECTION).doc(documentId), old = (await read(ref)).data() || null;
  if (old && (!isBikerDeduction(old) || old.eventIdentity !== eventIdentity)) fail('هوية الواقعة محجوزة لمسار آخر.');
  // Same-booking monetary incidents may be legitimate distinct events. A
  // changed ID with otherwise identical facts is ambiguous, never auto-added.
  const duplicates = cases.filter(c => isBikerDeduction(c) && c.id !== documentId && (c.eventIdentity === eventIdentity
    || (unit === 'sar' && c.event?.metricKey === event.metricKey && c.event?.bookingId === event.bookingId
      && c.event?.date === event.date && c.event?.driverExternalId === event.driverExternalId
      && c.event?.reason === event.reason && c.event?.amount === event.amount)));
  if (duplicates.length) fail('توجد واقعة مطابقة بهوية مصدر أخرى؛ يلزم توضيح المصدر قبل إضافة خصم.');
  const runId = payrollPeriod.data()?.currentRunId;
  const run = runId ? (await read(db.collection('payroll_runs').doc(runId))).data() : null;
  const items = runId ? await bounded(read, db, 'payroll_runs', db.collection('payroll_runs').doc(runId).collection('items')) : [];
  const objection = cases.find(c => c.id === qualityObjectionId(input.periodKey, input.metricKey, input.sourceId));
  const sourceAliases = readings.flatMap(r => COMPENSATION_KEYS.flatMap(key => (compensationGroup(r, key)?.rows || [])))
    .filter(r => bikerDeductionIdentity(r) === eventIdentity);
  const acceptedObjection = cases.some(c => !isBikerDeduction(c) && c.status === 'accepted'
    && sourceAliases.some(r => c.metricKey === r.metricKey && c.sourceId === r.sourceId));
  const locked = Boolean(protectedRecord(old) || protectedRecord(old?.current) || period.data()?.status === 'closed'
    || settlement.data()?.journalEntryId || settlement.data()?.postedEntryId
    || ['approved', 'invoiced', 'partially_collected', 'collected', 'closed'].includes(settlement.data()?.status)
    || ['approved', 'partially_paid', 'paid'].includes(run?.status) || items.some(i => [worker.id, old?.bikerId].includes(i.bikerId) && i.status === 'paid')
    || objection?.status === 'accepted' || acceptedObjection);
  const candidate = { recordType: BIKER_DEDUCTION_TYPE, eventIdentity, periodKey: input.periodKey, metricKey: input.metricKey,
    sourceKind: input.sourceKind, sourceId: input.sourceId, snapshotId: input.snapshotId, sourceHash: hashBody(event), sourceReadAt,
    bookingEvidence, matchedToCompensations: input.sourceKind === 'metrics', reconciliationStatus: input.sourceKind === 'metrics' ? 'matched' : 'awaiting_compensations_details',
    event, bikerId: worker.id, bikerName: worker.name, unit, quantity: event.quantity, amountSAR: event.amount,
    reason: input.reason.trim(), decisionReference: input.decisionReference, status: 'recorded', payrollApplied: false, ledgerPosted: false };
  const equivalent = old && hashBody(old.current) === hashBody(candidate);
  const currentRevision = old?.revision || 0;
  const stateHash = hashBody({ readings, workers, cases, period: period.data() || null, settlement: settlement.data() || null,
    payrollPeriod: payrollPeriod.data() || null, run: run || null, items, bookingEvidence });
  return { ref, documentId, old, candidate, equivalent, locked, currentRevision, stateHash,
    actorName: member.data()?.displayName || userId, revisionMatches: input.expectedRevision === currentRevision };
}
function view(p) {
  return { id: p.documentId, dryRun: true, saved: false, canSave: !p.locked && p.revisionMatches && !p.equivalent,
    locked: p.locked, duplicate: Boolean(p.equivalent), revision: p.currentRevision, reviewedPayloadHash: null, previewStateHash: p.stateHash,
    proposed: p.candidate, current: p.old?.current || null,
    warning: p.locked ? 'الفترة أو المسير أو الواقعة محمية، أو الاعتراض مقبول؛ الحفظ متوقف.' : !p.revisionMatches ? 'تغيّر سجل الواقعة؛ أعد القراءة.'
      : p.equivalent ? 'الواقعة مسجلة أصلًا؛ لن يضاف خصم آخر.' : 'إسناد تشغيلي فقط؛ لا يخصم راتبًا ولا ينشئ قيدًا أو تسوية شركة.' };
}
export async function previewBikerDeduction(db, input, { userId } = {}) {
  return db.runTransaction(async tx => {
    const p = await plan(db, input, r => tx.get(r), userId);
    return { ...view(p), reviewedPayloadHash: hashBody(input) };
  });
}
export async function saveBikerDeduction(db, FieldValue, request, { userId, now = new Date() } = {}) {
  if (!exact(request, ['payload', 'reviewedPayloadHash', 'previewStateHash', 'requestId']) || !id(request.requestId)
    || !hex(request.reviewedPayloadHash) || !hex(request.previewStateHash) || hashBody(request.payload) !== request.reviewedPayloadHash) fail('معاينة مطابقة ومفتاح طلب ثابت مطلوبان.', 'invalid-argument');
  return db.runTransaction(async tx => {
    const p = await plan(db, request.payload, r => tx.get(r), userId);
    const previous = p.old?.history?.find(h => h.requestId === request.requestId);
    if (previous) {
      if (previous.payloadHash !== request.reviewedPayloadHash) fail('مفتاح الطلب مستخدم بمحتوى مختلف.', 'already-exists');
      return { ...view(p), replay: true, saved: false, canSave: false, verification: { currentMatchesSource: p.old.current.sourceHash === p.candidate.sourceHash,
        currentRevision: p.currentRevision, requestRevision: previous.revision }, record: p.old };
    }
    if (p.equivalent) return { ...view(p), saved: false, canSave: false, record: p.old };
    if (p.locked || !p.revisionMatches || request.previewStateHash !== p.stateHash) fail('تعارض أو حماية أو تغيّر منذ المعاينة؛ لا يُستبدل السجل.', 'aborted');
    if ((p.old?.history?.length || 0) >= 100) fail('وصل سجل التصحيحات للحد؛ يلزم مراجعة منفصلة دون حذف التاريخ.');
    if (p.old && p.old.periodKey !== request.payload.periodKey) fail('تغيّر شهر الواقعة؛ يلزم مراجعة منفصلة تحافظ على الشهر الأصلي.');
    const revision = p.currentRevision + 1, atIso = now.toISOString();
    const history = [...(p.old?.history || []), { revision, requestId: request.requestId, payloadHash: request.reviewedPayloadHash,
      before: p.old?.current || null, after: p.candidate, userId, atIso }];
    const record = { ...p.candidate, original: p.old?.original || p.candidate, current: p.candidate, history, revision,
      updatedBy: userId, updatedByName: p.actorName, updatedAtIso: atIso };
    tx.set(p.ref, record);
    // Shared audit contains revisions only. Worker/source/private reason remain admin-only.
    tx.set(db.collection('audit_logs').doc(`${p.documentId}__${revision}`), { action: 'source-biker-deduction', collectionName: COLLECTION,
      documentId: p.documentId, userId, atIso, createdAt: FieldValue.serverTimestamp(), before: { revision: p.currentRevision }, after: { revision } });
    return { saved: true, replay: false, canSave: false, id: p.documentId, record, ledgerPosted: false, payrollApplied: false };
  });
}

export async function readBikerDeduction(db, input, { userId } = {}) {
  if (!exact(input, ['id']) || !/^biker-deduction-[a-f0-9]{64}$/.test(input.id || '')) fail('معرف واقعة الخصم غير صحيح.', 'invalid-argument');
  return db.runTransaction(async tx => {
    const [member, marker] = await Promise.all([tx.get(db.collection('users').doc(userId)), tx.get(db.collection('app_admins').doc(userId))]);
    const role = member.data()?.role;
    if (role !== 'admin' && !(marker.exists && (!member.exists || ['operator', 'partner'].includes(role)))) fail('قراءة إسناد الخصم للمدير فقط.', 'permission-denied');
    const snap = await tx.get(db.collection(COLLECTION).doc(input.id));
    if (!snap.exists || !isBikerDeduction(snap.data())) fail('واقعة الخصم غير موجودة.', 'not-found');
    return { id: snap.id, record: snap.data(), dryRun: true, saved: false };
  });
}
