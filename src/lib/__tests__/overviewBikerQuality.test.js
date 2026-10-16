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
