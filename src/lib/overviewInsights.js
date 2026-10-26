import { OVERVIEW_SETTINGS } from '../config/overviewSettings.js';
import { monthRange } from './accounting/monthlyStatement.js';
import { isDepartedStatus, isOverviewWorkingBiker } from './overviewDashboard.js';
import { ADJUSTMENT_KIND, ADJUSTMENT_APPROVAL } from '../../functions/src/sweater/vocab.js';
import { SWEATER_METRICS, validDeductionDetails } from '../../functions/src/sweater/metricsContract.js';

const money = n => Math.round(n * 100) / 100;
const number = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const dayMs = day => {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? Date.parse(`${day}T00:00:00Z`) : NaN;
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day ? ms : NaN;
};

// The statement remains the existing ledger + registered operations engine.
// All new math is read-only and scoped to this page, not a second P&L.
export function overviewBusinessMetrics(ops, statement, settings = OVERVIEW_SETTINGS) {
  if (!ops) return null;
  const lastDay = monthRange(ops.from.slice(0, 7)).to;
  const monthDays = Number(lastDay.slice(8));
  const sample = ops.completedDays.slice(-settings.forecastWindowDays);
  const recentAverage = sample.length ? sample.reduce((sum, day) => sum + day.quantity, 0) / sample.length : null;
  const remainingDays = monthDays - ops.completedDays.length;
  const forecastQuantity = ops.completeMonth ? ops.quantity : recentAverage === null ? null
    // Today is an unfinished day, not another completed observation. Preserve
    // already recorded washes if today's actual exceeds the modeled day.
    : ops.completedQuantity + Math.max(ops.quantity - ops.completedQuantity, recentAverage) + recentAverage * (remainingDays - 1);
  const costs = number(statement?.totalCosts);
  const monthlyRequired = costs !== null && costs >= 0 && settings.washNetPrice > 0 ? Math.ceil(costs / settings.washNetPrice) : null;
  return { costs, monthDays, monthlyRequired,
    dailyRequired: monthlyRequired === null ? null : monthlyRequired / monthDays,
    remainingWashes: monthlyRequired === null ? null : Math.max(0, monthlyRequired - ops.quantity),
    currentDailyRate: ops.completedDays.length ? ops.completedQuantity / ops.completedDays.length : null,
    costPerWash: costs !== null && costs >= 0 && ops.quantity > 0 ? costs / ops.quantity : null,
    capacityUtilization: number(ops.averagePerBikerDay) !== null && settings.dailyAppointmentsPerBiker > 0
      ? Number(ops.averagePerBikerDay) / settings.dailyAppointmentsPerBiker * 100 : null,
    estimated: Boolean(statement?.salaryAccrual?.estimated), partialCosts: Boolean(statement?.issues?.length),
    forecastQuantity, forecastRevenue: ops.completeMonth ? number(statement?.netRevenue)
      : forecastQuantity === null ? null : forecastQuantity * settings.washNetPrice,
    recentAverage, sampleDays: sample.length, remainingDays, lastDay,
    statementDate: new Date(Date.UTC(Number(ops.from.slice(0, 4)), Number(ops.from.slice(5, 7)), settings.statementDay)).toISOString().slice(0, 10),
  };
}

