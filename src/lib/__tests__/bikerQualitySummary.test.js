import { expect, it } from 'vitest';
import { bikerQualitySummary } from '../bikerQualitySummary.js';
import { currentManualQualityReport } from '../bikerQualitySummary.js';
const row = changes => ({ id: 'new', bikerUID: 'worker-a', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14',
  sourceReadDate: '2026-10-15', rulesVersion: 'cqo-20261014-v1', finalScore: null, status: 'incomplete',
  components: [{ key: 'duration', points: 9.3263, weight: 10, n: 19 }], ...changes });
const summarize = reports => bikerQualitySummary(reports, 'worker-a', '2026-10', '2026-10-15');
it('selects the latest suitable window without combining overlapping snapshots or source identities', () => {
  const result = summarize([row({ id: 'old', to: '2026-10-13' }), row({ id: 'wrong-worker', bikerUID: 'worker-b' }),
    row({ id: 'future', to: '2026-10-16' }), row({ id: 'wrong-month', periodKey: '2026-09' }), row()]);
  expect(result.report.id).toBe('new'); expect(result.points).toBe(9.3263); expect(result.weight).toBe(10);
  expect(result.durationN).toBe(19); expect(result.incomplete).toBe(true);
});
it('excludes old timestamp points from the current total without rewriting the saved snapshot', () => {
  const saved = row({ rulesVersion: 'cqo-20261015-v3', availablePoints: 78.41, availableWeight: 95, components: [
    { key: 'washQuality', weight: 30, points: 23.28, n: 16 }, { key: 'behavior', weight: 20, points: 18, n: 16 },
    { key: 'productivity', weight: 10, points: 10, n: 10 }, { key: 'complaints', weight: 10, points: 8.19, n: 58 },
    { key: 'cancellations', weight: 5, points: 4.17, n: 59 }, { key: 'duration', weight: 10, points: 4.77, n: 58 },
    { key: 'statusUpdates', weight: 10, points: 10, n: 59 },
  ] });
  const before = JSON.stringify(saved);
  const current = currentManualQualityReport(saved, null);
  expect(current).toMatchObject({ availablePoints: 68.41, availableWeight: 85, finalScore: null });
  expect(current.components.find(c => c.key === 'statusUpdates').points).toBeNull();
  expect(JSON.stringify(saved)).toBe(before);
});
it('accepts manual points only for the exact worker, month and reporting window', () => {
  const saved = row({ components: [{ key: 'duration', weight: 10, points: 9, n: 4 }] });
  const manual = { policy: 'manual-status-20261015-v1', bikerUID: saved.bikerUID, periodKey: saved.periodKey, from: saved.from, to: saved.to,
    confirmed: true, component: { key: 'statusUpdates', weight: 10, points: 10, n: 10, coverageComplete: true } };
  expect(currentManualQualityReport(saved, manual).availablePoints).toBe(19);
  for (const change of [{ bikerUID: 'other' }, { periodKey: '2026-09' }, { to: '2026-10-13' }])
    expect(currentManualQualityReport(saved, { ...manual, ...change }).availablePoints).toBe(9);
});
it('does not call an old report final when the manually reviewed canonical cohort changes', () => {
  const weights = { washQuality: 30, behavior: 20, productivity: 10, complaints: 10, cancellations: 5, lateness: 5, duration: 10, statusUpdates: 10 };
  const saved = row({ rulesVersion: 'cqo-20261015-v3', components: Object.entries(weights).map(([key, weight]) => ({ key, weight, points: weight, n: 8 })),
    coverage: { sourceAvailable: true, cohortHash: 'a'.repeat(64), criteria: Object.fromEntries(Object.keys(weights).map(k => [k, true])) } });
  const manual = { policy: 'manual-status-20261015-v1', bikerUID: saved.bikerUID, periodKey: saved.periodKey, from: saved.from, to: saved.to,
    cohortHash: 'a'.repeat(64), confirmed: true, component: { key: 'statusUpdates', weight: 10, points: 10, n: 8, coverageComplete: true } };
  expect(currentManualQualityReport(saved, manual).finalScore).toBe(100);
  expect(currentManualQualityReport(saved, { ...manual, cohortHash: 'b'.repeat(64) }).finalScore).toBeNull();
});
it('never falls back to an older measured snapshot when the latest one has no evidence', () => {
  const result = summarize([row({ id: 'old', to: '2026-10-13' }), row({ components: [{ key: 'duration', weight: 10, points: null, n: 0 }] })]);
  expect(result.points).toBeNull(); expect(result.weight).toBeNull(); expect(result.report.id).toBe('new');
});
it('preserves a real measured zero but rejects missing n or invented points', () => {
  expect(summarize([row({ components: [{ key: 'duration', weight: 10, points: 0, n: 4 }] })]).points).toBe(0);
  for (const value of [null, '', -1, 11, NaN]) expect(summarize([row({ components: [{ key: 'duration', weight: 10, points: value, n: 0 }] })]).points).toBeNull();
});
it('does not mutate the saved records or accept unsupported rule versions', () => {
  const reports = [row(), row({ rulesVersion: 'unapproved', to: '2026-10-15' })]; const before = JSON.stringify(reports);
  expect(summarize(reports).report.id).toBe('new'); expect(JSON.stringify(reports)).toBe(before);
});
it('selects one latest dated v2 snapshot over v1 without adding the older partial score', () => {
  const v2 = row({ id: 'v2', rulesVersion: 'cqo-20261015-v2', snapshotAt: '2026-10-15T09:00:00.000Z', components: [
    { key: 'washQuality', weight: 30, points: 18, n: 4, approximate: true },
    { key: 'behavior', weight: 20, points: 12, n: 4, approximate: true },
    { key: 'duration', weight: 10, points: 9.33, n: 19 },
  ] });
  const r = summarize([row(), v2, { ...v2, id: 'older-v2', snapshotAt: '2026-10-15T08:00:00.000Z' }]);
  expect(r.report.id).toBe('v2'); expect(r.points).toBe(39.33); expect(r.weight).toBe(60);
  expect(r.approximate).toBe(true); expect(r.ratingSamples).toEqual({ washQuality: 4, behavior: 4 });
  expect(summarize([row(), { ...v2, components: [] }]).points).toBeNull();
});
