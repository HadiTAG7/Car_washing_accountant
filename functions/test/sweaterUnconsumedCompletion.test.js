import { describe, expect, it } from 'vitest';
import { previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';
import { seedUnconsumedCompletion } from './helpers/sweaterUnconsumedCompletionFixture.js';
import { syncFV, syncRequest } from './helpers/sweaterOperationsFixture.js';

const save = async (db, p) => saveOperations(db, syncFV, syncRequest(p, await previewOperations(db, p)), 'synthetic');
describe('unconsumed literal completed source with a later prefix observation', () => {
  it('adds one application execution with the old source Start/End, preserving the old zero-wash receipt and claim', async () => {
    const { db, old, current } = await seedUnconsumedCompletion(), originals = new Map(db.rows);
    const p = await previewOperations(db, current); expect(db.rows).toEqual(originals);
    expect(p.rows[0]).toMatchObject({ reasonCode: null, washId: 'ssp__B-990301', observationPromotion: { eligible: true } });
    const results = await Promise.all([1, 2].map(() => saveOperations(db, syncFV, syncRequest(current, p), 'synthetic')));
    expect(results.filter(r => !r.replay)).toHaveLength(1);
    for (const [path, value] of originals) if (path !== 'sweater_integration_state/current') expect(db.rows.get(path)).toEqual(value);
    expect(db.rows.get('washes/ssp__B-990301')).toMatchObject({ biker_id: 'worker-1', worker_commission_per_wash: 4.5,
      worker_commission_paid: false, collection_status: 'pending', payment_method: null });
    expect(await operationsStatus(db, old)).toMatchObject({ verified: true, result: { washesCreated: 0 } });
    expect(await operationsStatus(db, current)).toMatchObject({ verified: true, rawVerified: true, linksVerified: true });
    expect((await save(db, old))).toMatchObject({ replay: true, washesCreated: 0 });
    expect((await save(db, { ...current, importRunId: 'synthetic-next-observation' })).washesCreated).toBe(0);
    expect([...db.rows.keys()].filter(p => p.startsWith('washes/'))).toHaveLength(1);
  });
  it.each(['startedAt', 'completedAt'])('rejects a different current %s rather than changing source facts', async key => {
    const { db, current } = await seedUnconsumedCompletion(); current.records[0][key] = '2026-10-08T10:01:00+03:00';
    expect((await save(db, current)).washesCreated).toBe(0);
  });
  it.each([
    ['observation before End', rows => { rows.get('sweater_import_runs/synthetic-old-completed').coverage.extractedAt = '2026-10-08T10:20:00+03:00'; }],
    ['receipt already created a wash', rows => { rows.get('sweater_import_runs/synthetic-old-completed').result.rows[0].washCreated = true; }],
    ['receipt already links a wash', rows => { rows.get('sweater_import_runs/synthetic-old-completed').result.rows[0].washId = 'existing'; }],
    ['receipt did not save booking', rows => { rows.get('sweater_import_runs/synthetic-old-completed').result.rows[0].bookingSaved = false; }],
    ['source hash conflict', rows => { rows.get('sweater_raw_payloads/synthetic-old-completed__B-990301').sourceHash = 'changed'; }],
    ['financial effect', rows => rows.set('journal_entries/existing', { sourceId: 'B-990301' })],
    ['paid execution', rows => rows.set('washes/ssp__C-990301', { ssp_booking_id: 'C-990301', worker_commission_paid: true })],
    ['closed period', rows => rows.set('accounting_periods/2026-10', { status: 'closed' })],
  ])('keeps protection with %s', async (_label, change) => {
    const { db, current } = await seedUnconsumedCompletion(); change(db.rows); const originals = new Map(db.rows);
    expect((await save(db, current)).washesCreated).toBe(0);
    for (const [path, value] of originals) if (path !== 'sweater_integration_state/current') expect(db.rows.get(path)).toEqual(value);
  });
  it('binds both endpoint receipts at save and flags later history tampering in readback', async () => {
    let { db, current } = await seedUnconsumedCompletion(); const p = await previewOperations(db, current);
    db.rows.get('sweater_import_runs/synthetic-old-completed').coverage.extractedAt = '2026-10-08T11:01:00+03:00';
    await expect(saveOperations(db, syncFV, syncRequest(current, p), 'synthetic')).rejects.toMatchObject({ code: 'failed-precondition' });
    ({ db, current } = await seedUnconsumedCompletion()); await save(db, current);
    db.rows.get('sweater_bookings/B-990301').record.rawStatus = 'changed';
    expect(await operationsStatus(db, current)).toMatchObject({ verified: false, rawVerified: true, linksVerified: false });
  });
});
