import { BIKER_DEDUCTION_AUTHORITY } from '../../src/lib/sweater/bikerDeductions.js';
import { normalizeRecord, hashRecord } from '../src/sweater/record.js';
import { rawDocId, COL } from '../src/sweater/ingest.js';
export const month = '2026-10', actor = { userId: 'admin' };
export function deductionInput(patch = {}) {
  return { sourceKind: 'metrics', periodKey: month, metricKey: 'cancelledByBiker', sourceId: 'event-one', snapshotId: 'reading-one', bikerId: 'worker-one',
    expectedRevision: 0, reason: 'Synthetic reviewed reason', decisionReference: BIKER_DEDUCTION_AUTHORITY, ...patch };
}
export function deductionSeed() {
  const event = { metricKey: 'cancelledByBiker', sourceId: 'event-one', bookingId: 'C-990001', date: '2026-10-20', time: null,
    driverExternalId: 'TEST-DRIVER', reason: 'Synthetic biker cancellation', quantity: 1, amount: null, sourceUrl: 'https://ssp-portal.sweater.sa/test' };
  const record = normalizeRecord({ sspBookingId: 'C-990002', driverExternalId: 'TEST-DRIVER', serviceDate: '2026-10-20', rawStatus: 'Cancelled by Admin',
    serviceType: 'interior_exterior_wash', bookingKind: 'individual', sourceUrl: event.sourceUrl,
    notes: 'Actual source read; Cancellation Reason\nCancelled At\nOctober 20, 2026\nReason\nBiker Refused Wash; raw only, no SAR inferred.' });
  return {
    'users/admin': { role: 'admin' }, 'users/operator': { role: 'operator' }, 'users/partner': { role: 'partner' },
    'bikers/worker-one': { name: 'Synthetic worker', driver_external_id: 'TEST-DRIVER', start_date: '2026-08-01' },
    'sweater_metric_snapshots/reading-one': { contractVersion: 'sweater-metrics-v1', periodKey: month, extractedAtIso: '2026-10-28T15:00:00Z', receivedAtIso: '2026-10-28T15:01:00Z',
      metrics: { cancelledByBiker: 1 }, eventDetails: [event], eventCoverage: [{ metricKey: 'cancelledByBiker', totalRows: 1, complete: true }] },
    [`${COL.RAW}/${rawDocId('raw-test-run', record.sspBookingId)}`]: { source: 'operations_sync_v2', importRunId: 'raw-test-run', normalizedRecord: record, sourceHash: hashRecord(record) },
    'sweater_bookings/C-990002': { source: 'operations_sync_v2', record, sourceHash: hashRecord(record), operationalWorkerId: 'worker-one' },
    'sweater_import_runs/raw-test-run': { source: 'operations_sync_v2', status: 'completed_with_gaps', coverage: { extractedAt: '2026-10-28T14:00:00Z' },
      result: { rows: [{ sspBookingId: record.sspBookingId, rawSaved: true, sourceHash: hashRecord(record), rawId: rawDocId('raw-test-run', record.sspBookingId), bikerId: 'worker-one' }] } },
    'washes/unchanged': { price: 20, worker_commission_per_wash: 4.5, worker_commission_paid: false },
    'sweater_adjustments/unchanged': { kind: 'deduction', amount: 20, approvalStatus: 'pending_review' },
    'journal_entries/unchanged': { status: 'posted' },
  };
}
