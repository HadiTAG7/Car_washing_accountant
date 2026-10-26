import { bikerQualitySummary, selectBikerQualityReport } from './bikerQualitySummary.js';

export const QUALITY_CRITERIA_LABELS = {
  washQuality: 'جودة الغسيل', behavior: 'السلوك', productivity: 'الإنتاجية', complaints: 'الشكاوى',
  cancellations: 'الإلغاء', lateness: 'التأخر', duration: 'مدة الغسلة', statusUpdates: 'المراجعة اليدوية لتحديث الحالة',
};
const instant = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const riyadhDay = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date(value));
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// Projection of the existing admin-only readMonth response, never a local
// candidate, a new quality calculation, or the overview's assumed /100 score.
export function publishedQualityReview(bikers, results, periodKey, today) {
  const ids = [...new Set((bikers || []).map(b => b.id).filter(Boolean))];
  const selected = [], windows = new Map();
  let failed = 0, missing = 0, invalid = 0, complete = 0, partial = 0, outside = 0, sourceUnavailable = 0;
  for (const id of ids) {
    const matches = (Array.isArray(results) ? results : []).filter(row => row?.bikerUID === id);
    if (matches.length !== 1 || matches[0].failed || !Array.isArray(matches[0].data?.reports)) { failed++; continue; }
    const { reports, manual, source } = matches[0].data;
    const saved = selectBikerQualityReport(reports, id, periodKey, today);
    if (!saved) {
      if (reports.some(r => r?.bikerUID === id && r.periodKey === periodKey)) invalid++;
      else missing++;
      continue;
    }
    // These fields are supplied by the existing save/read path, not by a
    // report candidate. No publication or freshness claim without them.
    if (typeof saved.id !== 'string' || !saved.id || !/^[a-f0-9]{64}$/.test(saved.contentHash || '') || !instant(saved.createdAt)
      || riyadhDay(saved.createdAt) > today || !['incomplete', 'complete', 'outside-period'].includes(saved.status)
      || !validDay(saved.sourceReadDate) || saved.sourceReadDate < saved.to || saved.sourceReadDate > today
      || (saved.snapshotAt && (!instant(saved.snapshotAt) || riyadhDay(saved.snapshotAt) > today))) { invalid++; continue; }
    const summary = bikerQualitySummary(reports, id, periodKey, today, manual);
    if (!Array.isArray(saved.components) || summary.points === null && saved.components.some(c => c.points != null)) { invalid++; continue; }
    selected.push({ saved, summary });
    const window = `${saved.from}:${saved.to}`;
    windows.set(window, { from: saved.from, to: saved.to, count: (windows.get(window)?.count || 0) + 1 });
    if (saved.status === 'outside-period') outside++;
    else {
      if (!source?.available) sourceUnavailable++;
      if (summary.incomplete) partial++; else complete++;
    }
  }
  const assessed = selected.filter(row => row.saved.status !== 'outside-period');
  const criteria = Object.entries(QUALITY_CRITERIA_LABELS).map(([key, label]) => {
    const available = assessed.filter(({ summary }) => summary.report?.components?.some(c => c.key === key && Number.isFinite(c.points) && c.n > 0));
    const covered = available.filter(({ summary }) => key === 'statusUpdates'
      ? summary.report.components.find(c => c.key === key)?.coverageComplete === true
      : summary.report.coverage?.criteria?.[key] === true);
    return { key, label, available: available.length, covered: covered.length, total: assessed.length };
  });
  const published = selected.map(row => row.saved.createdAt).sort((a, b) => Date.parse(a) - Date.parse(b));
  const cuts = selected.map(row => row.saved.snapshotAt).filter(instant).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { periodKey, requested: ids.length, published: selected.length, failed, missing, invalid, complete, partial, outside, sourceUnavailable,
    latestPublishedAt: published.at(-1) || null, oldestCut: cuts[0] || null, latestCut: cuts.at(-1) || null,
    windows: [...windows.values()].sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from)), criteria,
    hasIssues: !assessed.length || failed > 0 || missing > 0 || invalid > 0 || partial > 0 || sourceUnavailable > 0 };
}
