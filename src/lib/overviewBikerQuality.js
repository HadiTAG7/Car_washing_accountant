import { bikerQualitySummary } from './bikerQualitySummary';

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
  return { rows, total: rows.length, read: rows.filter(row => !row.failed).length,
    failed: rows.filter(row => row.failed).length, available: scored.length,
    complete: scored.filter(row => !row.summary.incomplete).length,
    partial: scored.filter(row => row.summary.incomplete).length,
    missing: rows.filter(row => !row.failed && row.summary.points === null).length };
}
