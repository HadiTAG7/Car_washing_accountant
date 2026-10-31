// ═══════════════════════════════════════════════════════════════════════════
// توحيد حجوزات سويتر برقمها — إجراء مرة واحدة بموافقة المدير
// ═══════════════════════════════════════════════════════════════════════════
// سويتر يعرض الحجز نفسه ببادئة تتغيّر مع حالته: B- قيد التنفيذ، S- منجز،
// C- ملغى. الكاتب القديم حفظ كل بادئة حجزًا مستقلًا، فصار للرقم الواحد نسختان.
// هذا الإجراء يجمع نسخ كل رقم في حجز واحد مفتاحه الرقم، بآخر قراءة من سويتر،
// ويعيد حساب حالة المراجعة، ويُغلق فروق المزامنة القديمة (فرق لكل دفعة) ويفتح
// فرقًا واحدًا لكل حجز يحتاج قرارًا فعلًا. لا يمس غسلة ولا ربطًا ولا قيدًا.
//
// ── ما لا يتغير ──
// حجز عليه قرار مالك أو تأكيد تحصيل أو كتبه مسار آخر يبقى سجله كما تركه
// المالك؛ وإن خالفته قراءة سويتر الأحدث في حقيقة جوهرية يُفتح له فرق للمالك.
// حجز مرحّل أو في تسوية يُترك كما هو ويُذكر في المعاينة. وكل نسخة تُطوى
// تُحفظ كاملة في سجل التدقيق (من، متى، السبب، المصدر).
// ═══════════════════════════════════════════════════════════════════════════

import { hashBody, hashRecord } from './record.js';
import { COL, SweaterIngestError } from './ingest.js';
import { normalizeServiceType, FULL_WASH_SERVICE } from './vocab.js';
import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';
import { executionEligibility } from './operationsExecution.js';
import { OPERATIONS_SOURCE, REVIEW, ASSERTIONS, bookingReviewState, financialProtection, lockedFinancially, sourceStillOpen,
  materialConflicts, operationsVarianceId, latestObservationOf } from './operationsSync.js';
import { identityReference } from './operationsIdentity5596423.js';

export const CLEANUP_STATE_ID = 'bookingIdentityCleanup';
export const SERVICE_FILL_SOURCE = 'Sweater Business Dashboard › Biker Bookings and Tips Report';
const AUDIT = 'audit_logs', CLAIMS = 'sweater_owner_booking_claims';
const MAX_WRITES = 450; // one atomic transaction per chunk, inside Firestore's 500
const fail = (message, code = 'failed-precondition') => { throw new SweaterIngestError(message, { code }); };
const numberOf = (data, id) => ownerBookingIdentity(data?.sspBookingId || data?.ssp_booking_id || data?.record?.sspBookingId || id || '');
const isNumber = value => /^\d+$/.test(String(value));
const time = value => { const t = Date.parse(value ?? ''); return Number.isFinite(t) ? t : -Infinity; };
const FINAL_RANK = { payment_collection: 2, admin_cancelled: 2 };
const withService = record => ({ ...record, serviceType: normalizeServiceType(record?.serviceType) });

async function loadAll(db, read) {
  const names = [COL.BOOKINGS, COL.RAW, COL.RUNS, COL.VARIANCES, 'washes', 'bikers', CLAIMS, ...ASSERTIONS];
  const snaps = await Promise.all(names.map(name => read(db.collection(name))));
  return Object.fromEntries(names.map((name, i) => [name, snaps[i].docs.map(d => ({ id: d.id, data: d.data() }))]));
}

