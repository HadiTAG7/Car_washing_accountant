import { availableWorkDays } from './availableWorkDays.js';
import { monthsBetween, nextMonthKey } from './accounting/incomeStatementScope.js';
const DAY = 86400000;
export function growthDay(value) {
  const day = String(value || ''), ms = Date.parse(`${day}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day ? day : null;
}
export const shiftGrowthDay = (day, amount) => new Date(Date.parse(`${day}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
export function growthDifference(current, previous) {
  return !Number.isFinite(current) || !Number.isFinite(previous) ? { delta: null, percent: null }
    : { delta: current - previous, percent: previous > 0 ? 100 * (current - previous) / previous : null };
}

/** Same fractional days off, payroll dated eligibility and completed-day
 * cutoff as biker break-even. Subtract two readings of the shared function
 * to obtain an arbitrary window, including windows crossing month boundaries. */
export function growthAvailableDays(worker, from, to) {
  let total = 0;
  for (const periodKey of monthsBetween(from.slice(0, 7), to.slice(0, 7))) {
    const p = worker.availability?.find(p => p.periodKey === periodKey);
    if (!p) {
      const segmentFrom = from > `${periodKey}-01` ? from : `${periodKey}-01`;
      const segmentTo = to.slice(0,7) === periodKey ? to : shiftGrowthDay(`${nextMonthKey(periodKey)}-01`,-1);
      if ((worker.startDate && worker.startDate > segmentTo) || (worker.endDate && worker.endDate < segmentFrom)) continue;
      return null;
    }
    const args = { periodKey, startDate: p.startDate || worker.startDate, endDate: p.endDate || worker.endDate };
    const full = availableWorkDays(args);
    if (!full || full.calendarDays !== p.daysEntitled) return null;
    const before = availableWorkDays({ ...args, beforeDate: from });
    const through = availableWorkDays({ ...args, beforeDate: shiftGrowthDay(to, 1) });
    if (!before || !through) return null;
    total += Math.max(0, through.workDays - before.workDays);
  }
  return total;
}
const value = d => d && (Object.hasOwn(d, 'recordedCount') ? d.recordedCount : d.count);
const rate = (count, days) => Number.isFinite(count) && days > 0 ? count / days : null;
export function growthMetrics({ workers = [], from, to, measurementDay, workerId = 'all', region = 'all' }) {
  if (![from, to, measurementDay].every(growthDay) || from > to || measurementDay < from || measurementDay > to
    || Date.parse(to) - Date.parse(from) > 92 * DAY) throw Error('Invalid growth period');
  const unique = [...new Map(workers.map(w => [w.id, w])).values()];
  const regions = [...new Set(unique.map(w => w.region))].sort();
  const selected = unique.filter(w => (workerId === 'all' || w.id === workerId) && (region === 'all' || w.region === region));
  const dates = [];
  for (let d = from; d <= to; d = shiftGrowthDay(d, 1)) dates.push(d);
  const previousDay = shiftGrowthDay(measurementDay, -1), sampleFrom = shiftGrowthDay(measurementDay, -7);
  const sumWindow = (w, a, b) => {
    const days = w.days.filter(d => d.date >= a && d.date <= b);
    const expected = Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;
    return days.length === expected && days.every(d => Number.isFinite(value(d))) ? days.reduce((n, d) => n + value(d), 0) : null;
  };
  const windowRate = (w, a, b, count, days) => w.days.filter(d => d.date >= a && d.date <= b && value(d) > 0)
    .every(d => growthAvailableDays(w, d.date, d.date) > 0) ? rate(count, days) : null;
  const rows = selected.map(w => {
    const current = sumWindow(w, measurementDay, measurementDay), previous = sumWindow(w, previousDay, previousDay);
    const workDays = growthAvailableDays(w, from, to), currentDays = growthAvailableDays(w, measurementDay, measurementDay), previousDays = growthAvailableDays(w, previousDay, previousDay);
    const total = sumWindow(w, from, to), baselineTotal = sumWindow(w, sampleFrom, previousDay), baselineDays = growthAvailableDays(w, sampleFrom, previousDay);
    const actualDaily = windowRate(w,from,to,total,workDays), currentRate = windowRate(w,measurementDay,measurementDay,current,currentDays),
      previousRate = windowRate(w,previousDay,previousDay,previous,previousDays), baselineRate = windowRate(w,sampleFrom,previousDay,baselineTotal,baselineDays);
    return { ...w, days: w.days.filter(d => d.date >= from && d.date <= to), total, workDays, actualDaily, current, previous,
      currentDays, previousDays, currentRate, previousRate, baselineTotal, baselineDays, baselineRate,
      daily: growthDifference(currentRate, previousRate), baseline: growthDifference(currentRate, baselineRate) };
  }).sort((a, b) => (b.actualDaily ?? -1) - (a.actualDaily ?? -1) || (b.total ?? 0) - (a.total ?? 0) || String(a.name).localeCompare(String(b.name), 'ar'));
  const sum = key => rows.length && rows.every(r => Number.isFinite(r[key])) ? rows.reduce((n, r) => n + r[key], 0) : null;
  const timeline = dates.map(date => {
    const count = rows.length && rows.every(w => w.days.some(d => d.date === date && Number.isFinite(value(d))))
      ? rows.reduce((n, w) => n + value(w.days.find(d => d.date === date)), 0) : null;
    const workDays = rows.map(w => growthAvailableDays(w, date, date));
    const denominator = workDays.every((n,i) => Number.isFinite(n) && (!(value(rows[i].days.find(d=>d.date===date)) > 0) || n > 0)) ? workDays.reduce((n, d) => n + d, 0) : null;
    return { date, count, workDays: denominator, rate: rate(count, denominator) };
  });
  const pooledRate = (numerator,denominator,personal) => rows.some(r=>r[numerator]>0&&r[personal]==null) ? null : rate(sum(numerator),sum(denominator));
  const currentRate = pooledRate('current','currentDays','currentRate'), previousRate = pooledRate('previous','previousDays','previousRate'), baselineRate = pooledRate('baselineTotal','baselineDays','baselineRate');
  return { rows, regions, activeCount: unique.length, selectedCount: rows.length, timeline, total: sum('total'), workDays: sum('workDays'),
    actualDaily: pooledRate('total','workDays','actualDaily'), current: sum('current'), previous: sum('previous'), currentRate, previousRate,
    baselineRate, daily: growthDifference(currentRate, previousRate), baseline: growthDifference(currentRate, baselineRate), sampleFrom,
    unavailableAvailability: rows.filter(r => r.workDays == null || (r.total > 0 && r.actualDaily == null)).length };
}
