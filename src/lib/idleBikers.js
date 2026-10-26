import { OVERVIEW_SETTINGS } from '../config/overviewSettings.js';
import { availableWorkDays } from './availableWorkDays.js';
import { dailyBreakEven } from './breakEven.js';
import { monthRange } from './accounting/monthlyStatement.js';
import { uniqueCompletedCommissionWashes } from '../../functions/src/washCommission.js';

export const IDLE_REASONS = Object.freeze([
  ['documents', 'بانتظار الإقامة أو الفيزا'], ['training', 'تدريب'], ['no_bike', 'بدون دباب'],
  ['no_sweater_account', 'بدون حساب سويتر'], ['no_region', 'بدون منطقة'], ['leave', 'إجازة'],
  ['injured', 'مصاب'], ['other', 'أخرى'],
]);
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const daysBetween = (from, to) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));
const cost = line => Number(line.basicDue) + Number(line.bonus || 0) - Number(line.deduction || 0);
export const departedBiker = biker => /هرب|مشيناه/.test(String(biker.currentStatus ?? biker.current_status ?? ''));

/** Current roster follow-up, not attendance or payroll eligibility. Today is
 * unfinished; wash identity, scheduled days and salary inputs are shared with
 * the existing overview/payroll. No fact or payroll amount is changed. */
export function idleBikers({ bikers = [], washes = [], payrollLines = [], statement = null, periodKey, today,
  settings = OVERVIEW_SETTINGS, historyComplete = false } = {}) {
  const range = monthRange(periodKey);
  if (!range.from || !today) return { error: 'invalid_period', rows: [] };
  const conflicts = [];
  const completed = uniqueCompletedCommissionWashes(washes, '0001-01-01', range.to, message => conflicts.push(message))
    .filter(w => (w.washDate ?? w.wash_date) < today && Number(w.quantity) > 0);
  if (conflicts.length) return { error: 'wash_conflict', rows: [], conflicts };
  const payroll = new Map();
  for (const line of payrollLines) {
    if (!line.bikerId) continue;
    if (line.basicDue == null || !Number.isFinite(Number(line.basicDue))) return { error: 'payroll_incomplete', rows: [] };
    if (!(Number(line.daysEntitled) > 0)) continue;
    if (payroll.has(line.bikerId)) return { error: 'duplicate_payroll', rows: [] };
    payroll.set(line.bikerId, line);
  }
  const rows = [], working = [], excluded = [], legacyZero = [];
  for (const [id, line] of payroll) {
    const biker = bikers.find(b => b.id === id);
    const history = completed.filter(w => String(w.bikerId ?? w.biker_id ?? '') === String(id));
    const own = history.filter(w => (w.washDate ?? w.wash_date) >= range.from);
    const lastWash = history.map(w => w.washDate ?? w.wash_date).sort().at(-1) || null;
    if (!own.length) legacyZero.push({ bikerId: id, name: biker?.name || line.name, monthlyCost: round(cost(line)) });
    if (!biker || biker.endDate || biker.end_date || departedBiker(biker)) { excluded.push({ bikerId: id, reason: !biker ? 'missing_biker' : 'departed_or_ended' }); continue; }
    const availability = { periodKey, startDate: line.eligibleStart || line.startDate || biker.startDate || biker.start_date || null,
      endDate: line.eligibleEnd || line.endDate || null, monthlyDaysOff: settings.monthlyDaysOff };
    const full = availableWorkDays(availability), elapsed = availableWorkDays({ ...availability, beforeDate: today });
    if (!full || !elapsed || !elapsed.calendarDays || full.calendarDays !== Number(line.daysEntitled)) {
      excluded.push({ bikerId: id, reason: elapsed?.calendarDays === 0 ? 'not_started' : 'unknown_availability' }); continue;
    }
    const start = biker.startDate || biker.start_date;
    const silentDays = lastWash ? daysBetween(lastWash, elapsed.to)
      : historyComplete && start ? daysBetween(start, elapsed.to) + 1 : elapsed.calendarDays;
    const followup = biker.idleFollowup || biker.idle_follow_up || {};
    const item = { bikerId: id, biker, lastWash, silentDays, washes: own.reduce((sum, w) => sum + Number(w.quantity), 0),
      monthlyCost: round(cost(line)), costToDate: round(cost(line) * elapsed.calendarDays / Number(line.daysEntitled)),
      elapsedWorkDays: elapsed.workDays, remainingWorkDays: Math.max(0, full.workDays - elapsed.workDays),
      reasonKey: followup.reasonKey || '', expectedStartDate: followup.expectedStartDate || '', note: followup.note || '', followup,
      category: own.length ? 'stopped' : 'no_washes' };
    if (!own.length || silentDays >= settings.idleStoppedDays) {
      item.alerts = { missingReason: !IDLE_REASONS.some(([key]) => key === item.reasonKey),
        overdue: Boolean(item.expectedStartDate && item.expectedStartDate < today && (!lastWash || lastWash < item.expectedStartDate)),
        over14Days: silentDays > 14 };
      rows.push(item);
    } else working.push(item);
  }
  rows.sort((a, b) => b.silentDays - a.silentDays || String(a.biker.name).localeCompare(String(b.biker.name), 'ar'));
  const salaries = round(rows.reduce((sum, r) => sum + r.monthlyCost, 0));
  const required = dailyBreakEven({ statement, periodKey, completeMonth: range.to < today, settings });
  const without = required ? dailyBreakEven({ statement: { ...statement, totalCosts: round(statement.totalCosts - salaries) }, periodKey, completeMonth: range.to < today, settings }) : null;
  const workingDays = working.reduce((sum, r) => sum + r.elapsedWorkDays, 0);
  const workingWashes = working.reduce((sum, r) => sum + r.washes, 0);
  const average = workingDays > 0 ? workingWashes / workingDays : null;
  const remainingDays = rows.reduce((sum, r) => sum + r.remainingWorkDays, 0);
  const additionalWashes = average == null ? null : average * remainingDays;
  return { periodKey, today, rows, count: rows.length, noWashes: rows.filter(r => r.category === 'no_washes').length,
    stopped: rows.filter(r => r.category === 'stopped').length, salaries, costToDate: round(rows.reduce((sum, r) => sum + r.costToDate, 0)),
    dailyRequired: required?.required ?? null, dailyWithout: without?.required ?? null,
    alerts: Object.fromEntries(['missingReason', 'overdue', 'over14Days'].map(key => [key, rows.filter(r => r.alerts[key]).length])),
    forecast: { workingCount: working.length, workingWashes, workingDays, average, remainingDays,
      additionalWashes, additionalRevenue: additionalWashes == null ? null : additionalWashes * settings.washNetPrice,
      price: settings.washNetPrice, basis: 'remaining_scheduled_days' }, excluded,
    legacyZero: { count: legacyZero.length, salaries: round(legacyZero.reduce((sum, r) => sum + r.monthlyCost, 0)), rows: legacyZero } };
}