export function overviewSettlements({ adjustments = [], settlements = [], periodKey, to }) {
  const inMonth = adjustments.filter(row => row.periodKey === periodKey);
  const identities = new Map(); let conflict = false;
  for (const row of inMonth) {
    const signature = JSON.stringify([row.kind, row.typeKey, row.amount, row.effectiveDate, row.approvalStatus]);
    if (identities.has(row.id) && identities.get(row.id) !== signature) conflict = true;
    identities.set(row.id, signature);
  }
  const malformed = conflict || inMonth.some(row => !Number.isFinite(dayMs(row.effectiveDate)) || String(row.effectiveDate).slice(0, 7) !== periodKey
    || number(row.amount) === null || Number(row.amount) < 0 || !row.id || !ADJUSTMENT_KIND.includes(row.kind) || !ADJUSTMENT_APPROVAL.includes(row.approvalStatus));
  const selected = [...new Map(inMonth.filter(row => row.effectiveDate <= to).map(row => [row.id, row])).values()];
  const deductionRecords = selected.filter(row => row.kind === 'deduction');
  const deductions = deductionRecords.filter(row => row.approvalStatus === 'approved');
  const pending = selected.filter(row => row.kind === 'deduction' && ['pending_review', 'disputed'].includes(row.approvalStatus));
  const matches = settlements.filter(row => row.periodKey === periodKey);
  const settlement = matches.length === 1 ? matches[0] : null;
  const expected = number(settlement?.figures?.netDue);
  const collected = number(settlement?.collectedTotal);
  // Display-only: an unresolved calculation is not an evidenced zero payment.
  const unresolvedZero = expected === 0 && number(settlement?.figures?.counts?.eligible) === 0
    && (Number(settlement?.figures?.counts?.needsReview) > 0 || Number(settlement?.figures?.counts?.unknownStatus) > 0);
  return { deductions, deductionRecordCount: deductionRecords.length,
    deductionTotal: malformed || !deductions.length ? null : money(deductions.reduce((sum, row) => sum + Number(row.amount), 0)),
    pending, pendingTotal: malformed ? null : money(pending.reduce((sum, row) => sum + Number(row.amount), 0)), malformed,
    violations: selected.filter(row => row.kind === 'deduction' && ['operational_or_traffic_violation', 'proven_damage', 'customer_compensation'].includes(row.typeKey)
      && !['rejected', 'cancelled', 'reversed'].includes(row.approvalStatus)),
    settlement, expected, unresolvedZero, collected, remaining: expected !== null && collected !== null ? money(Math.max(0, expected - collected)) : null,
    ambiguous: matches.length > 1 };
}

// Only persisted source timestamps, never guessed duration or an owner's
// completion decision. Conflicting duplicate source bookings are suppressed.
export function overviewAttention({ ops, bikers = [], bookings = [], today, settings = OVERVIEW_SETTINGS }) {
  // Left (هرب / مشيناه) with no end date on record: listed only, never edited.
  const missingEndDate = bikers.filter(biker => isDepartedStatus(biker.currentStatus, settings) && !String(biker.endDate || '').trim());
  if (!ops) return { shortWashes: [], iqamas: [], idle: [], timed: 0, missingTiming: 0, conflictingBookings: 0, missingIqama: null, missingEndDate };
  const seen = new Map(); const conflicts = new Set();
  for (const booking of bookings) {
    const row = booking.record || booking;
    if (!Number.isFinite(dayMs(row.serviceDate)) || row.serviceDate < ops.from || row.serviceDate > ops.to || !row.sspBookingId) continue;
    const item = { ...row, bikerId: booking.bikerId || booking.biker_id || row.bikerId };
    const signature = JSON.stringify([row.serviceDate, row.startedAt, row.completedAt, row.driverExternalId, item.bikerId]);
    if (seen.has(row.sspBookingId) && seen.get(row.sspBookingId).signature !== signature) conflicts.add(row.sspBookingId);
    else seen.set(row.sspBookingId, { row: item, signature });
  }
  const executed = new Map(ops.rows.filter(row => row.sspBookingId && Number(row.quantity) > 0).map(row => [row.sspBookingId, row.washDate]));
  const samples = [...seen.values()].map(item => item.row).filter(row => executed.get(row.sspBookingId) === row.serviceDate && !conflicts.has(row.sspBookingId));
  const timed = samples.flatMap(row => {
    // A date-only value is not a recorded wash time. Require an explicit
    // timezone; parsing machine-local timestamps would change the duration.
    const timestamp = value => typeof value === 'string' && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
    const duration = (timestamp(row.completedAt) - timestamp(row.startedAt)) / 60000;
    if (!Number.isFinite(duration) || duration < 0) return [];
    const matches = row.bikerId ? bikers.filter(b => b.id === row.bikerId)
      : bikers.filter(b => b.driverExternalId && String(b.driverExternalId) === String(row.driverExternalId));
    return [{ ...row, duration, biker: matches.length === 1 ? matches[0] : null }];
  });
  const current = today.slice(0, 7) === ops.from.slice(0, 7);
  const iqamas = current ? bikers.flatMap(biker => {
    const left = (dayMs(biker.iqamaExpiry) - dayMs(today)) / 86400000;
    return Number.isFinite(left) && left >= 0 && left <= settings.documentWarningDays ? [{ biker, daysLeft: left }] : [];
  }) : [];
  // Yesterday only: the last completed day. Today is still running, so a
  // missing wash today is not yet evidence of anything.
  const idle = current ? bikers.filter(isOverviewWorkingBiker).flatMap(biker => {
    const eligible = day => (!biker.startDate || biker.startDate <= day) && (!biker.endDate || biker.endDate >= day);
    const dates = [ops.yesterday].filter(day => day >= ops.from && day <= ops.to && eligible(day)
      && !ops.rows.some(row => row.washDate === day && Number(row.quantity) > 0 && !row.bikerId)
      && !ops.rows.some(row => row.bikerId === biker.id && row.washDate === day && Number(row.quantity) > 0));
    return dates.length ? [{ biker, dates }] : [];
  }) : [];
  return { shortWashes: timed.filter(row => row.duration < settings.shortWashMinutes), timed: timed.length,
    missingTiming: executed.size - timed.length, conflictingBookings: conflicts.size,
    iqamas, idle, missingIqama: bikers.filter(b => !Number.isFinite(dayMs(b.iqamaExpiry))).length, missingEndDate };
}