/** Every reading of a number Sweater gave us, newest last: raw observations and the records the copies hold. */
function observationsOf(number, copies, rawsByNumber, runs) {
  const extractedAt = runId => runs.get(runId)?.coverage?.extractedAt ?? null;
  const fromRaws = (rawsByNumber.get(number) ?? []).filter(r => r.data.source === OPERATIONS_SOURCE && r.data.normalizedRecord)
    .map(r => ({ record: withService(r.data.normalizedRecord), observedAt: extractedAt(r.data.importRunId) ?? r.data.fetchedAtIso ?? null,
      runId: r.data.importRunId ?? null, rawId: r.id, savedAt: r.data.fetchedAtIso ?? null, exact: r.data.normalizedRecord }));
  const fromCopies = copies.filter(c => c.data.record).map(c => ({ record: withService(c.data.record),
    observedAt: c.data.observedAtIso ?? extractedAt(c.data.lastImportRunId) ?? c.data.updatedAtIso ?? null,
    runId: c.data.lastImportRunId ?? null, rawId: null, savedAt: c.data.updatedAtIso ?? null }));
  return [...fromRaws, ...fromCopies].sort((a, b) => time(a.observedAt) - time(b.observedAt)
    || (FINAL_RANK[a.record.normalizedStatus] ?? 0) - (FINAL_RANK[b.record.normalizedStatus] ?? 0)
    || time(a.savedAt) - time(b.savedAt));
}

