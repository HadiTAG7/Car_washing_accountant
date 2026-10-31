import { historicalIdentity5643311Record } from '../../src/sweater/operationsIdentity5643311.js';
// History as the writer of 20–23 Oct filed it (a booking per prefixed id); the resolution runs on today's writer.
import { previewOperations, saveOperations } from './legacyOperationsSync.js';

// Isolated synthetic persistence; scoped IDs and immutable source facts match
// the reviewed case so the same server guards are exercised without live I/O.
export const historicalPayload = () => ({ contractVersion: 2, importRunId: 'synthetic-5643311-resolution', agentStatus: 'partial',
  coverage: { rangeFrom: '2026-10-20', rangeTo: '2026-10-20', extractedAt: '2026-10-25T21:32:18.355Z',
    pageCount: 1, pagesFetched: 1, recordCount: 1, isComplete: false,
    sourceUrl: 'https://ssp-portal.sweater.sa/bookings', modules: { individual: 'partial', corporate: 'unavailable' },
    gaps: ['Single reviewed historical booking only; other source coverage unavailable.'] },
  workerLinks: { '2007': 'mjIi1UW9FlKYmomXxgJE' }, records: [historicalIdentity5643311Record()] });
export const requestFrom = (payload, preview) => ({ payload, reviewedPayloadHash: preview.reviewedPayloadHash, previewStateHash: preview.previewStateHash });
export async function seedHistorical5643311(db, fieldValue) {
  const save = async payload => saveOperations(db, fieldValue, requestFrom(payload, await previewOperations(db, payload)), 'synthetic-agent');
  const old = historicalPayload(); old.importRunId = 'ops-20261020-oct20-2200-190721'; old.workerLinks = {};
  old.coverage.extractedAt = '2026-10-20T19:07:21.473Z';
  old.records = [{ sspBookingId: 'B-5643311', bookingKind: 'individual', serviceDate: '2026-10-20',
    driverExternalId: '2007', region: 'Suwaidi', rawStatus: 'Washing Started', serviceType: 'interior_exterior_wash',
    startedAt: '2026-10-20T21:18:00+03:00',
    sourceUrl: 'https://ssp-portal.sweater.sa/bookings?pageSize=50&page=1&fromDate=2026-10-20&toDate=2026-10-20',
    notes: 'Actual SSP execution timeline, minute precision; service type and Asia/Riyadh per Hadi11Oct. Current-day partial observation; no collection or owner-completion assertion.' }];
  await save(old);
  const later = historicalPayload(); later.importRunId = 'ops-20261023-late-oct19-20-192552'; later.coverage.extractedAt = '2026-10-23T19:25:52.589Z';
  later.records = [{ sspBookingId: 'S-5643311', bookingKind: 'individual', serviceDate: '2026-10-20', driverExternalId: '2007',
    rawStatus: 'Collecting Payment', serviceType: 'interior_exterior_wash', startedAt: '2026-10-20T21:18:00+03:00',
    completedAt: '2026-10-20T22:10:00+03:00', sourceUrl: 'https://ssp-portal.sweater.sa/bookings?pageSize=100&page=1&fromDate=2026-10-16&toDate=2026-10-21',
    notes: 'New actual SSP detail observation after verified worker links and later source completion; type/timezone per Hadi11Oct. Do not replay or alter prior batches. No owner or collection assertion.' }];
  await save(later);
  return { old, later };
}
