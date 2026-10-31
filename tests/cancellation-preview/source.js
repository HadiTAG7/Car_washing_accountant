export function useSweaterBookingSource() { return { loading: false, error: null, data: [
  { id: 'test-new', sspBookingId: 'C-101', fetchedAtIso: '2026-10-29T16:10:44Z', rawPayload: {
    sspBookingId: 'C-101', rawStatus: 'Cancelled by Admin', driverExternalId: 'TEST-1986', serviceDate: '2026-10-29',
    notes: 'Cancellation Reason\nCancelled At\nOctober 29, 2026 07:01 PM\nReason\nBiker illness' } },
  { id: 'test-old', sspBookingId: 'B-101', fetchedAtIso: '2026-10-29T14:49:03Z', rawPayload: { sspBookingId: 'B-101', rawStatus: 'Initiated' } },
] }; }