function planNumber({ number, copies, observations, variances, washes, assertions, bikers, claim }) {
  const inputs = { copies: copies.map(c => ({ id: c.id, hash: hashBody(c.data) })),
    variances: variances.map(v => ({ id: v.id, hash: hashBody(v.data) })) };
  const openLegacy = variances.filter(v => v.id !== operationsVarianceId(number) && v.data.resolution === 'unresolved'
    && v.data.kind === 'operational_sync_review');
  const opsVariance = variances.find(v => v.id === operationsVarianceId(number))?.data ?? null;
  if (copies.some(c => lockedFinancially(c.data))) return { number, action: 'skip', why: 'financially_locked', inputs };
  const held = copies.filter(c => financialProtection(c.data) || (c.data.source && c.data.source !== OPERATIONS_SOURCE));
  if (held.length > 1) return { number, action: 'skip', why: 'two_owner_records', inputs };
  if (!copies.length) {
    // Questions left about a number with no booking at all: nothing to decide on any more.
    return openLegacy.length ? { number, action: 'variances', inputs, supersede: openLegacy.map(v => v.id), doc: null } : null;
  }
  const latest = observations.at(-1);
  const keeper = held[0] ?? copies.find(c => c.id === number) ?? copies.find(c => c.data.sspBookingId === latest?.record.sspBookingId)
    ?? [...copies].sort((a, b) => time(b.data.updatedAtIso) - time(a.data.updatedAtIso))[0];
  const aliases = [...new Set([...copies.flatMap(c => [c.data.sspBookingId, ...(c.data.aliases ?? [])]),
    ...observations.map(o => o.record.sspBookingId)].filter(Boolean))].sort();
  // Copies filed apart are removed once folded in; `mergedFrom` keeps every id the booking was ever filed under.
  const drop = copies.map(c => c.id).filter(id => id !== number).sort();
  const mergedFrom = [...new Set([...(keeper.data.mergedFrom ?? []), ...drop])].sort();
  const hasWash = washes.length > 0;
  const { aliases: _aliases, mergedFrom: _merged, identityCleanup: _cleanup, ...kept } = keeper.data;
  let doc, review, conflictFields = [], awaitingPromotion = false;
  if (held.length) {
    // The owner's record stands; a newer reading only matters where it contradicts it.
    conflictFields = latest ? materialConflicts(kept.record, latest.record) : [];
    review = conflictFields.length ? { processingStatus: REVIEW.DECISION, reasonCode: 'protected_existing_record' }
      : { processingStatus: REVIEW.DONE, reasonCode: null };
    doc = { ...kept, bookingNumber: number, aliases,
      ...(latest ? { latestObservation: latestObservationOf(latest.record, { observedAtIso: latest.observedAt, importRunId: latest.runId }) } : {}) };
  } else {
    // Sweater's latest reading, keeping a service an earlier reading already established.
    const known = [...observations].reverse().find(o => o.record.serviceType);
    const record = latest.record.serviceType || !known ? latest.record
      : { ...latest.record, serviceType: known.record.serviceType, serviceTypeLabel: known.record.serviceTypeLabel ?? latest.record.serviceTypeLabel };
    const workerId = kept.operationalWorkerId ?? copies.map(c => c.data.operationalWorkerId).find(Boolean) ?? null;
    const worker = workerId ? bikers.get(workerId) : null;
    const established = Boolean(workerId && worker?.name);
    const execution = executionEligibility(record, { extractedAt: latest.observedAt }, worker);
    const linkedHold = assertions.length > 0 || washes.some(w => financialProtection(w.data));
    review = linkedHold && !hasWash ? { processingStatus: REVIEW.DECISION, reasonCode: 'protected_existing_record' }
      : bookingReviewState({ record, hasWash, established, execution, washMissing: true });
    // A reservation whose execution Sweater has since proven but that never got its wash (the old writer held the
    // first prefix): keep the reservation's last open reading, exactly as read. It stays on the open list, the next
    // sync re-reads it, and the source-proven promotion records the one wash. The cleanup itself never makes one.
    const reservation = review.reasonCode === 'execution_without_wash' && claim?.source === OPERATIONS_SOURCE
      && claim.sspBookingId !== record.sspBookingId
      ? [...observations].reverse().find(o => o.exact && o.record.sspBookingId === claim.sspBookingId && sourceStillOpen(o.exact)
        // Another driver than the execution's is a reassignment: that stays the owner's decision.
        && o.exact.driverExternalId === record.driverExternalId) : null;
    const kept_ = reservation ?? latest, keptRecord = reservation ? reservation.exact : record;
    if (reservation) review = bookingReviewState({ record: keptRecord, established });
    awaitingPromotion = Boolean(reservation);
    doc = { ...kept, sspBookingId: keptRecord.sspBookingId, bookingNumber: number, aliases, record: keptRecord, sourceHash: hashRecord(keptRecord),
      source: OPERATIONS_SOURCE, schemaVersion: kept.schemaVersion ?? 1, serviceDate: keptRecord.serviceDate,
      periodKey: keptRecord.serviceDate?.slice(0, 7) ?? kept.periodKey, normalizedStatus: keptRecord.normalizedStatus,
      operationalWorkerId: workerId, observedAtIso: kept_.observedAt, lastImportRunId: kept_.runId ?? kept.lastImportRunId ?? null };
  }
  doc = { ...doc, processingStatus: review.processingStatus, reviewReasonCode: review.reasonCode, ...(mergedFrom.length ? { mergedFrom } : {}) };
  const unchanged = copies.length === 1 && copies[0].id === number && hashBody(stripCleanup(copies[0].data)) === hashBody(stripCleanup(doc));
  const decision = review.processingStatus === REVIEW.DECISION;
  const supersede = [...openLegacy.map(v => v.id),
    ...(!decision && opsVariance?.resolution === 'unresolved' ? [operationsVarianceId(number)] : [])];
  const openVariance = decision && !(opsVariance?.resolution === 'unresolved' && opsVariance.reasonCode === review.reasonCode
    && opsVariance.sourceHash === doc.sourceHash);
  if (unchanged && !supersede.length && !openVariance) return null;
  return { number, action: unchanged ? 'variances' : 'fold', inputs, doc, review, conflictFields, mergedFrom, drop, supersede, openVariance,
    latest: latest ? { sspBookingId: latest.record.sspBookingId, rawStatus: latest.record.rawStatus, observedAt: latest.observedAt } : null,
    held: held.length > 0, hasWash, copies: copies.map(c => c.id), awaitingPromotion };
}
const stripCleanup = data => { const { identityCleanup: _c, updatedAt: _u, updatedAtIso: _ui, ...rest } = data ?? {}; return rest; };

