import { OVERVIEW_SETTINGS } from '../config/overviewSettings.js';
import { availableWorkDays } from './availableWorkDays.js';

// Use the overview's already-deduplicated completed washes and its exact
// completed-day window. No attendance or calendar-day assumptions.
export function overviewBikerCapacity(ops, bikers = [], settings = OVERVIEW_SETTINGS, perBiker = null) {
  if (!ops) return null;
  if (perBiker?.periodKey === ops.from.slice(0, 7)) {
    return { rows: perBiker.rows.map(row => ({ id: row.bikerId, biker: row.biker, washes: row.washes, washDays: row.washDays,
      elapsedWorkDays: row.elapsedWorkDays, average: row.actualDaily, averagePerWashDay: row.averagePerWashDay,
      percentage: row.actualDaily !== null && settings.dailyAppointmentsPerBiker > 0 ? row.actualDaily / settings.dailyAppointmentsPerBiker * 100 : null })),
    unlinked: perBiker.unlinkedWashes, averageActualDaily: perBiker.averageActualDaily };
  }
  const completed = new Set(ops.completedDays.map(day => day.date));
  const groups = new Map(); let unlinked = 0;
  for (const row of ops.rows) {
    const quantity = Math.max(0, Number(row.quantity) || 0);
    if (!quantity) continue;
    const id = String(row.bikerId ?? row.biker_id ?? '').trim();
    if (!id) { unlinked += quantity; continue; }
    if (!groups.has(id)) groups.set(id, { id, washes: 0, days: new Set() });
    const group = groups.get(id);
    if (completed.has(row.washDate)) { group.washes += quantity; group.days.add(row.washDate); }
  }
  const rows = [...groups.values()].map(group => {
    const matches = bikers.filter(biker => String(biker.id) === group.id);
    const biker = matches.length === 1 ? matches[0] : null;
    const availability = biker ? availableWorkDays({ periodKey: ops.from.slice(0, 7), startDate: biker.startDate || null,
      endDate: biker.endDate || null, beforeDate: ops.completeMonth ? null : ops.to, monthlyDaysOff: settings.monthlyDaysOff }) : null;
    const outside = availability && [...group.days].some(day => day < availability.from || day > availability.to);
    const average = availability?.workDays > 0 && !outside ? group.washes / availability.workDays : null;
    return { id: group.id, biker: matches.length === 1 ? matches[0] : null, washes: group.washes, washDays: group.days.size, average,
      elapsedWorkDays: availability?.workDays ?? null, averagePerWashDay: group.days.size ? group.washes / group.days.size : null,
      percentage: average !== null && settings.dailyAppointmentsPerBiker > 0 ? average / settings.dailyAppointmentsPerBiker * 100 : null };
  }).sort((a, b) => (b.percentage ?? -Infinity) - (a.percentage ?? -Infinity) || a.id.localeCompare(b.id));
  const days = rows.reduce((sum, row) => sum + (row.elapsedWorkDays ?? 0), 0);
  return { rows, unlinked, averageActualDaily: rows.length && !unlinked && rows.every(row => row.average !== null) && days > 0
    ? rows.reduce((sum, row) => sum + row.washes, 0) / days : null };
}
