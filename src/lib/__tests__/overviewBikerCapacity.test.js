import { expect, it } from 'vitest';
import { overviewOperations } from '../overviewDashboard';
import { overviewBikerCapacity } from '../overviewBikerCapacity';

const wash = (id, bikerId, washDate, quantity) => ({ id, bikerId, washDate, quantity, status: 'مكتملة' });
it('uses elapsed availability per biker, excludes today, and keeps wash days informational', () => {
  const bikers = [{ id: 'a', driverExternalId: '1984' }, { id: 'b', driverExternalId: '1989' }];
  const rows = [wash('1', 'a', '2026-10-01', 4), wash('2', 'a', '2026-10-02', 8), wash('3', 'b', '2026-10-02', 12), wash('4', 'b', '2026-10-24', 80)];
  const ops = overviewOperations({ washes: rows, bikers, periodKey: '2026-10', today: '2026-10-24' });
  const result = overviewBikerCapacity(ops, bikers);
  expect(result.rows.map(r => r.averagePerWashDay).sort((a, b) => a - b)).toEqual([6, 12]);
  for (const row of result.rows) {
    expect(row.washes).toBe(12); expect(row.average).toBeCloseTo(12 / (23 * 29 / 31), 10);
    expect(row.percentage).toBeCloseTo(row.average / 8 * 100, 10);
  }
  expect(rows[3].quantity).toBe(80);
});
it('keeps unknown identities and today-only bikers explicit rather than inventing zero output or attendance', () => {
  const ops = overviewOperations({ washes: [wash('1', 'a', '2026-10-24', 1), wash('2', '', '2026-10-01', 2)], bikers: [], periodKey: '2026-10', today: '2026-10-24' });
  const result = overviewBikerCapacity(ops);
  expect(result.unlinked).toBe(2);
  expect(result.rows[0]).toMatchObject({ biker: null, washes: 0, washDays: 0, average: null, percentage: null });
  expect(overviewBikerCapacity(null)).toBeNull();
});
it('reuses the exact break-even rates rather than recomputing from wash days, without capping output', () => {
  const ops = overviewOperations({ washes: [wash('1', 'a', '2026-10-01', 10)], periodKey: '2026-10', today: '2026-10-02' });
  const perBiker = { periodKey: '2026-10', averageActualDaily: 10 / (29 / 31), unlinkedWashes: 0,
    rows: [{ bikerId: 'a', biker: { id: 'a' }, washes: 10, washDays: 1, elapsedWorkDays: 29 / 31,
      actualDaily: 10 / (29 / 31), averagePerWashDay: 10 }] };
  const result = overviewBikerCapacity(ops, [], undefined, perBiker);
  expect(result.averageActualDaily).toBe(perBiker.averageActualDaily);
  expect(result.rows[0].average).toBe(perBiker.rows[0].actualDaily);
  expect(result.rows[0].percentage).toBeCloseTo(10 / (29 / 31) / 8 * 100, 12);
  expect(result.rows[0].percentage).toBeGreaterThan(100);
});
