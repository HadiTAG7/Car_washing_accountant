import { expect, it } from 'vitest';
import { overviewBikerQuality } from '../overviewBikerQuality';
const biker = id => ({ id, driverExternalId: id === 'a' ? '1984' : '1982' });
const report = (id, extra = {}) => ({ id: `${id}-report`, bikerUID: id, periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14',
  rulesVersion: 'cqo-20261015-v3', components: [{ key: 'duration', weight: 10, points: 8, n: 3 }, { key: 'statusUpdates', weight: 10, points: 10, n: 3 }], ...extra });
it('uses the exact profile projection, not saved historical/manual points or a rescaled /100 score', () => {
  const data = [{ bikerUID: 'a', data: { reports: [report('a')] } }, { bikerUID: 'b', data: { reports: [] } }];
  const before = JSON.stringify(data);
  const result = overviewBikerQuality([biker('a'), biker('b')], data, '2026-10', '2026-10-16');
  expect(result).toMatchObject({ available: 1, partial: 1, complete: 0, missing: 1, failed: 0 });
  expect(result.rows.find(r => r.biker.id === 'a').summary).toMatchObject({ points: 8, weight: 10 });
  expect(result.rows.map(r => r.biker.id)).toEqual(['b', 'a']);
  expect(JSON.stringify(data)).toBe(before);
});
it('keeps a measured zero, missing evidence and a failed read distinct', () => {
  const result = overviewBikerQuality([biker('a'), biker('b'), biker('c')], [
    { bikerUID: 'a', data: { reports: [report('a', { components: [{ key: 'duration', points: 0, weight: 10, n: 3 }] })] } },
    { bikerUID: 'b', data: { reports: [] } }, { bikerUID: 'c', failed: true }], '2026-10', '2026-10-16');
  expect(result).toMatchObject({ available: 1, partial: 1, missing: 1, failed: 1, read: 2 });
});
it('never falls back to the wrong identity/month/future or combines overlapping snapshots', () => {
  const result = overviewBikerQuality([biker('a')], [{ bikerUID: 'a', data: { reports: [report('other'), report('a', { periodKey: '2026-09' }), report('a', { to: '2026-10-17' })] } }], '2026-10', '2026-10-16');
  expect(result.available).toBe(0); expect(result.missing).toBe(1);
});
it('averages each available biker score once, not customer stars or sample-weighted values', () => {
  const data = [{ bikerUID: 'a', data: { reports: [report('a', { components: [
    { key: 'washQuality', weight: 30, points: 18, n: 100 }, { key: 'duration', weight: 10, points: 6, n: 100 },
  ] })] } }, { bikerUID: 'b', data: { reports: [report('b', { components: [
    { key: 'washQuality', weight: 30, points: 30, n: 1 }, { key: 'duration', weight: 10, points: 10, n: 1 },
  ] })] } }, { bikerUID: 'c', data: { reports: [] } }];
  const before = JSON.stringify(data);
  const result = overviewBikerQuality([biker('a'), biker('b'), biker('b'), biker('c')], data, '2026-10', '2026-10-16');
  expect(result.criteria.find(c => c.key === 'washQuality')).toMatchObject({ average: 24, weight: 30, count: 2 });
  expect(result.criteria.find(c => c.key === 'duration')).toMatchObject({ average: 8, weight: 10, count: 2 });
  expect(JSON.stringify(data)).toBe(before);
});
it('keeps all eight agreed denominators, includes measured zero and excludes absent/failed/invalid evidence', () => {
  const result = overviewBikerQuality([biker('a'), biker('b'), biker('c'), biker('d')], [
    { bikerUID: 'a', data: { reports: [report('a', { components: [{ key: 'duration', weight: 10, points: 0, n: 3 }] })] } },
    { bikerUID: 'b', data: { reports: [report('b', { components: [{ key: 'duration', weight: 5, points: 4, n: 3 }] })] } },
    { bikerUID: 'c', failed: true }, { bikerUID: 'd', data: { reports: [] } },
  ], '2026-10', '2026-10-16');
  expect(result.criteria.map(c => [c.key, c.weight])).toEqual([
    ['washQuality', 30], ['behavior', 20], ['productivity', 10], ['complaints', 10],
    ['cancellations', 5], ['lateness', 5], ['duration', 10], ['statusUpdates', 10],
  ]);
  expect(result.criteria.find(c => c.key === 'duration')).toMatchObject({ average: 0, count: 1 });
  expect(result.criteria.find(c => c.key === 'behavior')).toMatchObject({ average: null, count: 0 });
  expect(result.criteria.find(c => c.key === 'statusUpdates')).toMatchObject({ average: null, count: 0 });
});
it('uses only the current month snapshot and current manual review for the component means', () => {
  const manual = { policy: 'manual-status-20261015-v1', bikerUID: 'a', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14', confirmed: true,
    component: { key: 'statusUpdates', points: 0, weight: 10, n: 3, coverageComplete: true } };
  const result = overviewBikerQuality([biker('a')], [{ bikerUID: 'a', data: { manual, reports: [
    report('a', { rulesVersion: 'cqo-20261014-v1', components: [{ key: 'duration', points: 2, weight: 10, n: 3 }] }),
    report('a'), report('other'), report('a', { periodKey: '2026-09' }),
  ] } }], '2026-10', '2026-10-16');
  expect(result.criteria.find(c => c.key === 'duration')).toMatchObject({ average: 8, count: 1 });
  expect(result.criteria.find(c => c.key === 'statusUpdates')).toMatchObject({ average: 0, count: 1 });
});
