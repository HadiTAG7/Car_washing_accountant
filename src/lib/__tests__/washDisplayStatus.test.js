import { expect, it } from 'vitest';
import { washDisplayStatus } from '../sweater/washDisplayStatus';
import { mapWash, toWashUpdate } from '../mappers';
const decision = { source: 'owner_statement', approved: true, decision: 'record_as_completed_wash', sspBookingId: 'C-1' };
const wash = { status: 'مكتملة', sspBookingId: 'C-1' };
it('shows completed, explicit owner exception or recorded ticket without changing execution status', () => {
  const original = structuredClone(wash);
  expect(washDisplayStatus(wash, {})).toMatchObject({ label: 'مكتملة' });
  expect(washDisplayStatus({ ...wash, ownerCompletionDecision: decision }, {})).toMatchObject({ label: 'استثنائية' });
  expect(washDisplayStatus(wash, { ticketRef: ' T-23 ' })).toMatchObject({ label: 'عليها تكت', ticketRef: 'T-23' });
  expect(wash).toEqual(original);
});
it('does not infer an exception from cancellation or an unapproved/unrelated decision', () => {
  for (const extra of [{ rawStatus: 'Cancelled by Admin' }, { ownerCompletionDecision: { ...decision, approved: false } },
    { ownerCompletionDecision: { ...decision, sspBookingId: 'C-other' } }]) {
    expect(washDisplayStatus({ ...wash, ...extra }, {})).toMatchObject({ label: 'مكتملة' });
  }
});
it('preserves unfinished execution and both flags when a completed exception also has a ticket', () => {
  expect(washDisplayStatus({ ...wash, status: 'قيد التنفيذ' }, { ticketRef: 'T-23' }).label).toBe('قيد التنفيذ');
  expect(washDisplayStatus({ ...wash, ownerCompletionDecision: decision }, { ticketRef: 'T-23' }))
    .toMatchObject({ label: 'عليها تكت', exceptional: true });
});
it('reads the existing exception evidence without adding it to the write payload or altering financial fields', () => {
  const mapped = mapWash({ id: 'w1', revenue_origin: 'sweater', ssp_booking_id: 'C-1', owner_completion_decision: decision,
    status: 'مكتملة', price: 20, quantity: 1 });
  expect(mapped.ownerCompletionDecision).toEqual(decision);
  expect(washDisplayStatus(mapped, {}).label).toBe('استثنائية');
  expect(mapped).toMatchObject({ status: 'مكتملة', price: 20, quantity: 1 });
  expect(toWashUpdate({ ownerCompletionDecision: decision })).toEqual({});
});
