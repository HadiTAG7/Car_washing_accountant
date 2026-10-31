// ═══════════════════════════════════════════════════════════════════════════
// الحجوزات المفتوحة في سويتر — كل مزامنة تعيد قراءة آخر 3 أيام وكل حجز غير نهائي
// ═══════════════════════════════════════════════════════════════════════════
// الحجز مفتوح حتى يعرضه سويتر Collecting Payment أو Cancelled by Admin. الوكيل
// يقرأ في كل مزامنة أيام النافذة (اليوم واليومين قبله)، ويعيد قراءة كل حجز مفتوح
// أقدم منها برقمه (`rechecks`). هنا:
//   • ما يلزم المزامنة التالية (`syncFollowUp`) — يُرجَع مع كل حفظ ويطبعه أمر المزامنة.
//   • حالة الحجوزات المفتوحة للمالك: ما لم تُعِد آخر مزامنة قراءته، ومنذ متى.
//   • «قراءات سويتر المحفوظة»: قراءة أحدث وصلت من سويتر وحُفظت خامًا ولم تُطبَّق على
//     الحجز (مثلًا حين أبقى التوحيد القراءة المفتوحة). تُمرَّر بموافقة المدير بالمسار
//     نفسه الذي تمر به أي مزامنة، كدفعة إعادة تطبيق موسومة، مع سطر تدقيق لكل حجز.
// لا قيد ولا تحصيل ولا راتب، ولا قراءة جديدة من سويتر.
// ═══════════════════════════════════════════════════════════════════════════

import { hashBody } from './record.js';
import { COL, SweaterIngestError } from './ingest.js';
import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';
import { OPERATIONS_SOURCE, REVIEW, pendingBookings, previewOperations, saveOperations, stillOpenBooking, latestReading,
  lockedFinancially } from './operationsSync.js';

export const WINDOW_DAYS = 3;
export const FOLLOW_UP_CONTRACT = 'sweater-followup-v1';
const fail = (message, code = 'failed-precondition') => { throw new SweaterIngestError(message, { code }); };
const time = value => { const t = Date.parse(value ?? ''); return Number.isFinite(t) ? t : null; };
export const riyadhDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(now);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysIn = c => (c?.rangeFrom && c?.rangeTo ? Math.round((Date.parse(c.rangeTo) - Date.parse(c.rangeFrom)) / 86_400_000) + 1 : null);

/** The days every run reads: today (Riyadh) and the two before. */
export function syncWindow(now = new Date()) {
  const rangeTo = riyadhDay(now);
  return { rangeFrom: addDays(rangeTo, -(WINDOW_DAYS - 1)), rangeTo, days: WINDOW_DAYS };
}

/** What the next run must read, given the open bookings and (optionally) the run just sent. Pure. */
export function followUpFor(open, { payload = null, now = new Date() } = {}) {
  const window = syncWindow(now);
  const sent = new Set((payload?.records ?? []).map(r => ownerBookingIdentity(String(r?.sspBookingId ?? ''))));
  const rows = open.map(b => ({ bookingNumber: b.bookingNumber, serviceDate: b.serviceDate, rawStatus: b.rawStatus, observedAtIso: b.observedAtIso }));
  return { contract: FOLLOW_UP_CONTRACT, window,
    rechecks: rows.filter(b => b.serviceDate < window.rangeFrom).map(b => b.bookingNumber),
    openInWindow: rows.filter(b => b.serviceDate >= window.rangeFrom).map(b => b.bookingNumber),
    ...(payload ? { openNotInThisRun: rows.filter(b => !sent.has(b.bookingNumber)) } : {}),
    instruction: 'Next run: read every booking dated window.rangeFrom..window.rangeTo, and re-read each booking in rechecks by its '
      + 'number (any prefix SSP shows now); put those numbers in the envelope field `rechecks`. A booking stays open until '
      + 'Sweater shows Collecting Payment or Cancelled by Admin.' };
}

export async function syncFollowUp(db, payload = null, now = new Date()) {
  return followUpFor((await pendingBookings(db)).bookings, { payload, now });
}