async function planCleanup(db, read) {
  const all = await loadAll(db, read);
  const group = rows => rows.reduce((map, row) => {
    const n = numberOf(row.data, row.id); if (isNumber(n)) map.set(n, [...(map.get(n) ?? []), row]); return map;
  }, new Map());
  const bookings = group(all[COL.BOOKINGS]), raws = group(all[COL.RAW]);
  const variances = group(all[COL.VARIANCES].filter(v => v.data.kind === 'operational_sync_review' || v.id.startsWith('ops__')));
  const washes = group(all.washes);
  const runs = new Map(all[COL.RUNS].map(r => [r.id, r.data])), bikers = new Map(all.bikers.map(b => [b.id, b.data]));
  const claims = new Map(all[CLAIMS].map(c => [c.id, c.data]));
  const assertionDocs = ASSERTIONS.flatMap(name => all[name]);
  const numbers = [...new Set([...bookings.keys(), ...variances.keys()])].sort((a, b) => Number(a) - Number(b));
  const entries = numbers.map(number => {
    const copies = bookings.get(number) ?? [];
    return planNumber({ number, copies, observations: observationsOf(number, copies, raws, runs),
      variances: variances.get(number) ?? [], washes: washes.get(number) ?? [], bikers, claim: claims.get(number) ?? null,
      assertions: assertionDocs.filter(d => numberOf(d.data, null) === number || identityReference(d.id, number)) });
  }).filter(Boolean);
  const work = entries.filter(e => e.action !== 'skip');
  const count = (fn) => work.filter(fn).length;
  const summary = {
    numbers: work.length, folded: count(e => e.action === 'fold' && e.drop.length > 1), renamed: count(e => e.action === 'fold' && e.drop.length === 1),
    duplicatesRemoved: work.reduce((n, e) => n + Math.max(0, (e.copies?.length ?? 0) - 1), 0),
    decisions: count(e => e.review?.processingStatus === REVIEW.DECISION), pending: count(e => e.review?.processingStatus === REVIEW.PENDING),
    validated: count(e => e.review?.processingStatus === REVIEW.DONE), conflicts: count(e => e.conflictFields?.length > 0),
    awaitingPromotion: count(e => e.awaitingPromotion),
    variancesSuperseded: work.reduce((n, e) => n + e.supersede.length, 0), variancesOpened: count(e => e.openVariance),
    skipped: entries.filter(e => e.action === 'skip').map(e => ({ number: e.number, why: e.why })),
  };
  const byReason = {};
  for (const e of work) if (e.review?.processingStatus === REVIEW.DECISION) byReason[e.review.reasonCode] = (byReason[e.review.reasonCode] ?? 0) + 1;
  summary.decisionsByReason = byReason;
  return { entries: work, summary, previewHash: hashBody(work.map(e => ({ number: e.number, inputs: e.inputs, doc: e.doc, supersede: e.supersede }))) };
}

const publicEntry = e => ({ number: e.number, action: e.action, copies: e.copies ?? [], latest: e.latest ?? null, held: Boolean(e.held),
  awaitingPromotion: Boolean(e.awaitingPromotion),
  processingStatus: e.review?.processingStatus ?? null, reasonCode: e.review?.reasonCode ?? null, conflictFields: e.conflictFields ?? [],
  variancesSuperseded: e.supersede.length, varianceOpened: Boolean(e.openVariance) });

/** What the cleanup would do, without writing anything. */
export async function previewBookingIdentityCleanup(db) {
  const plan = await planCleanup(db, ref => ref.get());
  const state = (await db.collection(COL.STATE).doc(CLEANUP_STATE_ID).get()).data() ?? null;
  return { dryRun: true, previewHash: plan.previewHash, summary: plan.summary, lastApplied: state,
    rows: plan.entries.filter(e => (e.action === 'fold' && e.drop.length > 1) || e.review?.processingStatus === REVIEW.DECISION || e.awaitingPromotion)
      .map(publicEntry) };
}

