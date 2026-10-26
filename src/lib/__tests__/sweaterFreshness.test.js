import { it, expect } from 'vitest';
import { operationFreshness, recentImportRuns, importRunErrors, importStamp } from '../sweaterFreshness.js';
const now = Date.parse('2026-10-27T12:00:00Z');
const ago = hours => new Date(now - hours * 36e5).toISOString();
it('uses successful saves, ignoring new heartbeats, failed runs and invalid/future dates', () => {
  const value = operationFreshness({ lastSuccessAtIso: ago(14), lastOperationalSuccessAtIso: ago(4),
    lastHeartbeatAtIso: ago(0), lastAttemptAtIso: ago(0), lastAgentStatus: 'ok' }, now);
  expect(value.savedAt).toBe(ago(4)); expect(value.tone).toBe('yellow');
  expect(operationFreshness({ lastSuccessAtIso: '2099-01-01T00:00:00Z', lastOperationalSuccessAtIso: 'bad' }, now).savedAt).toBeNull();
});
it('uses the configured display thresholds with exact boundaries', () => {
  for (const [hours, tone] of [[3, 'green'], [3.01, 'yellow'], [12, 'yellow'], [12.01, 'red']])
    expect(operationFreshness({ lastSuccessAtIso: ago(hours) }, now).tone).toBe(tone);
  expect(operationFreshness({ lastSuccessAtIso: ago(2) }, now, { freshnessWarningHours: 1, freshnessCriticalHours: 2 }).tone).toBe('yellow');
});
it('does not rejuvenate stale source data with a recent narrow save', () => {
  const value = operationFreshness({ lastSuccessAtIso: ago(1), lastCoverage: { extractedAt: ago(20), isComplete: false } }, now);
  expect(value.savedAgeHours).toBe(1); expect(value.ageHours).toBe(20); expect(value.tone).toBe('red');
  expect(operationFreshness({ lastSuccessAtIso: ago(1), lastCoverage: { extractedAt: ago(-2) } }, now).sourceTimeUncertain).toBe(true);
});
it('shows every saved run in the last seven days, without a 30-record cap or future runs', () => {
  const runs = Array.from({ length: 60 }, (_, i) => ({ id: String(i), startedAtIso: ago(i) }));
  const value = recentImportRuns([...runs, { id: 'old', startedAtIso: ago(169) }, { id: 'future', startedAtIso: ago(-1) }], now);
  expect(value).toHaveLength(60); expect(value[0].id).toBe('0'); expect(value.at(-1).id).toBe('59'); expect(runs).toHaveLength(60);
});
it('preserves recorded errors and rejected reasons without mistaking coverage gaps for errors', () => {
  expect(importRunErrors({ error: { message: 'رفض الخادم' }, result: { rows: [{ outcome: 'rejected', reasonCode: 'invalid_date' }, { outcome: 'new' }], coverageIssues: ['قراءة جزئية'] } })).toEqual(['رفض الخادم', 'invalid_date']);
  expect(importRunErrors({ result: { counts: { rejected: 0 } } })).toEqual([]);
  expect(importStamp('2026-10-20T19:10:00Z')).toContain('22:10');
});
