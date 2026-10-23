export function completionFixture() {
  const records = [1,2,3,4].map(i => ({ sspBookingId: `C-99000${i}`, driverExternalId: i === 1 ? '1982' : '2009',
    bookingKind: 'individual', serviceType: null, serviceDate: '2026-10-21', rawStatus: 'Cancelled by Admin',
    startedAt: i === 2 ? '2026-10-21T14:00:00+03:00' : null, completedAt: null, sourceUrl: 'https://ssp-portal.sweater.sa/bookings' }));
  return { kind: 'owner_administrative_completion_v1', importRunId: 'synthetic-owner-completion', records,
    workerLinks: { '1982': 'worker1', '2009': 'worker2' },
    coverage: { rangeFrom: '2026-10-21', rangeTo: '2026-10-21', extractedAt: '2026-10-24T01:00:00+03:00', pageCount: 1,
      pagesFetched: 1, recordCount: 4, isComplete: false, scope: 'explicit_owner_bookings', scopeComplete: true, sourceUrl: 'https://ssp-portal.sweater.sa/bookings' },
    decision: { source: 'owner_statement', ownerName: 'Synthetic owner', statement: 'Explicit synthetic approval for these four; exclude the fifth. No collection assertion.',
      conversationId: 'test-thread', messageId: 'test-message', decidedAt: '2026-10-24T00:50:00+03:00', decidedAtBasis: 'request_received_at', approved: true,
      decision: 'record_as_completed_wash', serviceDate: '2026-10-21', bookingIds: records.map(r => r.sspBookingId), excludedBookingIds: ['C-990005'] } };
}
