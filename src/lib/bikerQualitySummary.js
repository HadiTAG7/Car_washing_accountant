const keys = new Set(['washQuality', 'behavior', 'productivity', 'complaints', 'cancellations', 'lateness', 'duration', 'statusUpdates']);
const validDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

// Presentation only: select ONE saved window and total its already-computed
// available components. Never combine snapshots, recalculate wash scores or
// rescale a partial denominator to 100.
export function currentManualQualityReport(report, manual) {
  if (!report || !Array.isArray(report.components)) return report;
  const matches = manual?.policy === 'manual-status-20261015-v1' && manual.bikerUID === report.bikerUID
    && manual.periodKey === report.periodKey && manual.from === report.from && manual.to === report.to;
  const component = matches ? manual.component : { key: 'statusUpdates', weight: 10, points: null, n: null,
    reason: 'awaiting-manual-status-review' };
  const components = [...report.components.filter(c => c.key !== 'statusUpdates'), component];
  const known = components.filter(c => Number.isFinite(c.points));
  const availableWeight = known.reduce((sum, c) => sum + c.weight, 0);
  const availablePoints = known.length ? Math.round(known.reduce((sum, c) => sum + c.points, 0) * 100) / 100 : null;
  const complete = report.rulesVersion === 'cqo-20261015-v3' && matches && manual.confirmed && availableWeight === 100
    && report.coverage?.sourceAvailable && report.coverage?.cohortHash === manual.cohortHash
    && !report.coverage?.excludedSourceRecords && !report.evidence?.gaps?.length
    && components.every(c => c.n > 0 && (c.key === 'statusUpdates' ? c.coverageComplete : report.coverage?.criteria?.[c.key]));
  return { ...report, components, availableWeight, availablePoints, finalScore: complete ? availablePoints : null,
    status: report.status === 'outside-period' ? report.status : complete ? 'complete' : 'incomplete', manualPolicyApplied: true };
}
export function selectBikerQualityReport(reports, bikerUID, periodKey, today) {
  if (!bikerUID || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey || '') || !validDay(today)) return null;
  return (Array.isArray(reports) ? reports : []).filter(r => r?.bikerUID === bikerUID
    && r.periodKey === periodKey && ['cqo-20261014-v1', 'cqo-20261015-v2', 'cqo-20261015-v3'].includes(r.rulesVersion)
    && validDay(r.from) && validDay(r.to) && r.from <= r.to && r.to <= today
    && r.from.slice(0, 7) === periodKey && r.to.slice(0, 7) === periodKey)
    .sort((a, b) => b.rulesVersion.localeCompare(a.rulesVersion) || b.to.localeCompare(a.to) || String(b.snapshotAt || '').localeCompare(String(a.snapshotAt || ''))
      || String(b.sourceReadDate || '').localeCompare(String(a.sourceReadDate || ''))
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.id || '').localeCompare(String(a.id || '')))[0] || null;
}
export function bikerQualitySummary(reports, bikerUID, periodKey, today, manual) {
  const empty = report => ({ report, points: null, weight: null, durationN: null, incomplete: true });
  const saved = selectBikerQualityReport(reports, bikerUID, periodKey, today);
  const report = currentManualQualityReport(saved, manual);
  if (!report || report.status === 'outside-period' || !Array.isArray(report.components)) return empty(report || null);
  const available = report.components.filter(c => c.points !== null && c.points !== undefined);
  if (!available.length || new Set(available.map(c => c.key)).size !== available.length
    || available.some(c => !keys.has(c.key) || !Number.isFinite(c.points) || !Number.isFinite(c.weight)
      || c.weight <= 0 || c.points < 0 || c.points > c.weight || !Number.isInteger(c.n) || c.n <= 0)) return empty(report);
  const weight = available.reduce((sum, c) => sum + c.weight, 0);
  if (weight > 100) return empty(report);
  return { report, points: available.reduce((sum, c) => sum + c.points, 0), weight,
    durationN: available.find(c => c.key === 'duration')?.n ?? null,
    durationTotal: report.coverage?.canonicalCompleted ?? null,
    approximate: available.some(c => c.approximate),
    ratingSamples: Object.fromEntries(available.filter(c => ['washQuality', 'behavior'].includes(c.key)).map(c => [c.key, c.n])),
    incomplete: !Number.isFinite(report.finalScore) || report.status !== 'complete' || weight < 100 };
}
