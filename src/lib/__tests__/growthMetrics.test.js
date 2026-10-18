import { describe, expect, it } from 'vitest';
import { growthDay, growthDifference, growthMetrics, verifiedWorkdayBaseline } from '../growthMetrics';

const period = { from: '2026-10-10', to: '2026-10-17', measurementDay: '2026-10-17' };
const dates = Array.from({ length: 8 }, (_, i) => `2026-10-${10 + i}`);
const worker = (id, counts, extra = {}) => ({ id, code: id, name: id, status: 'Active', region: 'A',
  days: dates.map((date, i) => ({ date, count: counts[i], coverage: 'complete', workEligible: true })), ...extra });

describe('owner-approved growth metrics', () => {
  it('keeps comparisons from documented lookback when the visible range starts on D', () => {
    const result = growthMetrics({ ...period, from: period.to, workers: [worker('1984', [5, 4, 5, 4, 6, 7, 4, 7])] });
    expect(result.previous).toBe(4);
    expect(result.baseline.mean).toBe(5);
    expect(result.timeline).toHaveLength(1);
    expect(result.generalAverage.total).toBe(7);
  });
  it('compares D to D-1, not to a more convenient earlier workday', () => {
    const result = growthMetrics({ ...period, workers: [worker('1984', [5, 4, 5, 4, 6, 7, 4, 7])] });
    expect(result.current).toBe(7); expect(result.previous).toBe(4);
    expect(result.daily).toEqual({ delta: 3, percent: 75 });
    expect(result.baseline.mean).toBe(5);
    expect(result.baseline.dates).not.toContain('2026-10-17');
    expect(result.baseline.delta).toBe(2); expect(result.baseline.percent).toBe(40);
  });
  it('keeps measured zero and never divides by it for a percentage', () => {
    expect(growthDifference(7, 0)).toEqual({ delta: 7, percent: null });
    expect(growthDifference(0, 0)).toEqual({ delta: 0, percent: null });
    expect(growthDifference(0, 5)).toEqual({ delta: -5, percent: -100 });
    expect(growthDifference(null, 5)).toEqual({ delta: null, percent: null });
  });
  it('includes documented zero-work days and skips only documented non-workdays', () => {
    const days = worker('a', [2, 3, 4, 5, 0, 2, 5, 7]).days;
    const baseline = verifiedWorkdayBaseline(days, '2026-10-17');
    expect(baseline.sampleSize).toBe(7); expect(baseline.mean).toBe(3);
    days[4].workEligible = false;
    expect(verifiedWorkdayBaseline(days, '2026-10-17')).toMatchObject({ sampleSize: 6, provisional: true, mean: 3.5 });
  });
  it('does not jump over unknown availability or partial completion', () => {
    const days = worker('a', [5, 5, 5, 5, 5, 5, 5, 7]).days;
    days[3].workEligible = null;
    expect(verifiedWorkdayBaseline(days, '2026-10-17').mean).toBeNull();
    days[3].workEligible = true; days[3].coverage = 'partial';
    expect(verifiedWorkdayBaseline(days, '2026-10-17').mean).toBeNull();
  });
  it('uses the union of recorded dates for the team average, not mean of averages', () => {
    const a = worker('a', [1, 2, 0, 0, 0, 0, 0, 0]);
    const b = worker('b', [0, 4, 6, 0, 0, 0, 0, 0]);
    const result = growthMetrics({ ...period, workers: [a, b] });
    expect(result.generalAverage).toMatchObject({ total: 13, dayCount: 3, mean: 13 / 3 });
    expect(result.rows.map(row => row.generalAverage.mean)).toEqual([1.5, 5]);
  });
  it('filters every consumer and keeps Active workers without recorded washes', () => {
    const result = growthMetrics({ ...period, workers: [worker('1982', Array(8).fill(0)),
      worker('1984', Array(8).fill(5)), worker('1985', Array(8).fill(100), { status: 'Left' }),
      worker('x', Array(8).fill(20), { region: 'B' })], region: 'A' });
    expect(result.activeCount).toBe(3); expect(result.selectedCount).toBe(2);
    expect(result.rows.map(row => row.id)).toEqual(['1982', '1984']);
    expect(result.current).toBe(5); expect(result.timeline.every(d => d.count === 5)).toBe(true);
    expect(result.generalAverage.total).toBe(40);
    expect(result.rows[0].generalAverage.mean).toBeNull();
    expect(result.baseline.mean).toBeNull();
  });
  it('distinguishes a missing daily value from a complete zero and de-duplicates identities', () => {
    const a = worker('a', Array(8).fill(0)); a.days.at(-1).coverage = 'partial';
    const result = growthMetrics({ ...period, workers: [a, a] });
    expect(result.rows).toHaveLength(1); expect(result.current).toBeNull(); expect(result.previous).toBe(0);
  });
  it('keeps full precision until display and rejects invalid periods', () => {
    expect(growthDay('2026-02-30')).toBeNull();
    expect(() => growthMetrics({ ...period, to: '2026-10-09' })).toThrow();
    expect(() => growthMetrics({ ...period, measurementDay: '2026-10-18' })).toThrow();
    expect(growthMetrics({ ...period, workers: [worker('a', [1, 1, 0, 1, 0, 0, 0, 0])] }).generalAverage.mean).toBe(1);
  });
});
