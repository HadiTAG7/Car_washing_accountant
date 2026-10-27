import { operationFreshness } from './sweaterFreshness.js';
export { operationFreshness } from './sweaterFreshness.js';
import { uniqueCompletedCommissionWashes } from '../../functions/src/washCommission.js';
import { monthRange } from './accounting/monthlyStatement.js';
import { availableWorkDays } from './availableWorkDays.js';
import { dailyBreakEven, bikerBreakEven } from './breakEven.js';
import { overviewOperations } from './overviewDashboard.js';
import { overviewBusinessMetrics } from './overviewInsights.js';
import { idleBikers, departedBiker } from './idleBikers.js';
import { ownerBookingIdentity } from './sweater/bookingIdentity.js';
import { qualityBikerRows } from './qualityViolations.js';

const DAY = 86400000;
export const shiftDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const realDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(Date.parse(`${d}T00:00:00Z`)) && shiftDay(d, 0) === d;
const sum = rows => rows.reduce((n, r) => n + Math.max(0, Number(r.quantity) || 0), 0);
const dateOf = w => w.washDate ?? w.wash_date;
const bikerOf = w => String(w.bikerId ?? w.biker_id ?? '').trim();
const instant = x => typeof x === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
export const riyadhDayAt = stamp => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date(stamp));

/** One natural booking identity, latest stored observation, original status
 * retained. Equal-time conflicting observations make booking totals unknown. */
export function dayBookings(bookings) {
  const seen = new Map();
  for (const b of bookings) {
    const r = b.record ?? b, key = ownerBookingIdentity(r.sspBookingId || b.sspBookingId || b.id);
    if (!key || !realDay(r.serviceDate)) continue;
    const signature = JSON.stringify([r.serviceDate, r.region, r.branch, r.rawStatus, r.driverExternalId, b.operationalWorkerId ?? b.bikerId]);
    const time = instant(b.updatedAtIso) ?? 0, prior = seen.get(key);
    if (prior && time === prior.time && prior.signature !== signature) prior.conflict = true;
    if (!prior || time > prior.time) seen.set(key, { row: { ...r, linkedBikerId: b.operationalWorkerId ?? b.bikerId ?? null }, signature, time, conflict: false });
  }
  return { rows: [...seen.values()].map(v => v.row), conflict: [...seen.values()].some(v => v.conflict) };
}

/** Read-only daily lens over current stored records, not a reconstructed
 * historical snapshot. All break-even/cost/availability definitions are reused. */
