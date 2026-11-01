import { expect, it } from 'vitest';
import { qualitySourceDetails, cancellationType, sourceBiker } from '../qualitySourceDetails';
const month = '2026-10';
const bikers = [{ id: 'site-a', name: 'عامل وهمي', driverExternalId: '2007' }];
const review = (id, amounts = []) => ({ recordType: 'ssp_ticket_review_v1', ticketId: id, reviewStatus: 'historical_excluded',
  objectionHistory: [{ id: 'OBJ-TEST-A', status: 'Accepted' }, { id: 'OBJ-TEST-B', status: 'Rejected' }],
  source: { facts: { ticketDate: '2026-10-20', serviceDate: '2026-10-19', biker: { name: 'Source worker', externalId: '2007', siteId: null },
    complaint: 'Synthetic complaint', washIds: ['TEST-1'] }, amounts,
  source: { url: 'https://ssp-portal.sweater.sa/tickets/TEST', readAt: '2026-11-01T20:00:00+03:00' } } });
const booking = (id, status, reason, at = '2026-10-30T12:00:00Z') => ({ updatedAtIso: at,
  record: { sspBookingId: id, serviceDate: '2026-10-20', rawStatus: status, driverExternalId: '2007',
    sourceUrl: 'https://ssp-portal.sweater.sa/bookings/TEST', notes: reason ? `Cancellation Reason\nReason\n${reason}` : '' } });
it('keeps wallet and compensation amounts distinct, retains every objection and does not mutate source decisions', () => {
  const records = [review('TEST-A', [{ kind: 'compensation', value: 20, unit: 'SAR' }, { kind: 'customer_code', value: 60, unit: 'SAR' }])];
  const before = structuredClone(records);
  const out = qualitySourceDetails({ month, bikers, reviews: records });
  expect(out.groups.compensations).toHaveLength(1); expect(out.groups.freeWashCompensation).toHaveLength(0);
  expect(out.groups.compensations[0]).toMatchObject({ amount: null, quantity: null, bikerRowId: 'site-a' });
  expect(out.groups.compensations[0].source.amounts.map(a => a.value)).toEqual([20, 60]);
  expect(out.groups.compensations[0].review.objectionHistory).toHaveLength(2); expect(records).toEqual(before);
});
it('uses ticket creation month, never source read month or an unrelated service month, and deduplicates ticket identity', () => {
  const old = review('OLD'); old.source.facts.ticketDate = '2026-09-30';
  const unknown = review('UNKNOWN'); delete unknown.source.facts.ticketDate;
  const current = review('CURRENT');
  const out = qualitySourceDetails({ month, reviews: [old, unknown, current, current] });
  expect(out.groups.compensations.map(r => r.sourceId)).toEqual(['CURRENT']);
});
it('requires explicit count-unit compensation evidence for free washes', () => {
  const out = qualitySourceDetails({ month, reviews: [review('COUNT', [{ kind: 'compensation', value: 2, unit: 'count', sourceRef: 'Compensation type: Free Wash; Quantity 2' }]),
    review('CODE', [{ kind: 'customer_code', value: 2, unit: 'count' }]), review('UNKNOWN-COUNT', [{ kind: 'compensation', value: 2, unit: 'count' }]),
    review('NEGATIVE', [{ kind: 'compensation', value: 2, unit: 'count', sourceRef: 'Not a free wash; type unknown' }])] });
  expect(out.groups.freeWashCompensation).toMatchObject([{ sourceId: 'COUNT', quantity: 2, amount: null }]);
});
it('keeps wallet wash compensation with quantity one and SAR twenty out of free washes', () => {
  const wallet = review('SYNTHETIC-WALLET', [{ kind: 'compensation', value: 1, unit: 'count', sourceRef: 'Compensations: Wash in Wallet, quantity 1' },
    { kind: 'compensation', value: 20, unit: 'SAR', sourceRef: 'Amount and Total are one SAR amount, not two transactions' }]);
  const out = qualitySourceDetails({ month, reviews: [wallet] });
  expect(out.groups.compensations).toHaveLength(1); expect(out.groups.freeWashCompensation).toHaveLength(0);
  expect(wallet.reviewStatus).toBe('historical_excluded');
});
it('never matches SSP internal biker IDs or names as company IDs and preserves ambiguous registry links', () => {
  const row = { id: 'event', driverExternalId: '1345', sourceBikerName: 'Source worker' };
  expect(sourceBiker(row, bikers)).toMatchObject({ bikerRowId: 'source:1345', bikerLabel: 'Source worker' });
  expect(sourceBiker({ ...row, driverExternalId: '2007' }, [...bikers, { ...bikers[0], id: 'duplicate' }]))
    .toMatchObject({ identityConflict: true, bikerRowId: 'source:2007' });
  expect(sourceBiker({ ...row, driverExternalId: '2007', siteBikerId: 'different' }, bikers).identityConflict).toBe(true);
});
it('does not classify an admin cancellation as biker fault and refuses conflicting parties', () => {
  expect(cancellationType(booking('1', 'Cancelled by Admin').record)).toBeNull();
  expect(cancellationType(booking('1', 'Cancelled by Admin', 'Biker delay caused cancellation or postponement').record)).toBe('cancelledByBiker');
  expect(cancellationType(booking('1', 'Cancelled by Customer', 'Biker illness').record)).toBeNull();
  expect(cancellationType(booking('1', 'Cancelled by Admin', 'Maintenance').record)).toBe('cancelledMaintenance');
});
it('joins latest raw prefix observations once, without confusing document update with SSP read time', () => {
  const held = booking('B-123', 'Collecting Payment', null, '2026-11-01T20:00:00Z');
  const raw = [{ id: 'raw-a', sspBookingId: 'C-123', fetchedAtIso: '2026-10-30T12:00:00Z',
    rawPayload: booking('C-123', 'Cancelled by Admin', 'Biker illness').record }];
  const before = structuredClone({ held, raw });
  const out = qualitySourceDetails({ month, bikers, bookings: [held, held], raw });
  expect(out.groups.cancelledByBiker).toHaveLength(1);
  expect(out.groups.cancelledByBiker[0]).toMatchObject({ bookingId: 'C-123', sourceReadAt: raw[0].fetchedAtIso, timeBasis:'observation_saved', amount: null });
  expect({ held, raw }).toEqual(before);
});
it('keeps equal-time source conflicts and latest-status-without-raw observations unclassified', () => {
  const b = booking('1', 'Cancelled by Admin', 'Biker illness');
  const raw = ['Biker illness', 'Maintenance'].map((reason, i) => ({ id: String(i), sspBookingId: '1', fetchedAtIso: b.updatedAtIso,
    rawPayload: booking('1', 'Cancelled by Admin', reason).record }));
  expect(qualitySourceDetails({ month, bookings: [b], raw }).unclassified).toMatchObject([{ conflict: true }]);
  b.latestObservation = { rawStatus: 'Cancelled by Admin', observedAtIso: '2026-11-01T18:00:00Z' };
  const out = qualitySourceDetails({ month, bookings: [b] });
  expect(out.unclassified[0]).toMatchObject({ reason: null, driverExternalId: undefined });
});
