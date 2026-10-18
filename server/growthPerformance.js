import { AuthError, callerRole } from '../functions/src/handlers.js';
import { completedCommissionWash } from '../functions/src/washCommission.js';
import { growthDay, growthMetrics, shiftGrowthDay } from '../src/lib/growthMetrics.js';
import { growthRoster } from './growthRoster.js';

const fail = (message, code = 'invalid-argument') => { throw new AuthError(message, { code }); };
const row = doc => ({ id: doc.id, ...doc.data() });
export function validateGrowthRequest(input, now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(now);
  if (!input || Array.isArray(input) || Object.keys(input).some(k => !['from', 'to'].includes(k))
    || !growthDay(input.from) || !growthDay(input.to) || input.from > input.to || input.to >= today
    || Date.parse(input.to) - Date.parse(input.from) > 92 * 86400000) fail('اختر فترة مكتملة لا تتجاوز 93 يومًا.');
  return { ...input, lookback: shiftGrowthDay(input.from, -30) };
}

// Pure adapter shared by the server and behavioral fixtures. It returns only
// names/IDs/zone, day-level counts and coverage: never phones, payroll or clients.
export function projectGrowth({ workers, washes, bookings, runs, from, to, lookback, roster = growthRoster }) {
  const result = [];
  const exclusions = [];
  const missing = [];
  const unlinked = [];
  const dates = [];
  for (let date = lookback; date <= to; date = shiftGrowthDay(date, 1)) dates.push(date);
  for (const ref of roster.rows) {
    const linked = workers.filter(w => String(w.driver_external_id || '').trim() === ref.code);
    if (linked.length > 1) fail('ربط معرف العامل ملتبس؛ تعذر إعداد المقارنة.', 'failed-precondition');
    const worker = linked[0];
    const id = worker?.id || `missing-${ref.code}`;
    const ownWashes = washes.filter(w => w.biker_id === id && completedCommissionWash(w));
    const ownBookings = bookings.filter(b => b.operationalWorkerId === id || String(b.record?.driverExternalId || '') === ref.code);
    const days = dates.map(date => {
      const observedRows = ownBookings.filter(b => b.serviceDate === date && b.record?.bookingKind === 'individual');
      const resolved5596423 = ref.code === '1986' && date === '2026-10-10'
        && observedRows.some(b => b.sspBookingId === 'S-5596423');
      const observed = observedRows.filter(b => !(resolved5596423 && b.sspBookingId === 'B-5596423'));
      const indexed = new Map();
      const recorded = new Map();
      let partial = !worker || observed.some(b => String(b.record.driverExternalId || '') !== ref.code
        || (b.operationalWorkerId && b.operationalWorkerId !== id));
      let excluded = 0;
      let proofCount = 0;
      for (const wash of ownWashes.filter(w => String(w.wash_date || '').slice(0, 10) === date)) {
        const key = String(wash.ssp_booking_id || '');
        // One evidenced legacy alias only. Never strip or replace prefixes generally.
        const bookingKey = wash.id === 'ssp__B-5596423' && key === 'B-5596423' && date === '2026-10-10' && ref.code === '1986'
          ? 'S-5596423' : key;
        const candidates = observed.filter(b => b.sspBookingId === bookingKey);
        if (key === 'C-5584720') {
          excluded++; partial = true;
          exclusions.push({ code: ref.code, date, reference: key, reason: 'completion-conflict' });
          continue;
        }
        // A known corporate row is outside this cohort, not a missing
        // individual completion. Unknown classifications still fail closed.
        if (bookings.some(b => b.sspBookingId === bookingKey && b.serviceDate === date
          && b.record?.bookingKind === 'corporate')) continue;
        // The approved descriptive measure is canonical registered washes,
        // not only those that can pass today's detailed source-link checks.
        // Historical external codes can differ; the existing stable biker_id
        // remains the registered worker. Do not promote this to verified work.
        if (Number(wash.quantity) !== 1) { partial = true; continue; }
        const registeredKey = key ? bookingKey : `wash:${wash.id}`;
        if (recorded.has(registeredKey)) { partial = true; continue; }
        recorded.set(registeredKey, wash);
        if (!key || candidates.length !== 1 || Number(wash.quantity) !== 1
          || (wash.driver_external_id && String(wash.driver_external_id).trim() !== ref.code)
          || String(candidates[0].record.driverExternalId || '') !== ref.code
          || (candidates[0].operationalWorkerId && candidates[0].operationalWorkerId !== id)) {
          partial = true;
          const exact = bookings.filter(b => b.sspBookingId === bookingKey && b.serviceDate === date);
          unlinked.push({washId:wash.id,reference:key || wash.id,code:ref.code,date,
            reason: exact.length === 0 ? 'detailed-booking-unavailable'
              : String(exact[0].record?.driverExternalId || '') !== ref.code ? 'historical-external-code-differs' : 'detailed-identity-unverified'});
          continue;
        }
        if (indexed.has(bookingKey)) { partial = true; continue; }
        indexed.set(bookingKey, wash);
        const record = candidates[0].record;
        const started = Date.parse(record.startedAt), ended = Date.parse(record.completedAt);
        if (Number.isFinite(started) && ended > started
          && new Date(started + 3 * 3600000).toISOString().slice(0, 10) === date) proofCount++;
      }
      for (const booking of observed) {
        if (booking.record.normalizedStatus === 'payment_collection' && !indexed.has(booking.sspBookingId)
          && booking.sspBookingId !== 'C-5584720') {
          partial = true;
          missing.push({ code: ref.code, date, reference: booking.sspBookingId, reason: 'completion-or-link-unverified' });
        }
      }
      const completeRun = runs.some(run => ['completed', 'completed_with_gaps'].includes(run.status)
        && run.coverage?.modules?.individual === 'complete' && run.coverage.rangeFrom <= date && run.coverage.rangeTo >= date
        && run.coverage.pageCount > 0 && run.coverage.pagesFetched === run.coverage.pageCount);
      const complete = Boolean(worker && completeRun && !partial);
      return { date, count: indexed.size || complete ? indexed.size : null,
        recordedCount: recorded.size || complete ? recorded.size : null,
        registered: recorded.size + excluded, coverage: complete ? 'complete' : 'partial',
        // A complete source list + an evidenced execution establishes this
        // day only, not attendance on any zero/unknown date.
        workEligible: complete && indexed.size > 0 && proofCount === indexed.size ? true : null,
        assigned: completeRun ? observed.length : null,
        cancelled: completeRun ? observed.filter(b => b.record.normalizedStatus === 'admin_cancelled').length : null };
    });
    result.push({ id, code: ref.code, status: ref.status, region: ref.region,
      name: worker?.name_ar || worker?.name || worker?.name_en || ref.code,
      nameEnglish: worker?.name_en || worker?.name || ref.code, days });
  }
  return { workers: result, roster: { at: roster.at, source: roster.source },
    exclusions: exclusions.filter(x => x.date >= from), gaps: missing.filter(x => x.date >= from),
    unlinked: unlinked.filter(x => x.date >= from),
    from, to, lookback, readAt: new Date().toISOString(), scope: 'registered-excluding-known-corporate',
    comparisonScope: 'verified-individual', corporateCoverage: 'partial' };
}

