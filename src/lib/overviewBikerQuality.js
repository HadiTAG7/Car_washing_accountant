import { bikerQualitySummary } from './bikerQualitySummary';

const criteriaWeights = { washQuality: 30, behavior: 20, productivity: 10, complaints: 10,
  cancellations: 5, lateness: 5, duration: 10, statusUpdates: 10 };

// Project the same single approved snapshot and manual review as the profile.
// Never pool partial scores with different denominators or turn them into /100.
export function overviewBikerQuality(bikers, results, periodKey, today) {
  const byId = new Map((results || []).map(result => [result.bikerUID, result]));
  const rows = [...new Map(bikers.map(biker => [biker.id, biker])).values()].map(biker => {
    const result = byId.get(biker.id);
    const failed = !result || result.failed || !Array.isArray(result.data?.reports);
    const summary = bikerQualitySummary(failed ? [] : result.data.reports, biker.id, periodKey, today, failed ? null : result.data.manual);
    return { biker, failed: Boolean(failed), data: failed ? null : result.data, summary };
  }).sort((a, b) => String(a.biker.driverExternalId || '\uffff').localeCompare(String(b.biker.driverExternalId || '\uffff'), undefined, { numeric: true })
    || String(a.biker.id).localeCompare(String(b.biker.id)));
  const scored = rows.filter(row => !row.failed && row.summary.points !== null);
  // Owner-approved overview: equal-weight mean of bikers' existing points for
  // EACH criterion, not a pooled customer-star mean or a new overall /100 score.
  const criteria = Object.entries(criteriaWeights).map(([key, weight]) => {
    const values = scored.map(row => row.summary.report.components.find(c => c.key === key && c.weight === weight && Number.isFinite(c.points)))
      .filter(Boolean);
    return { key, weight, count: values.length,
      average: values.length ? values.reduce((sum, c) => sum + c.points, 0) / values.length : null,
      approximate: values.some(c => c.approximate) };
  });
  return { rows, criteria, total: rows.length, read: rows.filter(row => !row.failed).length,
    failed: rows.filter(row => row.failed).length, available: scored.length,
    complete: scored.filter(row => !row.summary.incomplete).length,
    partial: scored.filter(row => row.summary.incomplete).length,
    missing: rows.filter(row => !row.failed && row.summary.points === null).length };
}
