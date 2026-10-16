import { describe, it, expect } from 'vitest';
import { overviewOperations, overviewQuality, overviewWindow } from '../overviewDashboard';

const opts = { periodKey: '2026-10', today: '2026-10-16' };
const wash = (id, washDate, quantity = 1, extra = {}) => ({ id, washDate, quantity, status: 'مكتملة', ...extra });
const booking = (id, rating, extra = {}) => ({ record: { sspBookingId: id, serviceDate: '2026-10-15', rating, ...extra } });
describe('management overview, descriptive operations only', () => {
  it('averages biker wash days, not current working status or idle days, counting each worker/day once', () => {
    const washes = [wash('a', '2026-10-14', 4, { bikerId: 'a' }), wash('b', '2026-10-14', 2, { bikerId: 'a' }),
      wash('c', '2026-10-15', 2, { bikerId: 'a' }), wash('d', '2026-10-15', 4, { biker_id: 'b' }),
      wash('e', '2026-10-16', 0, { bikerId: 'idle' })];
    expect(overviewOperations({ ...opts, washes, bikers: [{ id: 'a', currentStatus: 'تدريب' }] }))
      .toMatchObject({ bikerWashDays: 3, washingBikers: 2, averagePerBikerDay: 4 });
    expect(overviewOperations({ ...opts }).averagePerBikerDay).toBeNull();
  });
  it('does not invent worker identities from names or silently exclude unlinked washes from the average', () => {
    const washes = [wash('a', '2026-10-15', 3, { bikerId: 'a' }), wash('b', '2026-10-15', 2, { bikerName: 'Same' })];
    expect(overviewOperations({ ...opts, washes })).toMatchObject({ quantity: 5, averagePerBikerDay: null, unlinkedBikerWashes: 1 });
  });
  it('compares current months with elapsed days and handles short months and closed months', () => {
    expect(overviewWindow('2026-10', '2026-10-16')).toMatchObject({ to: '2026-10-16', previousTo: '2026-09-16', completeMonth: false });
    expect(overviewWindow('2024-03', '2024-03-31').previousTo).toBe('2024-02-29');
    expect(overviewWindow('2026-09', '2026-10-16')).toMatchObject({ to: '2026-09-30', previousTo: '2026-08-31', completeMonth: true });
    expect(overviewWindow('2026-11', '2026-10-16')).toBeNull();
    expect(overviewWindow('2026-99', '2026-10-16')).toBeNull();
  });
  it('counts saved completed quantities once, keeps yesterday distinct, and averages wash days only', () => {
    const washes = [wash('a', '2026-10-15', 3), wash('b', '2026-10-16', 1, { sspBookingId: 'SSP' }),
      wash('copy', '2026-10-16', 1, { sspBookingId: 'SSP' }), wash('raw', '2026-10-16', 99, { status: 'pending' }),
      wash('future', '2026-10-17', 50), wash('prior', '2026-09-16', 2), wash('outside', '2026-09-17', 20)];
    const before = structuredClone(washes);
    expect(overviewOperations({ ...opts, washes })).toMatchObject({ quantity: 4, previousQuantity: 2, yesterdayQuantity: 3, average: 2, washDays: 2 });
    expect(washes).toEqual(before);
  });
  it('reports conflicting execution IDs rather than allowing an unqualified metric', () => {
    expect(overviewOperations({ ...opts, washes: [wash('a', '2026-10-15', 1, { sspBookingId: 'same' }),
      wash('b', '2026-10-16', 1, { sspBookingId: 'same' })] }).conflicts).toHaveLength(1);
  });
  it('does not infer current working status from wages, starts, washes or missing status', () => {
    expect(overviewOperations({ ...opts, bikers: [{ currentStatus: 'يشتغل' }, { currentStatus: 'Working' },
      { currentStatus: 'شغال' }, { currentStatus: 'تدريب' }, { salary: 900 }, { currentStatus: 'هرب' }] })).toMatchObject({ working: 3, unspecified: 1, average: null });
  });
});
describe('quality sample, not a full quality assessment', () => {
  it('uses valid ratings only, rejects blanks/null/invalid stars and deduplicates bookings and ticket refs', () => {
    const rows = [booking('a', 5, { ticketRef: 'T-1' }), booking('a', 5, { ticketRef: 'T-1' }), booking('b', '3', { ticketRef: 'T-1' }),
      ...[null, '', ' ', 0, 6, 'bad'].map((rating, i) => booking(`missing-${i}`, rating, { ticketRef: 123 })),
      booking('old', 1, { serviceDate: '2026-09-30' }), booking('future', 1, { serviceDate: '2026-10-17' })];
    const q = overviewQuality({ ...opts, bookings: rows });
    expect(q.average).toBe(4); expect(q.rated).toHaveLength(2); expect(q.low).toHaveLength(1);
    expect(q.tickets).toEqual(['T-1']); expect(q.conflicts).toBe(0); expect(q.excluded).toBe(2);
    expect(overviewQuality({ ...opts }).average).toBeNull();
  });
  it('exposes conflicting duplicate source samples', () => {
    expect(overviewQuality({ ...opts, bookings: [booking('same', 5), booking('same', 1)] }).conflicts).toBe(1);
  });
  it('attributes follow-up only by stable identity, never worker name or ambiguous external IDs', () => {
    const bikers = [{ id: 'a', name: 'Same', driverExternalId: '1982' }, { id: 'b', name: 'Same', driverExternalId: '1984' }];
    const q = overviewQuality({ ...opts, bikers, bookings: [booking('a', 2, { driverExternalId: '1982' }),
      booking('b', 1, { driverName: 'Same' }), { bikerId: 'b', record: booking('c', 3, { driverExternalId: '1982' }).record }] });
    expect(q.attention.map(item => [item.biker.id, item.low])).toEqual([['a', 1], ['b', 1]]);
    expect(overviewQuality({ ...opts, bikers: [...bikers, { id: 'c', driverExternalId: '1982' }], bookings: [booking('d', 1, { driverExternalId: '1982' })] }).attention).toEqual([]);
  });
});