/** For the owner: the last sync's window, and the open bookings it did not re-read (with how long ago they were read). */
export async function openBookingsStatus(db, now = new Date()) {
  const [stateSnap, pending] = await Promise.all([db.collection(COL.STATE).doc('current').get(), pendingBookings(db)]);
  const state = stateSnap.exists ? stateSnap.data() : {};
  const coverage = state.lastOperationalCoverage ?? null, lastAt = time(coverage?.extractedAt);
  const nowMs = now.getTime();
  const open = pending.bookings.map(b => {
    const read = time(b.observedAtIso);
    return { ...b, hoursSinceRead: read === null ? null : Math.round((nowMs - read) / 360_000) / 10,
      rereadInLastSync: read !== null && lastAt !== null && read >= lastAt };
  });
  return { generatedAtIso: now.toISOString(), required: syncWindow(now),
    lastSync: coverage ? { runId: state.lastOperationalRunId ?? null, rangeFrom: coverage.rangeFrom, rangeTo: coverage.rangeTo,
      days: daysIn(coverage), extractedAtIso: coverage.extractedAt, atIso: state.lastOperationalSuccessAtIso ?? null } : null,
    open, notReread: open.filter(b => !b.rereadInLastSync) };
}

// ── قراءات سويتر المحفوظة ولم تُطبَّق ──
async function planStoredReadings(db) {
  const [bookingsSnap, rawSnap, runsSnap] = await Promise.all([db.collection(COL.BOOKINGS).get(), db.collection(COL.RAW).get(),
    db.collection(COL.RUNS).get()]);
  const runs = new Map(runsSnap.docs.map(d => [d.id, d.data()]));
  const raws = new Map();
  for (const d of rawSnap.docs) {
    const raw = d.data(), number = ownerBookingIdentity(String(raw.sspBookingId ?? ''));
    if (raw.source !== OPERATIONS_SOURCE || !raw.rawPayload || !/^\d+$/.test(number)) continue;
    const run = runs.get(raw.importRunId);
    if (!run || run.source !== OPERATIONS_SOURCE || !run.coverage || run.replayOf) continue;
    raws.set(number, [...(raws.get(number) ?? []), { id: d.id, raw, run, at: time(run.coverage.extractedAt) }]);
  }
  const candidates = [];
  for (const d of bookingsSnap.docs) {
    const booking = d.data();
    if (!/^\d+$/.test(d.id) || !stillOpenBooking(booking) || lockedFinancially(booking) || booking.source !== OPERATIONS_SOURCE) continue;
    const reading = latestReading(booking), readAt = time(reading?.observedAtIso ?? booking.observedAtIso);
    const newer = (raws.get(d.id) ?? []).filter(r => r.at !== null && readAt !== null && r.at > readAt).sort((a, b) => b.at - a.at)[0];
    if (!newer) continue;
    // The worker link this booking already established for the same Sweater driver (never a new one).
    const driver = newer.raw.rawPayload.driverExternalId;
    const workerLinks = driver && booking.operationalWorkerId && reading?.driverExternalId === driver ? { [driver]: booking.operationalWorkerId } : {};
    const payload = { contractVersion: 2, importRunId: `replay-${d.id}-${newer.raw.importRunId}`.slice(0, 160), agentStatus: 'ok',
      coverage: { ...newer.run.coverage, recordCount: 1 }, workerLinks, records: [newer.raw.rawPayload] };
    candidates.push({ number: d.id, booking, newer, payload });
  }
  const rows = [];
  for (const c of candidates) {
    const preview = await previewOperations(db, c.payload), row = preview.rows[0] ?? {};
    const current = latestReading(c.booking);
    rows.push({ number: c.number, serviceDate: c.booking.serviceDate ?? current?.serviceDate ?? null,
      current: { sspBookingId: current?.sspBookingId ?? null, rawStatus: current?.rawStatus ?? null, observedAtIso: current?.observedAtIso ?? c.booking.observedAtIso ?? null },
      stored: { sspBookingId: c.newer.raw.sspBookingId, rawStatus: c.newer.raw.normalizedRecord?.rawStatus ?? null, runId: c.newer.raw.importRunId,
        rawId: c.newer.id, extractedAtIso: c.newer.run.coverage.extractedAt },
      outcome: row.outcome ?? null, reasonCode: row.reasonCode ?? null,
      // The writer names a wash id only when it records one (or one already exists for the number).
      recordsWash: Boolean(row.washId) && !row.existingLinkRefs?.some(r => r.collection === 'washes'),
      reassignment: row.observationPromotion?.sourceAssignmentReview ?? null,
      _payload: c.payload, _preview: preview });
  }
  rows.sort((a, b) => String(a.serviceDate).localeCompare(String(b.serviceDate)) || a.number.localeCompare(b.number));
  return { rows, previewHash: hashBody(rows.map(r => ({ number: r.number, payload: hashBody(r._payload), state: r._preview.previewStateHash }))) };
}
const publicRow = ({ _payload, _preview, ...row }) => row;

