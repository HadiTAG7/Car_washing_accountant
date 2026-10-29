// Hadi's explicit four-booking instruction, 29 Oct 2026. This is a bounded
// source-attribution review, not a general reassignment permission or a claim
// mutation. The original observation is Initiated with no execution; the later
// source identifies the worker during the same evidenced service and at End.
// The exact assignment-change time is NOT known and is never invented.
import { hashBody } from './record.js';
const OWNER_MESSAGE = '01a188a5-3daf-7e83-a1e7-768c243e17ce';
const OWNER_DECISIONS = Object.freeze({
  '5677597': Object.freeze({ kind: 'owner_execution_worker_decision_v1', bookingNumber: '5677597', serviceDate: '2026-10-29',
    driverExternalId: '1988', bikerId: '5MMg7pj0wjYM06NLuzS7', commissionPerWash: 4.5, commissionPaid: false,
    conversationId: '019ff1c9-38ba-7212-8f1a-f26709c33b99', humanMessageId: '01a188ad-76a5-7c83-9c0d-dc7483ddc9e4',
    turnId: '01a188a5-3cd6-7702-a1a8-3a9ca1b5b9eb', replyCallId: 'call_5cf2cec869b942fdb8af6a307e7f91b9', questionIndex: 0,
    statement: 'اعتمد البايكر 1988 لهذه الغسلة', sourceAssignmentTimeKnown: false }),
});
const CASES = Object.freeze([
  { number: '5677597', fromDriver: '1984', fromWorker: '2N4FP4rQAxXQ7rpuBrla',
    toDriver: '1988', toWorker: '5MMg7pj0wjYM06NLuzS7', firstRun: 'ops-20261029-today-174718-v1',
    latestRun: 'ops-20261029-hour19-1906-v1', latestStatus: 'washing_started', requiresWorkerDecision: true,
    startedAt: '2026-10-29T18:59:00+03:00', completedAt: '2026-10-29T19:20:00+03:00' },
  { number: '5677684', fromDriver: '1998', fromWorker: 'GjVUWPitR9dxbbMKc3qD',
    toDriver: '2008', toWorker: 'ty8Yqd3vFfPmwz3z9rQ3', firstRun: 'ops-20261029-hour18-1759-v1',
    latestRun: 'ops-20261029-hour19-1906-v1', latestStatus: 'on_the_way',
    startedAt: '2026-10-29T19:17:00+03:00', completedAt: '2026-10-29T19:58:00+03:00' },
]);

export function scopedAssignmentReview({ number, record, legacy, claim, candidate }, decisions = OWNER_DECISIONS) {
  const scope = CASES.find(c => c.number === number);
  if (!scope || record.sspBookingId !== `S-${number}` || legacy?.sspBookingId !== `B-${number}`
    || record.serviceDate !== '2026-10-29' || record.bookingKind !== 'individual'
    || record.serviceType !== 'interior_exterior_wash' || record.driverExternalId !== scope.toDriver || candidate !== scope.toWorker
    || record.startedAt !== scope.startedAt || record.completedAt !== scope.completedAt
    || claim?.source !== 'operations_sync_v2' || claim.importRunId !== scope.firstRun
    || legacy.lastImportRunId !== scope.latestRun || legacy.record?.driverExternalId !== scope.toDriver
    || legacy.operationalWorkerId !== scope.toWorker || legacy.record?.normalizedStatus !== scope.latestStatus) return null;
  const decision = decisions?.[number];
  if (scope.requiresWorkerDecision && (!decision || decision.kind !== 'owner_execution_worker_decision_v1'
    || decision.bookingNumber !== number || decision.serviceDate !== record.serviceDate
    || decision.driverExternalId !== record.driverExternalId || decision.bikerId !== candidate
    || hashBody(decision) !== hashBody(OWNER_DECISIONS[number]))) return null;
  return { ...scope, ownerMessageId: OWNER_MESSAGE, ...(scope.requiresWorkerDecision ? { workerDecision: { ...decision } } : {}) };
}

export function matchesOriginalUnexecutedAssignment(scope, prior, cut, current) {
  return Boolean(scope && prior?.sspBookingId === `B-${scope.number}` && prior.driverExternalId === scope.fromDriver
    && prior.normalizedStatus === 'unknown' && prior.rawStatus?.trim().toLowerCase() === 'initiated'
    && !prior.startedAt && !prior.completedAt && cut < Date.parse(current.startedAt));
}

export function assignmentReviewReceipt(scope, history) {
  if (!scope) return null;
  return { kind: 'owner_scoped_source_assignment_review_v1', ownerMessageId: scope.ownerMessageId,
    bookingNumber: scope.number, originalDriverExternalId: scope.fromDriver, sourceExecutionDriverExternalId: scope.toDriver,
    assignmentChangedAt: null, originalObservationAt: history[0].run?.coverage?.extractedAt ?? null,
    executionWorkerObservedAt: history.at(-1).run?.coverage?.extractedAt ?? null,
    executionWorkerBasis: scope.workerDecision ? 'explicit_owner_decision' : 'source_observed_before_execution',
    ...(scope.workerDecision ? { workerDecision: scope.workerDecision } : {}),
    claimRewritten: false, originalSourceRewritten: false };
}
