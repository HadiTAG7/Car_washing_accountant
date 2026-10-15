import { expect, it } from 'vitest';
import { bikerQualitySummary } from '../bikerQualitySummary.js';
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
