import { describe, expect, it } from 'vitest';
import { bikerProfileStats } from '../bikerProfile';

const biker = { id: 'worker-a', name: 'Same name', driverExternalId: '1986', startDate: '2026-10-02' };
const wash = (id, date, quantity = 1, extra = {}) => ({ id, washDate: date, quantity, status: 'مكتملة', bikerId: biker.id, ...extra });
const opts = extra => ({ biker, periodKey: '2026-10', today: '2026-10-04', washes: [], bookings: [], ...extra });

describe('read-only admin biker profile', () => {
  it('separates lifetime, month, today and yesterday, uses quantities and deduplicates executions', () => {
    const washes = [wash('old', '2026-09-30', 3), wash('yesterday', '2026-10-03', 2),
      wash('today', '2026-10-04', 1, { sspBookingId: 'S-1' }), wash('duplicate', '2026-10-04', 1, { sspBookingId: 'S-1' }),
      wash('pending', '2026-10-04', 9, { status: 'قيد التنفيذ' }), wash('future', '2026-10-05')];
    const before = structuredClone(washes);
    const st = bikerProfileStats(opts({ washes }));
    expect(st).toMatchObject({ lifetimeWashes: 6, monthWashes: 3, todayWashes: 1, yesterdayWashes: 2,
      calendarDays: 3, averagePerCalendarDay: 1, washDays: 2, averagePerWashDay: 1.5 });
    expect(st.daily.map(d => d.count)).toEqual([1, 2, 0]);
    expect(washes).toEqual(before);
  });
  it('never matches a different worker by name, and excludes ambiguous legacy rows', () => {
    const st = bikerProfileStats(opts({ washes: [wash('wrong', '2026-10-03', 7, { bikerId: 'worker-b', bikerName: biker.name }),
      wash('legacy', '2026-10-03', 4, { bikerId: null, bikerName: biker.name })] }));
    expect(st.monthWashes).toBe(0);
    expect(st.unlinkedLegacyRows).toBe(1);
  });
  it('counts only valid stated ratings, scopes by stable worker ID, and deduplicates ticket references', () => {
    const bookings = [
      { record: { sspBookingId: 'S-1', driverExternalId: '1986', serviceDate: '2026-10-03', rating: 5, ticketRef: 'T-1' } },
      { record: { sspBookingId: 'S-2', driverExternalId: '1986', serviceDate: '2026-10-04', rating: '3', ticketRef: 'T-1' } },
      { record: { sspBookingId: 'S-3', driverExternalId: '1986', serviceDate: '2026-10-04', rating: null } },
      { record: { sspBookingId: 'S-4', driverExternalId: '1986', serviceDate: '2026-10-04', rating: '' } },
      { record: { sspBookingId: 'S-5', driverExternalId: '42', serviceDate: '2026-10-04', rating: 1, ticketRef: 'other' } },
      { bikerId: 'worker-b', record: { driverExternalId: '1986', serviceDate: '2026-10-04', rating: 1 } },
      { record: { driverExternalId: '1986', serviceDate: '2026-09-30', rating: 1 } },
    ];
    const st = bikerProfileStats(opts({ bookings }));
    expect(st.quality).toMatchObject({ averageRating: 4, ratedCount: 2, importedBookings: 4 });
    expect(st.quality.tickets).toHaveLength(1);
    expect(st.quality.tickets[0].bookingIds).toEqual(['S-1', 'S-2']);
  });
  it('missing quality is unavailable, not a zero rating or complete ticket register', () => {
    expect(bikerProfileStats(opts()).quality.averageRating).toBeNull();
    expect(bikerProfileStats(opts()).quality.tickets).toEqual([]);
  });
  it('does not guess a worker from names when no Sweater ID is recorded', () => {
    const st = bikerProfileStats(opts({ biker: { ...biker, driverExternalId: '' },
      bookings: [{ record: { driverName: biker.name, serviceDate: '2026-10-03', rating: 5 } }] }));
    expect(st.quality.importedBookings).toBe(0);
  });
  it('limits calendar denominator by start, end, today and month and handles leap years', () => {
    expect(bikerProfileStats(opts({ biker: { ...biker, endDate: '2026-10-03' } })).calendarDays).toBe(2);
    expect(bikerProfileStats(opts({ biker: { ...biker, startDate: '2026-11-01' } })).calendarDays).toBe(0);
    expect(bikerProfileStats(opts({ biker: { id: 'a' }, periodKey: '2024-02', today: '2026-10-04' })).calendarDays).toBe(29);
    expect(bikerProfileStats(opts({ periodKey: '2026-99' })).validPeriod).toBe(false);
  });
  it('marks conflicting duplicates as a data issue rather than presenting an unqualified total', () => {
    const st = bikerProfileStats(opts({ washes: [wash('a', '2026-10-03', 1, { sspBookingId: 'S-1' }),
      wash('b', '2026-10-04', 1, { sspBookingId: 'S-1' })] }));
    expect(st.conflicts).toHaveLength(1);
  });
});
