import { expect, it } from 'vitest';
import { normalizeQualityReport, qualityReportId } from '../bikerQualityReports.js';

export const partialReport = () => ({ bikerUID: 'test-worker', periodKey: '2026-10',
  from: '2026-10-01', to: '2026-10-13', rulesVersion: 'cqo-20261014-v1', sourceReadDate: '2026-10-14',
  samples: [50, 60, 110].map((minutes, i) => ({ washId: `wash-${i}`, serviceDate: '2026-10-12',
    start: '2026-10-12T10:00:00+03:00', end: new Date(Date.parse('2026-10-12T10:00:00+03:00') + minutes * 60000).toISOString(),
    sourceHash: 'a'.repeat(64) })), improvement: 'Review measured exceptions without attributing cause.' });

it('averages capped per-wash duration points, never normalizes partial data to 100', () => {
  const result = normalizeQualityReport(partialReport());
  expect(result.duration.points).toBe(6);
  expect(result.duration.n).toBe(3);
  expect(result.finalScore).toBeNull();
  expect(result.status).toBe('incomplete');
  expect(result.components.filter(c => c.points === null)).toHaveLength(7);
});
it('keeps unmeasured duration unavailable rather than zero', () => {
  const result = normalizeQualityReport({ ...partialReport(), samples: [] });
  expect(result.duration).toMatchObject({ n: 0, points: null, averageMinutes: null });
});
it.each([
  { finalScore: 100 }, { bikerUID: '../worker' }, { rulesVersion: 'unapproved' },
  { from: '2026-09-01' }, { to: '2026-10-32' }, { periodKey: '2026-13' },
  { samples: [partialReport().samples[0], partialReport().samples[0]] },
  { samples: [{ ...partialReport().samples[0], end: '2026-10-12T09:00:00+03:00' }] },
  { samples: [{ ...partialReport().samples[0], serviceDate: '2026-10-14' }] },
  { samples: [{ ...partialReport().samples[0], start: '2026-10-12T10:00:00' }] },
])('rejects malformed identity, dates, duplicate evidence, and invented scores: %j', changes => {
  expect(() => normalizeQualityReport({ ...partialReport(), ...changes })).toThrow();
});
it('keys stored reports by stable UID, full period and rule version, not names', () => {
  const first = normalizeQualityReport(partialReport());
  expect(qualityReportId(first)).not.toBe(qualityReportId({ ...first, bikerUID: 'other-worker' }));
  expect(qualityReportId(first)).not.toBe(qualityReportId({ ...first, to: '2026-10-12' }));
});
