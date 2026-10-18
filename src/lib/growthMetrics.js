// Read-only analytical projection. No attendance, payroll or source mutations.
const DAY = 86_400_000;
export function growthDay(value) {
  const day = String(value || '');
  const ms = Date.parse(`${day}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(ms)
    && new Date(ms).toISOString().slice(0, 10) === day ? day : null;
}
export const shiftGrowthDay = (day, amount) => new Date(Date.parse(`${day}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10);

export function growthDifference(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { delta: null, percent: null };
  return { delta: current - previous, percent: previous > 0 ? 100 * (current - previous) / previous : null };
}

// Never jump over an unknown day to select seven conveniently positive days.
// A documented non-workday may be skipped; a documented workday with zero
// washes must stay in the denominator. Working status alone is not evidence.
export function verifiedWorkdayBaseline(days, measurementDay, requestedDays = 7) {
  const prior = [...days].filter(d => d.date < measurementDay).sort((a, b) => b.date.localeCompare(a.date));
  const sample = [];
  let expected = shiftGrowthDay(measurementDay, -1);
  let gap = false;
  for (const day of prior) {
    if (sample.length === requestedDays) break;
    if (day.date !== expected || day.coverage !== 'complete' || day.workEligible == null) { gap = true; break; }
    expected = shiftGrowthDay(expected, -1);
    if (day.workEligible === false) continue;
    if (!Number.isFinite(day.count) || day.count < 0) { gap = true; break; }
    sample.push(day);
  }
  if (gap || !sample.length) return { available: false, mean: null, total: null, dates: [], sampleSize: null, provisional: false };
  const total = sample.reduce((n, d) => n + d.count, 0);
  return { available: true, mean: total / sample.length, total, dates: sample.map(d => d.date).sort(), sampleSize: sample.length,
    provisional: sample.length < requestedDays };
}

function recordedAverage(days) {
  const recorded = days.filter(d => Number.isFinite(d.count) && d.count > 0);
  const total = recorded.reduce((n, d) => n + d.count, 0);
  return { total, dayCount: recorded.length, dates: recorded.map(d => d.date), mean: recorded.length ? total / recorded.length : null };
}

// Input is already authoritatively scoped by the read adapter: explicit roster
// state, stable identity, unique completed services, coverage and exact period.
// This module deliberately cannot turn a roster snapshot into a live status.
export function growthMetrics({ workers = [], from, to, measurementDay, workerId = 'all', region = 'all' }) {
  if (![from, to, measurementDay].every(growthDay) || from > to || measurementDay < from || measurementDay > to
    || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY > 92) throw new Error('Invalid growth period');
  const identities = new Set();
  const active = workers.filter(w => {
    if (w.status !== 'Active' || !w.id || identities.has(w.id)) return false;
    identities.add(w.id); return true;
  });
  const regions = [...new Set(active.map(w => w.region).filter(Boolean))].sort();
  const selection = active.filter(w => (workerId === 'all' || w.id === workerId) && (region === 'all' || w.region === region));
  const dates = [];
  for (let date = from; date <= to; date = shiftGrowthDay(date, 1)) dates.push(date);
  const rows = selection.map(worker => {
    const byDate = new Map(worker.days.map(d => [d.date, d]));
    const days = dates.map(date => byDate.get(date) || { date, count: null, coverage: 'unavailable', workEligible: null });
    const currentDay = byDate.get(measurementDay);
    const previousDay = byDate.get(shiftGrowthDay(measurementDay, -1));
    const dailyValue = d => d?.coverage === 'complete' && Number.isFinite(d.count) ? d.count : null;
    const current = dailyValue(currentDay), previous = dailyValue(previousDay);
    const baseline = verifiedWorkdayBaseline(worker.days, measurementDay);
    return { id: worker.id, code: worker.code, name: worker.name, region: worker.region, days, current, previous,
      daily: growthDifference(current, previous), baseline: { ...baseline, ...growthDifference(current, baseline.mean) },
      generalAverage: recordedAverage(days) };
  });
  const timeline = dates.map(date => {
    const entries = rows.map(row => row.days.find(d => d.date === date));
    const known = entries.filter(d => Number.isFinite(d.count));
    const complete = entries.length > 0 && entries.every(d => d.coverage === 'complete' && Number.isFinite(d.count));
    return { date, count: known.length ? known.reduce((n, d) => n + d.count, 0) : null, coverage: complete ? 'complete' : 'partial' };
  });
  const completeSum = key => rows.length && rows.every(row => Number.isFinite(row[key])) ? rows.reduce((n, row) => n + row[key], 0) : null;
  const current = completeSum('current'), previous = completeSum('previous');
  const availableBaselines = rows.filter(row => row.baseline.available).length;
  // There is intentionally no synthetic team "personal" baseline assembled
  // from the two workers whose evidence happens to be complete.
  const baseline = rows.length === 1 ? rows[0].baseline : { available: false, mean: null, sampleSize: null,
    dates: [], availableWorkers: availableBaselines, totalWorkers: rows.length, delta: null, percent: null };
  return { from, to, measurementDay, activeCount: active.length, regions, selectedCount: rows.length, rows, timeline,
    current, previous, daily: growthDifference(current, previous), baseline, generalAverage: recordedAverage(timeline) };
}