export async function previewStoredReadings(db) {
  const plan = await planStoredReadings(db);
  const state = await db.collection(COL.STATE).doc('storedReadingsReplay').get();
  return { previewHash: plan.previewHash, rows: plan.rows.map(publicRow), lastApplied: state.exists ? state.data() : null };
}

export async function applyStoredReadings(db, FieldValue, { reason, previewHash } = {}, actor) {
  const why = String(reason ?? '').trim();
  if (!why || why.length > 1000) fail('اكتب سبب التطبيق؛ يُحفظ في سجل التدقيق.', 'invalid-argument');
  const plan = await planStoredReadings(db);
  if (!previewHash || plan.previewHash !== previewHash) fail('تغيّرت الحجوزات أو القراءات منذ المعاينة؛ أعد المعاينة ثم طبّق.');
  const who = (await db.collection('users').doc(String(actor)).get()).data();
  const actorName = who?.displayName || who?.name || who?.email || null;
  const results = [];
  for (const row of plan.rows) {
    const before = (await db.collection(COL.BOOKINGS).doc(row.number).get()).data();
    const replayOf = { runId: row.stored.runId, rawId: row.stored.rawId, extractedAtIso: row.stored.extractedAtIso, requestedBy: actor, reason: why };
    const result = await saveOperations(db, FieldValue, { payload: row._payload, reviewedPayloadHash: row._preview.reviewedPayloadHash,
      previewStateHash: row._preview.previewStateHash }, actor, { replayOf });
    const after = (await db.collection(COL.BOOKINGS).doc(row.number).get()).data();
    const out = result.rows?.[0] ?? {};
    await db.collection('audit_logs').doc().set({ action: 'sweater.storedReadingReplay', collectionName: COL.BOOKINGS, documentId: row.number, userId: actor,
      reason: why, kind: 'sweater_stored_reading', sourceId: row.stored.rawId,
      note: `قراءة سويتر المحفوظة ${row.stored.sspBookingId} (${row.stored.rawStatus}, ${row.stored.extractedAtIso}) طُبّقت على الحجز ${row.number}`,
      source: { kind: 'sweater_stored_reading', ...replayOf, replayRunId: row._payload.importRunId },
      before: { processingStatus: before?.processingStatus ?? null, reviewReasonCode: before?.reviewReasonCode ?? null, record: before?.record ?? null },
      after: { processingStatus: after?.processingStatus ?? null, reviewReasonCode: after?.reviewReasonCode ?? null, washId: out.washCreated ? out.washId : null,
        washCreated: Boolean(out.washCreated), ledgerPosted: false },
      at: FieldValue.serverTimestamp(), atIso: new Date().toISOString() });
    results.push({ number: row.number, washCreated: Boolean(out.washCreated), washId: out.washCreated ? out.washId : null,
      processingStatus: after?.processingStatus ?? null, reasonCode: after?.reviewReasonCode ?? null });
  }
  const state = { appliedAtIso: new Date().toISOString(), appliedBy: actor, appliedByName: actorName, reason: why, previewHash,
    applied: results.length, washesCreated: results.filter(r => r.washCreated).length };
  await db.collection(COL.STATE).doc('storedReadingsReplay').set(state);
  return { saved: true, ...state, rows: results, ledgerPosted: false, payrollPaid: false,
    stillDeciding: results.filter(r => r.processingStatus === REVIEW.DECISION).map(r => r.number) };
}
