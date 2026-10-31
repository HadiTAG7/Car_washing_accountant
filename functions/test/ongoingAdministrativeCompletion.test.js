import { describe, it, expect } from 'vitest';
import { ongoingCompletionFixture } from './administrativeCompletionFixture.js';
import { reviewAdministrativeCompletion } from '../../src/lib/sweater/administrativeCompletion.js';
import { previewAdministrativeCompletion, saveAdministrativeCompletion } from '../src/sweater/administrativeCompletion.js';
import { normalizeRecord, hashRecord } from '../src/sweater/record.js';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { executionEligibility } from '../src/sweater/operationsExecution.js';

function seed(p) {
  const r = normalizeRecord(p.records[0]);
  return { 'users/admin': { role: 'admin' }, 'bikers/worker1': { name: 'Synthetic worker', driver_external_id: '1982', start_date: '2026-10-01' },
    [`sweater_bookings/${r.sspBookingId.replace(/^[A-Z]+-/, '')}`]: { source: 'operations_sync_v2', sspBookingId: r.sspBookingId, record: r,
      sourceHash: hashRecord(r), operationalWorkerId: 'worker1', processingStatus: 'needs_review', reviewReasonCode: 'execution_not_final' },
    'sweater_owner_booking_claims/880001': { sspBookingId: r.sspBookingId, washId: `ssp__${r.sspBookingId}`, bookingNumber: '880001', source: 'operations_sync_v2' } };
}
describe('standing owner approval for actual ongoing execution', () => {
  it('accepts a genuine Start with no End, without changing the source or inventing collection', async () => {
    const p = ongoingCompletionFixture(), before = structuredClone(p);
    expect(reviewAdministrativeCompletion(p).ready).toBe(true); expect(p).toEqual(before);
    expect(executionEligibility(normalizeRecord(p.records[0]), p.coverage, {})).toEqual({ eligible: false, reasonCode: 'execution_not_final' });
    const db = memoryFinanceDb(seed(p)), stored = JSON.stringify([...db.rows]);
    const result = await previewAdministrativeCompletion(db, p, 'admin');
    expect(result.canSave).toBe(true); expect(result.rows[0]).toMatchObject({ rawStatus: 'Washing Started', collectionStatus: 'pending', workerCommission: 4.5 });
    expect(JSON.stringify([...db.rows])).toBe(stored);
  });
  it.each([
    p => { p.records[0].startedAt = null; }, p => { delete p.records[0].completedAt; },
    p => { p.records[0].completedAt = '2026-10-26T22:00:00+03:00'; },
    p => { p.records[0].startedAt = '2026-10-26T23:00:00+03:00'; },
    p => { p.records[0].startedAt = '2026-10-25T21:13:00+03:00'; },
    p => { p.coverage.extractedAt = '2099-10-26T22:25:00+03:00'; },
    p => { p.decision.decidedAt = '2099-10-26T22:25:00+03:00'; },
    p => { p.decision.messageId = 'unknown-owner-message'; }, p => { p.decision.conversationId = 'another-thread'; },
    p => { p.records[0].serviceType = 'other'; }, p => { p.records[0].rawStatus = 'Arrived'; },
    p => { p.records[0].rawStatus = 'On the Way'; }, p => { p.records[0].rawStatus = 'Approved'; },
    p => { p.records[0].serviceDate = p.decision.serviceDate = p.coverage.rangeFrom = p.coverage.rangeTo = '2026-10-17'; p.records[0].startedAt = '2026-10-17T21:13:00+03:00'; },
  ])('rejects missing, future, unrelated and out-of-scope ongoing evidence', mutate => {
    const p = ongoingCompletionFixture(); mutate(p); expect(reviewAdministrativeCompletion(p).ready).toBe(false);
  });
  it.each(['missing', 'worker', 'status', 'start', 'end', 'service', 'source', 'kind'])('requires the existing verified observation: %s', async kind => {
    const p = ongoingCompletionFixture(), data = seed(p), path = 'sweater_bookings/880001';
    if (kind === 'missing') delete data[path];
    else if (kind === 'worker') data[path].operationalWorkerId = 'unverified';
    else if (kind === 'source') data[path].source = 'manual';
    else data[path].record[{ status: 'rawStatus', start: 'startedAt', end: 'completedAt', service: 'serviceType', kind: 'bookingKind' }[kind]] = kind === 'kind' ? 'corporate' : 'different';
    const db = memoryFinanceDb(data), result = await previewAdministrativeCompletion(db, p, 'admin');
    expect(result.canSave).toBe(false); expect(result.counts.needsReview).toBe(1);
    expect([...db.rows.keys()].some(k => k.startsWith('washes/'))).toBe(false);
  });
  it('keeps admin role, period locks and hash/readback guards on the server', async () => {
    const p = ongoingCompletionFixture(), data = seed(p);
    data['users/admin'].role = 'operator'; await expect(previewAdministrativeCompletion(memoryFinanceDb(data), p, 'admin')).rejects.toThrow(/للمدير/);
    data['users/admin'].role = 'admin'; data['accounting_periods/2026-10'] = { status: 'closed' };
    await expect(previewAdministrativeCompletion(memoryFinanceDb(data), p, 'admin')).rejects.toThrow(/محمية/);
    const db = memoryFinanceDb(seed(p));
    await expect(saveAdministrativeCompletion(db, {}, { payload: p, reviewedPayloadHash: 'bad', previewStateHash: 'bad' }, 'admin')).rejects.toThrow();
  });
});