export async function readGrowthPerformance(db, auth, input) {
  if (await callerRole(db, auth) !== 'admin') fail('هذه الصفحة متاحة للأدمن فقط.', 'permission-denied');
  // Authorization precedes all performance/roster reads and even input validation.
  const { from, to, lookback } = validateGrowthRequest(input);
  const codes = growthRoster.rows.map(r => r.code);
  const upper = shiftGrowthDay(to, 1);
  const queries = [
    db.collection('bikers').where('driver_external_id', 'in', codes)
      .select('driver_external_id', 'name', 'name_ar', 'name_en').limit(31),
    db.collection('washes').where('wash_date', '>=', lookback).where('wash_date', '<', upper)
      .select('biker_id', 'driver_external_id', 'wash_date', 'status', 'quantity', 'ssp_booking_id').limit(3001),
    db.collection('sweater_bookings').where('serviceDate', '>=', lookback).where('serviceDate', '<', upper)
      .select('sspBookingId', 'serviceDate', 'operationalWorkerId', 'record.bookingKind', 'record.driverExternalId',
        'record.normalizedStatus', 'record.startedAt', 'record.completedAt').limit(3001),
    // A run ending after the visible range can still cover it. Bound the
    // result count, not rangeTo<=to; fail explicitly rather than truncate.
    db.collection('sweater_import_runs').where('coverage.rangeTo', '>=', lookback)
      .select('status', 'coverage').limit(201),
  ];
  const snaps = await Promise.all(queries.map(q => q.get()));
  if (snaps.some((snap, i) => snap.size >= [31, 3001, 3001, 201][i])) fail('الفترة تتجاوز حد القراءة؛ اختر فترة أقصر.', 'failed-precondition');
  const [workers, washes, bookings, runs] = snaps.map(snap => snap.docs.map(row));
  // Existing operational records can establish a stable UID when the biker
  // itself has no external code. Never join by a name, invent a worker, write
  // a link, or accept conflicting codes/UIDs.
  const fallback = new Map();
  for (const code of codes.filter(code => !workers.some(w => String(w.driver_external_id || '').trim() === code))) {
    const ids = [...new Set(washes.filter(w => String(w.driver_external_id || '').trim() === code
      && completedCommissionWash(w) && Number(w.quantity) === 1).map(w => w.biker_id))];
    if (ids.length > 1 || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
      fail('ربط معرف العامل ملتبس؛ تعذر إعداد المقارنة.', 'failed-precondition');
    }
    if (ids.length === 1) {
      if (fallback.has(ids[0]) && fallback.get(ids[0]) !== code) fail('ربط معرف العامل ملتبس؛ تعذر إعداد المقارنة.', 'failed-precondition');
      fallback.set(ids[0], code);
    }
  }
  if (fallback.size) {
    const linked = await db.collection('bikers').where('__name__', 'in', [...fallback.keys()])
      .select('driver_external_id', 'name', 'name_ar', 'name_en').limit(8).get();
    if (linked.size >= 8) fail('ربط معرف العامل ملتبس؛ تعذر إعداد المقارنة.', 'failed-precondition');
    for (const doc of linked.docs) {
      const value = row(doc), code = fallback.get(doc.id);
      if (value.driver_external_id && String(value.driver_external_id).trim() !== code
        || workers.some(w => w.id === doc.id)) fail('ربط معرف العامل ملتبس؛ تعذر إعداد المقارنة.', 'failed-precondition');
      workers.push({ ...value, driver_external_id: code });
    }
  }
  const projection = projectGrowth({ workers, washes, bookings, runs, from, to, lookback });
  // Exercise the same strict period contract before returning a successful DTO.
  growthMetrics({ workers: projection.workers, from, to, measurementDay: to });
  return projection;
}
