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

// Synthetic isolated fixture using the exact identity of the one-time contract.
// It is never a production save request or evidence of source/authentication.
export function missingStartCompletionFixture() {
  const p = completionFixture();
  const r = { sspBookingId:'S-5655042',driverExternalId:'1988',bookingKind:'individual',
    serviceType:'interior_exterior_wash',serviceDate:'2026-10-24',rawStatus:'Collecting Payment',
    startedAt:null,completedAt:'2026-10-24T14:48:00+03:00',sourceUrl:p.coverage.sourceUrl };
  return { ...p,importRunId:'synthetic-missing-start-5655042',records:[r],workerLinks:{'1988':'5MMg7pj0wjYM06NLuzS7'},
    coverage:{...p.coverage,rangeFrom:r.serviceDate,rangeTo:r.serviceDate,recordCount:1,extractedAt:'2026-10-25T00:04:45.955+03:00'},
    decision:{...p.decision,statement:'Synthetic isolated test of the bounded owner approval; no collection assertion.',
      serviceDate:r.serviceDate,bookingIds:[r.sspBookingId],excludedBookingIds:[],
      conversationId:'01a04f9f-cdbe-7213-bf1b-eee76eb35b38',messageId:'01a16fb9-0e70-7203-b117-6f8c2fe44a8c',
      decidedAt:'2026-10-25T00:03:19+03:00'} };
}
