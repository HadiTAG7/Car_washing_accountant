import { syncDb, syncFV, syncPayload, syncRequest } from './sweaterOperationsFixture.js';
// History as the writer of 29 Oct filed it (a booking per prefixed id); the review runs on today's writer.
import { previewOperations, saveOperations } from './legacyOperationsSync.js';

// Synthetic storage and names. Only the explicitly owner-reviewed scope
// identifiers and event times mirror the two source cases; no production I/O.
export const assignmentCases = [
  { number: '5677597', from: '1984', fromWorker: '2N4FP4rQAxXQ7rpuBrla', to: '1988', toWorker: '5MMg7pj0wjYM06NLuzS7',
    firstRun: 'ops-20261029-today-174718-v1', firstCut: '2026-10-29T14:47:18.719Z', latestStatus: 'Washing Started',
    start: '2026-10-29T18:59:00+03:00', end: '2026-10-29T19:20:00+03:00' },
  { number: '5677684', from: '1998', fromWorker: 'GjVUWPitR9dxbbMKc3qD', to: '2008', toWorker: 'ty8Yqd3vFfPmwz3z9rQ3',
    firstRun: 'ops-20261029-hour18-1759-v1', firstCut: '2026-10-29T14:59:34.551Z', latestStatus: 'On the Way',
    start: '2026-10-29T19:17:00+03:00', end: '2026-10-29T19:58:00+03:00' },
];
export const reviewedPayloads = c => {
  const first = syncPayload(); first.importRunId = c.firstRun;
  Object.assign(first.coverage, { rangeFrom: '2026-10-29', rangeTo: '2026-10-29', extractedAt: c.firstCut });
  first.workerLinks = { [c.from]: c.fromWorker, [c.to]: c.toWorker };
  first.records[0] = { ...first.records[0], sspBookingId: `B-${c.number}`, serviceDate: '2026-10-29',
    serviceType: 'interior_exterior_wash', rawStatus: 'Initiated', driverExternalId: c.from, notes: 'Synthetic isolated source receipt' };
  const latest = structuredClone(first); latest.importRunId = 'ops-20261029-hour19-1906-v1';
  latest.coverage.extractedAt = '2026-10-29T16:06:48.129Z';
  Object.assign(latest.records[0], { driverExternalId: c.to, rawStatus: c.latestStatus,
    startedAt: c.latestStatus === 'Washing Started' ? c.start : null });
  const final = structuredClone(latest); final.importRunId = 'synthetic-genuine-next-source';
  final.coverage.extractedAt = '2026-10-29T17:15:00Z';
  Object.assign(final.records[0], { sspBookingId: `S-${c.number}`, rawStatus: 'Collecting Payment', startedAt: c.start, completedAt: c.end });
  return { first, latest, final };
};
export async function seedAssignmentMemory(c) {
  const db = syncDb();
  db.rows.set(`bikers/${c.fromWorker}`, { name: 'Synthetic previous assignee', driver_external_id: c.from });
  db.rows.set(`bikers/${c.toWorker}`, { name: 'Synthetic source execution worker', driver_external_id: c.to });
  const p = reviewedPayloads(c);
  for (const payload of [p.first, p.latest]) await saveOperations(db, syncFV, syncRequest(payload, await previewOperations(db, payload)), 'synthetic');
  return { db, ...p };
}
