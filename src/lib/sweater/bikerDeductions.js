import { ownerBookingIdentity } from './bookingIdentity.js';

export const BIKER_DEDUCTION_TYPE = 'source_biker_deduction_v1';
export const BIKER_DEDUCTION_AUTHORITY = '01a18461-252a-7032-b787-34a1206a9171';
export const isBikerDeduction = row => row?.recordType === BIKER_DEDUCTION_TYPE;
// One cancelled service remains one event across C-/B-/S- aliases, category
// corrections and repeated readings. Other incidents require the source event ID.
export function bikerDeductionIdentity(row) {
  const booking = ownerBookingIdentity(row.bookingId || '');
  if (['cancelledByBiker', 'cancelledMaintenance', 'cancelledByCustomer'].includes(row.metricKey)) {
    return booking ? JSON.stringify(['cancellation', booking]) : null;
  }
  return row.sourceId ? JSON.stringify(['incident', row.metricKey, row.sourceId]) : null;
}
