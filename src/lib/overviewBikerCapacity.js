import { OVERVIEW_SETTINGS } from '../config/overviewSettings.js';

// Use the overview's already-deduplicated completed washes and its exact
// completed-day window. No attendance or calendar-day assumptions.
export function overviewBikerCapacity(ops, bikers = [], settings = OVERVIEW_SETTINGS) {
  if (!ops) return null;
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
    const average = group.days.size ? group.washes / group.days.size : null;
    return { id: group.id, biker: matches.length === 1 ? matches[0] : null, washes: group.washes, washDays: group.days.size, average,
      percentage: average !== null && settings.dailyAppointmentsPerBiker > 0 ? average / settings.dailyAppointmentsPerBiker * 100 : null };
  }).sort((a, b) => (b.percentage ?? -Infinity) - (a.percentage ?? -Infinity) || a.id.localeCompare(b.id));
  return { rows, unlinked };
}
