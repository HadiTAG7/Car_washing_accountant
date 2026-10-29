import { describe, expect, it } from 'vitest';
import { previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';
import { hashRecord, normalizeRecord } from '../src/sweater/record.js';
import { assignmentCases, seedAssignmentMemory } from './helpers/sweaterAssignmentReviewFixture.js';
import { syncFV, syncRequest } from './helpers/sweaterOperationsFixture.js';

const save = async (db, p) => saveOperations(db, syncFV, syncRequest(p, await previewOperations(db, p)), 'synthetic');
describe('owner-scoped review of two unexecuted source assignment histories', () => {
  it.each(assignmentCases)('preserves both source workers and the original claim while crediting one source execution: $number', async c => {
    const { db, first, latest, final } = await seedAssignmentMemory(c), originals = new Map(db.rows);
    const p = await previewOperations(db, final); expect(db.rows).toEqual(originals);
    expect(p.rows[0]).toMatchObject({ reasonCode: null, observationPromotion: { eligible: true, sourceAssignmentReview: {
      originalDriverExternalId: c.from, sourceExecutionDriverExternalId: c.to, assignmentChangedAt: null, claimRewritten: false,
      ownerMessageId: '01a188a5-3daf-7e83-a1e7-768c243e17ce', executionWorkerObservedAt: latest.coverage.extractedAt,
    } } });
    const results = await Promise.all([1, 2].map(() => saveOperations(db, syncFV, syncRequest(final, p), 'synthetic')));
    expect(results.filter(r => !r.replay)).toHaveLength(1);
    for (const [path, value] of originals) if (path !== 'sweater_integration_state/current') expect(db.rows.get(path)).toEqual(value);
    expect(db.rows.get(`sweater_raw_payloads/${first.importRunId}__B-${c.number}`).normalizedRecord.driverExternalId).toBe(c.from);
    expect(db.rows.get(`sweater_bookings/B-${c.number}`).record.driverExternalId).toBe(c.to);
    expect(db.rows.get(`sweater_owner_booking_claims/${c.number}`).importRunId).toBe(first.importRunId);
    expect(db.rows.get(`washes/ssp__B-${c.number}`)).toMatchObject({ biker_id: c.toWorker, driver_external_id: c.to,
      worker_commission_per_wash: 4.5, worker_commission_paid: false, collection_status: 'pending', payment_method: null });
    expect(await operationsStatus(db, final)).toMatchObject({ verified: true, rawVerified: true, linksVerified: true });
    expect((await save(db, { ...final, importRunId: 'synthetic-later-source' })).washesCreated).toBe(0);
    expect([...db.rows.keys()].filter(p => p.startsWith('washes/'))).toHaveLength(1);
    expect([...db.rows.keys()].some(p => /^(journal_entries|payroll_runs|sweater_collections)\//.test(p))).toBe(false);
  });
  it.each(assignmentCases)('does not replay the old raw-only receipt into a new save: $number', async c => {
    const { db, final } = await seedAssignmentMemory(c), worker = db.rows.get(`bikers/${c.toWorker}`);
    db.rows.delete(`bikers/${c.toWorker}`); expect((await save(db, final)).washesCreated).toBe(0);
    db.rows.set(`bikers/${c.toWorker}`, worker);
    expect((await save(db, final))).toMatchObject({ replay: true, washesCreated: 0 });
    expect([...db.rows.keys()].some(p => p.startsWith('washes/'))).toBe(false);
  });
  it('does not apply the owner-scoped source reassignment review to another natural identity', async () => {
    const { db, final } = await seedAssignmentMemory({ ...assignmentCases[0], number: '990999' });
    expect((await save(db, final)).washesCreated).toBe(0);
  });
  it.each(['date', 'firstRun', 'lastRun', 'finalDriver', 'latestDriver', 'start', 'end', 'firstStatus', 'firstStart', 'firstEnd'])(
    'does not turn the scoped source review into a general %s exception', async field => {
      const c = assignmentCases[0], { db, final } = await seedAssignmentMemory(c);
      const rawPath = `sweater_raw_payloads/${c.firstRun}__B-${c.number}`;
      const raw = db.rows.get(rawPath), booking = db.rows.get(`sweater_bookings/B-${c.number}`);
      if (field === 'date') final.records[0].serviceDate = '2026-10-28';
      if (field === 'firstRun') db.rows.get(`sweater_owner_booking_claims/${c.number}`).importRunId = 'another-run';
      if (field === 'lastRun') booking.lastImportRunId = 'another-run';
      if (field === 'finalDriver') final.records[0].driverExternalId = c.from;
      if (field === 'latestDriver') booking.record.driverExternalId = c.from;
      if (field === 'start') final.records[0].startedAt = '2026-10-29T18:58:00+03:00';
      if (field === 'end') final.records[0].completedAt = '2026-10-29T19:21:00+03:00';
      if (field === 'firstStatus') raw.rawPayload.rawStatus = 'Washing Started';
      if (field === 'firstStart') raw.rawPayload.startedAt = '2026-10-29T17:30:00+03:00';
      if (field === 'firstEnd') raw.rawPayload.completedAt = '2026-10-29T17:40:00+03:00';
      if (field.startsWith('first') && ['firstStatus', 'firstStart', 'firstEnd'].includes(field)) {
        raw.normalizedRecord = normalizeRecord(raw.rawPayload); raw.sourceHash = hashRecord(raw.normalizedRecord);
        db.rows.get(`sweater_import_runs/${c.firstRun}`).result.rows[0].sourceHash = raw.sourceHash;
      }
      expect((await save(db, final)).washesCreated).toBe(0);
    });
  it.each([
    ['washes/ssp__B-5677597', { ssp_booking_id: 'B-5677597', worker_commission_paid: true }],
    ['sweater_booking_links/old-effect', { source: { ref: { ssp_booking_id: 'S-5677597' } } }],
    ['journal_entries/old-effect', { sourceId: 'S-5677597' }],
    ['sweater_adjustments/old-effect', { sourceId: 'S-5677597' }],
    ['accounting_periods/2026-10', { status: 'closed' }],
    ['sweater_settlements/2026-10', { status: 'approved' }],
  ])('never replaces an existing execution, entitlement or financial effect at %s', async (path, value) => {
    const { db, final } = await seedAssignmentMemory(assignmentCases[0]); db.rows.set(path, value);
    expect((await save(db, final)).washesCreated).toBe(0); expect(db.rows.get(path)).toEqual(value);
  });
  it('revalidates source assignment evidence after preview and detects later tampering', async () => {
    const c = assignmentCases[1]; let { db, final } = await seedAssignmentMemory(c);
    const p = await previewOperations(db, final); db.rows.get(`sweater_import_runs/${c.firstRun}`).result.rows[0].bikerId = c.toWorker;
    await expect(saveOperations(db, syncFV, syncRequest(final, p), 'synthetic')).rejects.toMatchObject({ code: 'failed-precondition' });
    ({ db, final } = await seedAssignmentMemory(c)); await save(db, final);
    db.rows.get(`sweater_raw_payloads/${c.firstRun}__B-${c.number}`).rawPayload.notes = 'changed';
    expect(await operationsStatus(db, final)).toMatchObject({ verified: false, linksVerified: false });
  });
});
