// Existing administrative store, deliberately distinct domains.
export const TICKET_REVIEW_TYPE = 'ssp_ticket_review_v1';
export const TICKET_QUEUE_TYPE = 'ssp_ticket_queue_v1';
export const isTicketReview = row => [TICKET_REVIEW_TYPE, TICKET_QUEUE_TYPE].includes(row?.recordType);
export const isInternalQualityObjection = row => !row?.recordType || row.recordType === 'quality_objection';
