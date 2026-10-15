const keys = new Set(['washQuality', 'behavior', 'productivity', 'complaints', 'cancellations', 'lateness', 'duration', 'statusUpdates']);
const validDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

// Presentation only: select ONE saved window and total its already-computed
// available components. Never combine snapshots, recalculate wash scores or
// rescale a partial denominator to 100.
export function bikerQualitySummary(reports, bikerUID, periodKey, today) {
  const empty = report => ({ report, points: null, weight: null, durationN: null, incomplete: true });
  if (!bikerUID || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey || '') || !validDay(today)) return empty(null);
  const report = (Array.isArray(reports) ? reports : []).filter(r => r?.bikerUID === bikerUID
    && r.periodKey === periodKey && r.rulesVersion === 'cqo-20261014-v1'
    && validDay(r.from) && validDay(r.to) && r.from <= r.to && r.to <= today
    && r.from.slice(0, 7) === periodKey && r.to.slice(0, 7) === periodKey)
    .sort((a, b) => b.to.localeCompare(a.to) || String(b.sourceReadDate || '').localeCompare(String(a.sourceReadDate || ''))
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.id || '').localeCompare(String(a.id || '')))[0];
  if (!report || report.status === 'outside-period' || !Array.isArray(report.components)) return empty(report || null);
  const available = report.components.filter(c => c.points !== null && c.points !== undefined);
  if (!available.length || new Set(available.map(c => c.key)).size !== available.length
    || available.some(c => !keys.has(c.key) || !Number.isFinite(c.points) || !Number.isFinite(c.weight)
      || c.weight <= 0 || c.points < 0 || c.points > c.weight || !Number.isInteger(c.n) || c.n <= 0)) return empty(report);
  const weight = available.reduce((sum, c) => sum + c.weight, 0);
  if (weight > 100) return empty(report);
  return { report, points: available.reduce((sum, c) => sum + c.points, 0), weight,
    durationN: available.find(c => c.key === 'duration')?.n ?? null,
    incomplete: report.finalScore === null || report.finalScore === undefined || weight < 100 };
}