/**
 * The month's latest reading of Sweater's dashboards, as the overview shows it.
 * A number that did not arrive is null, never zero; deductions and additions
 * keep Sweater's classes, and only riyal deductions are added up.
 */
export function overviewSweaterMetrics(snapshot, ops) {
  if (!snapshot?.metrics || typeof snapshot.metrics !== 'object') return null;
  const value = key => (typeof snapshot.metrics[key] === 'number' && Number.isFinite(snapshot.metrics[key]) ? snapshot.metrics[key] : null);
  const items = direction => Object.entries(SWEATER_METRICS).filter(([, metric]) => metric.direction === direction)
    .map(([key, metric]) => ({ key, unit: metric.unit, value: value(key) }));
  const deductions = items('deduction');
  const money = deductions.filter(item => item.unit === 'sar' && item.value !== null);
  const completedWashes = value('completedWashes');
  const updatedAtByMetric = Object.fromEntries(Object.keys(SWEATER_METRICS).map(key => [key, value(key) === null ? null
    : snapshot.metricSources ? snapshot.metricSources[key]?.extractedAtIso ?? null : snapshot.extractedAtIso || null]));
  const deductionDetails = Object.fromEntries(deductions.filter(item => item.unit === 'sar').flatMap(({ key }) => {
    const rows = Array.isArray(snapshot.deductionDetails)
      ? validDeductionDetails(snapshot.deductionDetails, snapshot.metrics, snapshot.periodKey) ? snapshot.deductionDetails.filter(row => row.metricKey === key) : undefined
      : snapshot.deductionDetails?.[key];
    return validDeductionDetails(rows, { [key]: value(key) }, snapshot.periodKey) ? [[key, rows]] : [];
  }));
  return { updatedAtIso: snapshot.extractedAtIso || null, updatedAtByMetric, completedWashes, tipsNet: value('tipsNet'),
    washDifference: completedWashes !== null && ops ? completedWashes - ops.quantity : null,
    deductions, additions: items('addition'), deductionDetails,
    deductionMoney: money.length ? money.reduce((sum, item) => sum + item.value, 0) : null };
}
