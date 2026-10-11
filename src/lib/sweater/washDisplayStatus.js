// Presentation only: never promote a source status/ticket to earned revenue.
export function washDisplayStatus(wash, sourceRecord) {
  if (wash.status !== 'مكتملة') return { label: wash.status || '—', tone: 'pending' };
  const decision = wash.ownerCompletionDecision;
  const exceptional = decision?.source === 'owner_statement' && decision.approved === true
    && decision.decision === 'record_as_completed_wash' && decision.sspBookingId === wash.sspBookingId;
  const ticketRef = typeof sourceRecord?.ticketRef === 'string' ? sourceRecord.ticketRef.trim() : '';
  if (ticketRef) return { label: 'عليها تكت', tone: 'ticket', ticketRef, exceptional };
  return { label: exceptional ? 'استثنائية' : 'مكتملة', tone: exceptional ? 'exceptional' : 'completed' };
}