function chunks(entries) {
  const out = []; let current = [], writes = 0;
  for (const e of entries) {
    const n = (e.action === 'fold' ? 2 + e.drop.length : 1) + e.supersede.length + (e.openVariance ? 1 : 0);
    if (current.length && writes + n > MAX_WRITES) { out.push(current); current = []; writes = 0; }
    current.push(e); writes += n;
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * Applies a reviewed preview: one transaction per chunk of numbers, each re-reading its bookings and variances and
 * refusing if anything moved since the preview. Re-running continues where an interrupted run stopped.
 */
export async function applyBookingIdentityCleanup(db, FieldValue, { reason, previewHash } = {}, actor) {
  const why = String(reason ?? '').trim();
  if (!why) fail('اكتب سبب التوحيد؛ يُحفظ في سجل التدقيق مع كل حجز.', 'invalid-argument');
  const plan = await planCleanup(db, ref => ref.get());
  if (!previewHash || plan.previewHash !== previewHash) fail('تغيّرت الحجوزات منذ المعاينة؛ أعد المعاينة ثم طبّق.');
  const cleanupId = `cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let applied = 0;
  for (const chunk of chunks(plan.entries)) {
    await db.runTransaction(async tx => {
      // Every read first (a transaction writes only after it has read), keeping each folded copy for the audit.
      const befores = new Map();
      for (const e of chunk) {
        const before = {};
        for (const input of [...e.inputs.copies.map(c => ({ ...c, col: COL.BOOKINGS })), ...e.inputs.variances.map(v => ({ ...v, col: COL.VARIANCES }))]) {
          const snap = await tx.get(db.collection(input.col).doc(input.id));
          if (!snap.exists || hashBody(snap.data()) !== input.hash) fail(`تغيّر الحجز ${e.number} منذ المعاينة؛ أعد المعاينة.`);
          if (input.col === COL.BOOKINGS) before[input.id] = snap.data();
        }
        befores.set(e.number, before);
        if (e.action === 'fold' && !e.inputs.copies.some(c => c.id === e.number)) {
          if ((await tx.get(db.collection(COL.BOOKINGS).doc(e.number))).exists) fail(`وصل للحجز ${e.number} سجل جديد منذ المعاينة؛ أعد المعاينة.`);
        }
      }
      const now = new Date().toISOString();
      for (const e of chunk) {
        const before = befores.get(e.number);
        if (e.action === 'fold') {
          tx.set(db.collection(COL.BOOKINGS).doc(e.number), { ...e.doc, identityCleanup: { cleanupId, appliedAtIso: now, appliedBy: actor, reason: why },
            updatedAtIso: now, updatedAt: FieldValue.serverTimestamp() });
          for (const id of e.drop) tx.delete(db.collection(COL.BOOKINGS).doc(id));
        }
        for (const id of e.supersede) tx.set(db.collection(COL.VARIANCES).doc(id), { resolution: 'superseded', supersededAtIso: now,
          supersededBecause: 'identity_cleanup', cleanupId }, { merge: true });
        if (e.openVariance) tx.set(db.collection(COL.VARIANCES).doc(operationsVarianceId(e.number)), { kind: 'operational_sync_review',
          sspBookingId: e.doc.sspBookingId, bookingNumber: e.number, periodKey: e.doc.periodKey, serviceDate: e.doc.serviceDate,
          sourceHash: e.doc.sourceHash ?? null, reasonCode: e.review.reasonCode, conflictFields: e.conflictFields.length ? e.conflictFields : null,
          resolution: 'unresolved', detectedAtIso: now, lastSeenAtIso: now, cleanupId }, { merge: true });
        if (e.action === 'fold') tx.set(db.collection(AUDIT).doc(), { action: 'sweater.bookingIdentityCleanup', collectionName: COL.BOOKINGS,
          documentId: e.number, userId: actor, reason: why, kind: 'sweater_booking_identity', sourceId: cleanupId,
          note: `توحيد الحجز ${e.number}: ${e.copies.join(' و')} ← ${e.number}${e.latest ? ` — آخر قراءة ${e.latest.sspBookingId} (${e.latest.rawStatus})` : ''}`
            + (e.held ? ' — سجل المالك باقٍ كما هو' : '')
            + (e.awaitingPromotion ? ' — بقي على قراءة الحجز المفتوحة حتى تُثبت المزامنة التالية الغسلة' : ''),
          source: { kind: 'identity_cleanup', previewHash, latest: e.latest }, before, after: e.doc,
          at: FieldValue.serverTimestamp(), atIso: now });
        applied += 1;
      }
    });
  }
  const state = { cleanupId, appliedAtIso: new Date().toISOString(), appliedBy: actor, reason: why, previewHash, summary: plan.summary, applied };
  await db.collection(COL.STATE).doc(CLEANUP_STATE_ID).set(state);
  return { saved: true, cleanupId, applied, summary: plan.summary, ledgerPosted: false, washesCreated: 0 };
}

// ── تعبئة نوع الخدمة للحجوزات المكتملة بلا نوع ──
// تقرير «Biker Bookings and Tips» في لوحة سويتر يبيّن أن كل حجز مكتمل بلا نوع في
// الشهر غسيل كامل (Full Wash). التعبئة بأمر المدير، والتقرير مصدرها في السجل.

async function planServiceFill(db, read, periodKey) {
  if (!/^\d{4}-\d{2}$/.test(String(periodKey ?? ''))) fail('حدّد الشهر بصيغة YYYY-MM.', 'invalid-argument');
  const all = await loadAll(db, read);
  if (all[COL.BOOKINGS].some(b => !isNumber(b.id) && isNumber(numberOf(b.data, b.id)))) fail('وحّد الحجوزات برقمها أولًا، ثم عبّئ نوع الخدمة.');
  const washes = new Set(all.washes.map(w => numberOf(w.data, null)));
  const bikers = new Map(all.bikers.map(b => [b.id, b.data]));
  const variances = new Map(all[COL.VARIANCES].map(v => [v.id, v.data]));
  const entries = all[COL.BOOKINGS].filter(b => b.data.periodKey === periodKey && b.data.record?.normalizedStatus === 'payment_collection'
    && !String(b.data.record?.serviceType ?? '').trim() && !lockedFinancially(b.data)).map(b => {
    const record = { ...b.data.record, serviceType: FULL_WASH_SERVICE, serviceTypeLabel: b.data.record.serviceTypeLabel ?? 'Full Wash' };
    const held = financialProtection(b.data) || (b.data.source && b.data.source !== OPERATIONS_SOURCE);
    const worker = b.data.operationalWorkerId ? bikers.get(b.data.operationalWorkerId) : null;
    const review = held ? { processingStatus: REVIEW.DONE, reasonCode: null }
      : bookingReviewState({ record, hasWash: washes.has(b.id), established: Boolean(worker?.name),
        execution: executionEligibility(record, { extractedAt: b.data.observedAtIso ?? b.data.updatedAtIso }, worker), washMissing: true });
    const variance = variances.get(operationsVarianceId(b.id));
    return { id: b.id, hash: hashBody(b.data), sspBookingId: b.data.sspBookingId, serviceDate: b.data.serviceDate, held, hasWash: washes.has(b.id),
      record, review, supersede: review.processingStatus !== REVIEW.DECISION && variance?.resolution === 'unresolved',
      openSince: variance?.resolution === 'unresolved' ? variance.detectedAtIso ?? null : null, before: b.data };
  }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { entries, previewHash: hashBody(entries.map(e => ({ id: e.id, hash: e.hash }))) };
}

export async function previewServiceTypeFill(db, { periodKey } = {}) {
  const plan = await planServiceFill(db, ref => ref.get(), periodKey);
  return { dryRun: true, periodKey, source: SERVICE_FILL_SOURCE, serviceType: FULL_WASH_SERVICE, previewHash: plan.previewHash,
    rows: plan.entries.map(e => ({ number: e.id, sspBookingId: e.sspBookingId, serviceDate: e.serviceDate, held: e.held, hasWash: e.hasWash,
      processingStatus: e.review.processingStatus, reasonCode: e.review.reasonCode })) };
}

export async function applyServiceTypeFill(db, FieldValue, { periodKey, reason, previewHash } = {}, actor) {
  const why = String(reason ?? '').trim();
  if (!why) fail('اكتب سبب التعبئة؛ يُحفظ في سجل التدقيق مع المصدر.', 'invalid-argument');
  const plan = await planServiceFill(db, ref => ref.get(), periodKey);
  if (!previewHash || plan.previewHash !== previewHash) fail('تغيّرت الحجوزات منذ المعاينة؛ أعد المعاينة ثم طبّق.');
  const now = new Date().toISOString();
  for (let i = 0; i < plan.entries.length; i += 100) {
    const chunk = plan.entries.slice(i, i + 100);
    await db.runTransaction(async tx => {
      for (const e of chunk) {
        const snap = await tx.get(db.collection(COL.BOOKINGS).doc(e.id));
        if (!snap.exists || hashBody(snap.data()) !== e.hash) fail(`تغيّر الحجز ${e.id} منذ المعاينة؛ أعد المعاينة.`);
      }
      for (const e of chunk) {
        const fill = { serviceType: FULL_WASH_SERVICE, source: SERVICE_FILL_SOURCE, sourceLabel: 'Full Wash', filledAtIso: now, filledBy: actor, reason: why };
        const after = { record: e.record, sourceHash: hashRecord(e.record), serviceTypeFill: fill,
          processingStatus: e.review.processingStatus, reviewReasonCode: e.review.reasonCode, updatedAtIso: now };
        tx.set(db.collection(COL.BOOKINGS).doc(e.id), { ...after, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        if (e.supersede) tx.set(db.collection(COL.VARIANCES).doc(operationsVarianceId(e.id)), { resolution: 'superseded', supersededAtIso: now,
          supersededBecause: 'service_type_filled' }, { merge: true });
        // Still a question once the type is known (e.g. no proof of execution): its variance now says why.
        if (e.review.processingStatus === REVIEW.DECISION) tx.set(db.collection(COL.VARIANCES).doc(operationsVarianceId(e.id)), {
          kind: 'operational_sync_review', sspBookingId: e.sspBookingId, bookingNumber: e.id, periodKey, serviceDate: e.serviceDate,
          sourceHash: after.sourceHash, reasonCode: e.review.reasonCode, resolution: 'unresolved', lastSeenAtIso: now,
          ...(e.openSince ? {} : { detectedAtIso: now }) }, { merge: true });
        tx.set(db.collection(AUDIT).doc(), { action: 'sweater.serviceTypeFill', collectionName: COL.BOOKINGS, documentId: e.id, userId: actor,
          reason: why, kind: 'sweater_service_type', sourceId: periodKey,
          note: `نوع خدمة الحجز ${e.sspBookingId}: غسيل كامل (Full Wash) من تقرير «Biker Bookings and Tips» في لوحة سويتر`,
          source: { kind: 'sweater_report', report: SERVICE_FILL_SOURCE, previewHash },
          before: { record: e.before.record, sourceHash: e.before.sourceHash ?? null, processingStatus: e.before.processingStatus ?? null,
            reviewReasonCode: e.before.reviewReasonCode ?? null }, after, at: FieldValue.serverTimestamp(), atIso: now });
      }
    });
  }
  return { saved: true, periodKey, filled: plan.entries.length, source: SERVICE_FILL_SOURCE, ledgerPosted: false, washesCreated: 0 };
}
