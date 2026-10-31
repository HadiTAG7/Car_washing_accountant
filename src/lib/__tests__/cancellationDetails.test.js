import { expect, it } from 'vitest';
import { cancellationDetails, cancellationTime, bookingSourceObservations, cancellationSourceIds, cancellationSourceLink } from '../sweater/cancellationDetails';

const notes = 'Actual read; timezone per Hadi11Oct. Actual cancellation card: Cancellation Reason\nCancelled At\nOctober 29, 2026 07:01 PM\nReason\nBiker illness';
it('separates the cancelling party from reason and assignment without inventing a staff name or timezone', () => {
  const r = { rawStatus: 'Cancelled by Admin', driverExternalId: '1986', notes }; const before = structuredClone(r);
  expect(cancellationDetails(r)).toMatchObject({ party: 'admin', actorName: null, reason: 'Biker illness', time: 'October 29, 2026 07:01 PM', timeZone: null });
  expect(cancellationTime(cancellationDetails(r).time, null)).toMatchObject({ converted: false, text: 'October 29, 2026 07:01 PM' });
  expect(r).toEqual(before);
});
it('uses only an explicitly recorded actor and treats missing or conflicting cancellation cards as unknown', () => {
  expect(cancellationDetails({ notes: notes + '\nCancelled By\nNamed source operator' }).actorName).toBe('Named source operator');
  expect(cancellationDetails({ rawStatus: 'Biker Refused Wash' })).toMatchObject({ party: null, reason: null, time: null, actorName: null });
  expect(cancellationDetails({ notes: notes + '\n' + notes })).toMatchObject({ ambiguous: true, reason: null, time: null });
  expect(cancellationDetails({ notes: notes + '\nSSP_INVOICE_DEDUCTION_V1={"cancellationReason":"OTHER"}' }).reason).toBe('Biker illness');
});
it('never consumes the next field label as the value of an empty cancellation field', () => {
  expect(cancellationDetails({ notes: 'Cancellation Reason\nCancelled At\n\nReason\nBiker illness' })).toMatchObject({ time: null, reason: 'Biker illness' });
  expect(cancellationDetails({ notes: 'Cancellation Reason\nCancelled At\nReason\nBiker illness' })).toMatchObject({ time: null, reason: 'Biker illness' });
  expect(cancellationDetails({ notes: 'Cancellation Reason\nReason\n\nCancelled By\nTest operator' })).toMatchObject({ reason: null, actorName: 'Test operator' });
  expect(cancellationDetails({ notes: 'Cancellation Reason\nReason\nCancelled By\nTest operator' })).toMatchObject({ reason: null, actorName: 'Test operator' });
});
it('converts explicit offsets to Riyadh, respects minute precision and refuses unknown zones or impossible local dates', () => {
  expect(cancellationTime('2026-10-29T16:01Z', null, 'en')).toMatchObject({ converted: true, precision: 'minute', text: expect.stringContaining('19:01') });
  expect(cancellationTime('2026-10-29T16:01:12Z', null, 'en')).toMatchObject({ converted: true, precision: 'second', text: expect.stringContaining('19:01:12') });
  expect(cancellationTime('October 29, 2026 07:01 PM', 'Asia/Riyadh', 'en')).toMatchObject({ converted: true, precision: 'minute', text: expect.stringContaining('19:01') });
  expect(cancellationTime('February 30, 2026 07:01 PM', 'Asia/Riyadh').converted).toBe(false);
  expect(cancellationTime('2026-02-30T19:01Z', null).converted).toBe(false);
  expect(cancellationTime(null, null).text).toBeNull();
});
it('links saved prefix observations of the same booking only, sorts by saved time and keeps the booking untouched', () => {
  const booking = { record: { sspBookingId: 'B-5673287', rawStatus: 'Initiated' } };
  const rows = [{ id: 'old', sspBookingId: 'B-5673287', rawPayload: booking.record, fetchedAtIso: '2026-10-29T14:49:03Z' },
    { id: 'new', sspBookingId: 'C-5673287', rawPayload: { sspBookingId: 'C-5673287', rawStatus: 'Cancelled by Admin', notes }, fetchedAtIso: '2026-10-29T16:10:44Z' },
    { id: 'other', sspBookingId: 'C-1', rawPayload: { sspBookingId: 'C-1' }, fetchedAtIso: '2026-10-30T16:10:44Z' },
    { id: 'wrong', sspBookingId: 'C-5673287', rawPayload: { sspBookingId: 'C-2' }, fetchedAtIso: '2026-10-30T16:10:44Z' }];
  const before = structuredClone({ booking, rows });
  expect(bookingSourceObservations(booking, rows).map(x => x.id)).toEqual(['new', 'old']);
  expect({ booking, rows }).toEqual(before);
  expect(cancellationSourceIds('B-5673287')).toEqual(['B-5673287', '5673287', 'C-5673287', 'S-5673287']);
  expect(cancellationSourceLink('javascript:alert(1)')).toBeNull();
  expect(cancellationSourceLink('https://ssp-portal.sweater.sa/bookings?token=private')).toBeNull();
});
