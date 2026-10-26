import { describe, expect, it } from 'vitest';
import { composeSweaterMetricReadings } from '../sweaterMetricReadings';
import { overviewSweaterMetrics } from '../overviewInsights';

const period = '2026-10';
const early = { id: 'early', periodKey: period, extractedAtIso: '2026-10-23T06:00:00Z', sourceUrl: 'https://ssp-portal.sweater.sa/dashboards/business', metrics: { completedWashes: 400, tipsNet: 50 } };
const later = { id: 'later', periodKey: period, extractedAtIso: '2026-10-23T07:00:00Z', sourceUrl: 'https://ssp-portal.sweater.sa/dashboards/compensations', metrics: { violations: 100, damages: 0, compensations: 0, freeWashCompensation: 2, cancelledByBiker: 3, cancelledMaintenance: 1, cancelledByCustomer: 4 } };

describe('monthly source readings, composed independently per metric', () => {
  it('keeps deduction details with their exact source cut and never borrows older attribution', () => {
    const detail = { metricKey: 'violations', sourceId: 'case-a', driverExternalId: 'TEST-A', date: '2026-10-20', amount: 100,
      category: 'Test reason', sourceUrl: 'https://ssp-portal.sweater.sa/violations/case-a', bookingId: null };
    const detailed = { ...later, deductionDetails: [detail] };
    const result = composeSweaterMetricReadings([early, detailed], period);
    expect(result.deductionDetails.violations).toEqual([detail]);
    expect(overviewSweaterMetrics(result).deductionDetails.violations).toEqual([detail]);
    expect(result.metricSources.tipsNet.extractedAtIso).toBe(early.extractedAtIso);
    const newer = { ...later, extractedAtIso: '2026-10-23T08:00:00Z' };
    expect(composeSweaterMetricReadings([detailed, newer], period).deductionDetails.violations).toBeUndefined();
    expect(composeSweaterMetricReadings([{ ...detailed, deductionDetails: [{ ...detail, amount: 99 }] }], period).deductionDetails).toEqual({});
    expect(overviewSweaterMetrics({ ...detailed, periodKey: '2026-09' }).deductionDetails).toEqual({});
  });
  it('binds biker attribution to the exact selected net-tips reading, never another snapshot or month', () => {
    const detailed = { ...early, tipsByBiker: [{ driverExternalId: '1984', netAmount: 50 }] };
    expect(composeSweaterMetricReadings([detailed, later], period).tipsByBiker).toEqual(detailed.tipsByBiker);
    const newerTotal = { ...later, metrics: { tipsNet: 60 } };
    expect(composeSweaterMetricReadings([detailed, newerTotal], period).tipsByBiker).toBeNull();
    expect(composeSweaterMetricReadings([{ ...detailed, tipsByBiker: [{ driverExternalId: '1984', netAmount: 49 }] }], period).tipsByBiker).toBeNull();
    expect(composeSweaterMetricReadings([{ ...detailed, periodKey: '2026-09' }, early], period).tipsByBiker).toBeNull();
  });
  it('keeps all nine fields after a partial update and retains each original time and source without mutating rows', () => {
    const rows = [early, later]; const before = JSON.stringify(rows);
    const result = composeSweaterMetricReadings(rows, period);
    expect(result.metrics).toEqual({ ...early.metrics, ...later.metrics });
    expect(result.metricSources.tipsNet).toEqual({ extractedAtIso: early.extractedAtIso, sourceUrl: early.sourceUrl, snapshotId: early.id });
    expect(result.metricSources.violations).toEqual({ extractedAtIso: later.extractedAtIso, sourceUrl: later.sourceUrl, snapshotId: later.id });
    expect(JSON.stringify(rows)).toBe(before);
    expect(result.extractedAtIso).toBeUndefined(); // No fake common freshness.
    const overview = overviewSweaterMetrics(result, { quantity: 380 });
    expect(overview).toMatchObject({ completedWashes: 400, tipsNet: 50, deductionMoney: 100, washDifference: 20 });
    expect(overview.updatedAtByMetric).toMatchObject({ completedWashes: early.extractedAtIso, tipsNet: early.extractedAtIso, violations: later.extractedAtIso });
  });

  it('chooses by extraction time, not arrival or array order; explicit newer zero replaces a nonzero reading', () => {
    const zero = { ...later, metrics: { tipsNet: 0 } };
    const oldReplay = { ...early, receivedAtIso: '2026-10-24T09:00:00Z' };
    const expected = composeSweaterMetricReadings([early, zero, oldReplay], period);
    expect(expected.metrics).toEqual({ completedWashes: 400, tipsNet: 0 });
    expect(composeSweaterMetricReadings([zero, oldReplay, early, zero], period)).toEqual(expected);
    expect(expected.metricSources.completedWashes.extractedAtIso).toBe(early.extractedAtIso);
  });

  it('does not replace valid older values with nulls, malformed amounts/counts or unknown fields', () => {
    for (const metrics of [null, [], { tipsNet: null, completedWashes: null }, { tipsNet: '0', completedWashes: 3.5 },
      { tipsNet: NaN, completedWashes: -1 }, { tipsNet: 1.005, completedWashes: Infinity }, { unknown: 5 }]) {
      expect(composeSweaterMetricReadings([early, { ...later, metrics }], period).metrics).toEqual(early.metrics);
    }
    const result = composeSweaterMetricReadings([{ ...later, metrics: { violations: -10, tipsNet: -1.25 } }], period);
    expect(result.metrics).toEqual({ tipsNet: -1.25 });
    expect(result.metrics.violations).toBeUndefined();
  });

  it('isolates months and skips undated, timezone-less or pre-month rows rather than implying freshness', () => {
    const bad = ['bad', null, '2026-10-23', '2026-10-23T08:00:00', '2026-09-30T00:00:00Z'].map(extractedAtIso => ({ ...later, extractedAtIso }));
    expect(composeSweaterMetricReadings([...bad, { ...later, periodKey: '2026-09' }, early], period).metrics).toEqual(early.metrics);
    expect(composeSweaterMetricReadings([early], '2026-09')).toBeNull();
    expect(composeSweaterMetricReadings([early], '2026-13')).toBeNull();
    expect(composeSweaterMetricReadings(undefined, period)).toBeNull();
    expect(composeSweaterMetricReadings(bad, period)).toBeNull();
  });

  it('resolves equal extraction times deterministically with receipt time and row id', () => {
    const a = { ...early, id: 'a', receivedAtIso: '2026-10-23T06:01:00Z' };
    const b = { ...a, id: 'b', metrics: { completedWashes: 410 } };
    expect(composeSweaterMetricReadings([a, b], period)).toEqual(composeSweaterMetricReadings([b, a], period));
    expect(composeSweaterMetricReadings([a, b], period).metrics.completedWashes).toBe(410);
  });
});
