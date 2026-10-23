import { expect, it } from 'vitest';
import { overviewOperations } from '../overviewDashboard';
import { overviewBikerCapacity } from '../overviewBikerCapacity';

const wash = (id, bikerId, washDate, quantity) => ({ id, bikerId, washDate, quantity, status: 'مكتملة' });
it('uses completed wash days per biker, excludes today, and does not cap output at 100%', () => {
  const bikers = [{ id: 'a', driverExternalId: '1984' }, { id: 'b', driverExternalId: '1989' }];
  const rows = [wash('1', 'a', '2026-10-01', 4), wash('2', 'a', '2026-10-02', 8), wash('3', 'b', '2026-10-02', 12), wash('4', 'b', '2026-10-24', 80)];
  const ops = overviewOperations({ washes: rows, bikers, periodKey: '2026-10', today: '2026-10-24' });
  const result = overviewBikerCapacity(ops, bikers);
  expect(result.rows.map(r => [r.biker.driverExternalId, r.washes, r.washDays, r.average, r.percentage])).toEqual([
    ['1989', 12, 1, 12, 150], ['1984', 12, 2, 6, 75],
  ]);
  expect(rows[3].quantity).toBe(80);
});
it('keeps unknown identities and today-only bikers explicit rather than inventing zero output or attendance', () => {
  const ops = overviewOperations({ washes: [wash('1', 'a', '2026-10-24', 1), wash('2', '', '2026-10-01', 2)], bikers: [], periodKey: '2026-10', today: '2026-10-24' });
  const result = overviewBikerCapacity(ops);
  expect(result.unlinked).toBe(2);
  expect(result.rows[0]).toMatchObject({ biker: null, washes: 0, washDays: 0, average: null, percentage: null });
  expect(overviewBikerCapacity(null)).toBeNull();
});