export function operationsToday({ day, today, washes = [], bikers = [], bookings = [], statement = null, payrollLines = null,
  snapshot = null, integrationState = null, now = Date.now() } = {}) {
  if (!realDay(day) || !realDay(today) || day > today) return { error: 'invalid_day' };
  const periodKey = day.slice(0, 7), range = monthRange(periodKey);
  const cutoff = day < today ? shiftDay(day, 1) : day;
  const lastCompleted = shiftDay(cutoff, -1), weekFrom = shiftDay(lastCompleted, -6), yesterday = shiftDay(day, -1);
  const from = weekFrom < range.from ? weekFrom : range.from;
  const conflicts = [];
  const unique = uniqueCompletedCommissionWashes(washes, from, day, message => conflicts.push(message));
  if (conflicts.length) return { error: 'wash_conflict', conflicts };
  const at = d => unique.filter(w => dateOf(w) === d);
  const inMonth = unique.filter(w => dateOf(w) >= range.from);
  const completedMonth = inMonth.filter(w => dateOf(w) < cutoff);
  const week = Array.from({ length: 7 }, (_, i) => ({ date: shiftDay(weekFrom, i), quantity: sum(at(shiftDay(weekFrom, i))) }));
  const daily = dailyBreakEven({ statement, periodKey, completeMonth: range.to < today });
  const ops = overviewOperations({ washes: unique, bikers, periodKey, today: cutoff });
  const business = overviewBusinessMetrics(ops && { ...ops, quantity: sum(inMonth) }, statement);
  const remainingDays = Math.max(0, Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${lastCompleted}T00:00:00Z`)) / DAY));
  const perBiker = payrollLines && statement ? bikerBreakEven({ statement, payrollLines, washes: unique, bikers, periodKey, today: cutoff }) : null;
  const idle = payrollLines ? idleBikers({ bikers, washes: unique, payrollLines, statement, periodKey, today: cutoff }) : null;
  const imported = dayBookings(bookings);
  const cancellationGroup = snapshot?.eventGroups?.cancelledByBiker;
  const cancellationDetailsAvailable = Boolean(cancellationGroup?.complete || cancellationGroup?.rows?.length);
  const qualitySnapshot = cancellationGroup ? { ...snapshot, eventGroups: { cancelledByBiker: { ...cancellationGroup,
    complete: cancellationGroup.complete && cancellationGroup.rows.every(row => realDay(row.date)),
    rows: cancellationGroup.rows.filter(row => realDay(row.date) && row.date >= range.from && row.date <= day) } } } : null;
  const qualityRows = new Map(qualityBikerRows(qualitySnapshot, bikers).map(row => [row.id, row.values.cancelledByBiker]));
  const active = bikers.filter(b => !departedBiker(b) && (!b.startDate || b.startDate <= day) && (!b.endDate || b.endDate >= day));
  const rows = active.map(b => {
    const own = unique.filter(w => bikerOf(w) === String(b.id));
    const line = payrollLines?.find(l => l.bikerId === b.id);
    const available = availableWorkDays({ periodKey, startDate: line?.eligibleStart || b.startDate || null,
      endDate: line?.eligibleEnd || b.endDate || null, beforeDate: cutoff });
    const matched = !perBiker?.error && perBiker?.rows?.find(r => r.bikerId === b.id);
    const ownMonth = completedMonth.filter(w => bikerOf(w) === String(b.id));
    const lastWash = own.filter(w => dateOf(w) < cutoff).map(dateOf).sort().at(-1) || null;
    const twoDays = [lastCompleted, shiftDay(lastCompleted, -1)];
    const silentTwo = Boolean(b.startDate && b.startDate <= twoDays[1] && twoDays.every(d => !own.some(w => dateOf(w) === d)));
    const cancellations = qualityRows.get(b.id);
    const actualDaily = matched ? matched.actualDaily : (line?.eligibleStart || b.startDate) && available?.workDays > 0 && ownMonth.every(w => !b.startDate || dateOf(w) >= b.startDate)
      ? sum(ownMonth) / available.workDays : null;
    const idleRow = !idle?.error && idle?.rows?.find(r => r.bikerId === b.id);
    return { biker: b, today: sum(own.filter(w => dateOf(w) === day)), yesterday: sum(own.filter(w => dateOf(w) === yesterday)),
      actualDaily, coverage: matched?.coverage ?? (actualDaily === 0 && available?.workDays > 0 ? 0 : null), requiredDaily: matched?.requiredDaily ?? null,
      cancellationCount: cancellations?.value ?? null, cancellationPartial: cancellations?.partial ?? true,
      silentTwo, lastWash, status: idleRow ? 'idle' : !idle || idle.error || !line || !available?.calendarDays || idle.excluded.some(r => r.bikerId === b.id) ? 'unknown' : 'working' };
  }).sort((a, b) => Number(b.silentTwo) - Number(a.silentTwo) || b.today - a.today || String(a.biker.name).localeCompare(String(b.biker.name), 'ar'));
  // Regions describe recorded execution, attributed only through imported
  // booking identities. A raw payment/cancellation status never creates a wash.
  const bookingMap = new Map(imported.rows.map(r => [ownerBookingIdentity(r.sspBookingId), r]));
  const regions = new Map();
  for (const w of unique) {
    const d = dateOf(w); if (d !== day && (d < weekFrom || d > lastCompleted)) continue;
    const booking = bookingMap.get(ownerBookingIdentity(w.sspBookingId ?? w.ssp_booking_id));
    const region = String(booking?.region || booking?.branch || '').trim() || 'غير محددة';
    const item = regions.get(region) || { region, today: 0, week: 0 };
    if (d === day) item.today += Number(w.quantity) || 0;
    if (d >= weekFrom && d <= lastCompleted) item.week += Number(w.quantity) || 0;
    regions.set(region, item);
  }
  const metricSource = snapshot?.metricSources?.completedWashes;
  const snapshotDay = instant(metricSource?.extractedAtIso) !== null && metricSource?.extractedAtIso ? riyadhDayAt(metricSource.extractedAtIso) : null;
  const sweaterCount = snapshot?.metrics?.completedWashes;
  // A later monthly snapshot is never compared to an earlier selected date.
  let reconciliation = null;
  if (snapshotDay && snapshotDay <= day && Number.isSafeInteger(sweaterCount) && !imported.conflict) {
    let registered = sum(inMonth.filter(w => dateOf(w) < snapshotDay)), unknownAtCutoff = 0;
    for (const w of inMonth.filter(w => dateOf(w) === snapshotDay)) {
      const completedAt = bookingMap.get(ownerBookingIdentity(w.sspBookingId ?? w.ssp_booking_id))?.completedAt;
      const ended = instant(completedAt);
      if (ended === null || riyadhDayAt(completedAt) !== snapshotDay) unknownAtCutoff += Number(w.quantity) || 0;
      else if (ended <= instant(metricSource.extractedAtIso)) registered += Number(w.quantity) || 0;
    }
    reconciliation = { sweater: sweaterCount, registered, unknownAtCutoff, date: snapshotDay, extractedAt: metricSource.extractedAtIso,
      difference: unknownAtCutoff ? null : sweaterCount - registered };
  }
  const unlinked = inMonth.filter(w => dateOf(w) === day && (!bikerOf(w) || !bikers.some(b => String(b.id) === bikerOf(w))));
  return { day, today, periodKey, yesterday, lastCompleted, weekFrom, week, rows,
    quantity: sum(at(day)), yesterdayQuantity: sum(at(yesterday)), monthQuantity: sum(inMonth),
    weeklyAverage: week.reduce((n, d) => n + d.quantity, 0) / 7, dailyRequired: daily?.required ?? null,
    monthlyRequired: business?.monthlyRequired ?? null, remainingWashes: business?.remainingWashes ?? null, remainingDays,
    neededPerRemainingDay: remainingDays && business?.remainingWashes != null ? business.remainingWashes / remainingDays : null,
    partialCosts: Boolean(statement?.issues?.length), payrollError: Boolean(perBiker?.error || idle?.error),
    regions: imported.conflict ? null : [...regions.values()].sort((a, b) => b.today - a.today || b.week - a.week),
    bookingsConflict: imported.conflict, reconciliation, cancellationDetailsAvailable, unlinkedCount: sum(unlinked), silentCount: rows.filter(r => r.silentTwo).length,
    freshness: operationFreshness(integrationState, now) };
}
