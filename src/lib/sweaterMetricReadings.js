import { SWEATER_METRICS, validTipsByBiker, validDeductionDetails, validCountDetails, COUNT_DETAIL_KEYS } from '../../functions/src/sweater/metricsContract.js';

const instant = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

/** Read-only composition of the existing monthly rows; never re-stamp an older metric. */
export function composeSweaterMetricReadings(rows, periodKey) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey || '')) return null;
  const start = Date.parse(`${periodKey}-01T00:00:00+03:00`);
  const readings = (Array.isArray(rows) ? rows : []).filter(row => row?.periodKey === periodKey
    && instant(row.extractedAtIso) !== null && instant(row.extractedAtIso) >= start
    && row.metrics && typeof row.metrics === 'object' && !Array.isArray(row.metrics))
    .sort((a, b) => instant(b.extractedAtIso) - instant(a.extractedAtIso)
      || (instant(b.receivedAtIso) ?? 0) - (instant(a.receivedAtIso) ?? 0)
      || String(b.id ?? '').localeCompare(String(a.id ?? '')));
  const metrics = {}; const metricSources = {}; const deductionDetails = {}; const countDetails = {}; let tipsByBiker = null;
  for (const row of readings) {
    for (const [key, { unit }] of Object.entries(SWEATER_METRICS)) {
      const value = row.metrics[key];
      const valid = typeof value === 'number' && Number.isFinite(value) && (unit === 'count'
        ? Number.isInteger(value) && value >= 0
        : Number(value.toFixed(2)) === value && (key === 'tipsNet' || value >= 0));
      if (!Object.hasOwn(metrics, key) && valid) {
        metrics[key] = value;
        metricSources[key] = { extractedAtIso: row.extractedAtIso, sourceUrl: row.sourceUrl ?? null, snapshotId: row.id ?? null };
        if (key === 'tipsNet' && validTipsByBiker(row.tipsByBiker, value)) tipsByBiker = row.tipsByBiker;
        if (COUNT_DETAIL_KEYS.includes(key) && validCountDetails(row.countDetails, row.metrics, periodKey)) {
          countDetails[key] = row.countDetails.filter(item => item.metricKey === key);
        }
        if (unit === 'sar' && SWEATER_METRICS[key].direction === 'deduction'
          && validDeductionDetails(row.deductionDetails, row.metrics, periodKey)) {
          deductionDetails[key] = row.deductionDetails.filter(item => item.metricKey === key);
        }
      }
    }
  }
  if (!Object.keys(metrics).length) return null;
  return { periodKey, metrics, metricSources, tipsByBiker, deductionDetails, countDetails };
}
