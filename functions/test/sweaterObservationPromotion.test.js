import { beforeEach, describe, expect, it } from 'vitest';
import { previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';
import { syncDb, syncFV, syncPayload, syncRequest } from './helpers/sweaterOperationsFixture.js';
import { hashRecord, normalizeRecord } from '../src/sweater/record.js';

let db, legacy, completed;
const save = async payload => saveOperations(db, syncFV, syncRequest(payload, await previewOperations(db, payload)), 'synthetic-agent');
const seed = async () => {
  db = syncDb(); legacy = syncPayload(); legacy.importRunId = 'synthetic-started';
  legacy.records[0] = { ...legacy.records[0], sspBookingId: 'B-990001', serviceType: 'interior_exterior_wash',
    rawStatus: 'Washing Started', startedAt: '2026-10-08T21:35:00+03:00' };
  legacy.coverage.extractedAt = '2026-10-08T22:10:00+03:00';
  await save(legacy);
  completed = structuredClone(legacy); completed.importRunId = 'synthetic-ended';
  completed.coverage.extractedAt = '2026-10-09T02:03:00+03:00';
  Object.assign(completed.records[0], { sspBookingId: 'S-990001', rawStatus: 'Collecting Payment', completedAt: '2026-10-08T22:39:00+03:00' });
};
const seedChain = async () => {
  db = syncDb(); const way = structuredClone(legacy); way.importRunId = 'synthetic-on-way';
  way.coverage.extractedAt = '2026-10-08T21:30:00+03:00';
  Object.assign(way.records[0], { rawStatus: 'On the Way', startedAt: null });
  await save(way); await save(legacy);
};
describe('source-proven prefix observation promotion, no owner decision', () => {
  beforeEach(seed);
  it('retains the first claim while proving a later started observation before prefix promotion', async () => {
    const next = structuredClone(legacy); next.importRunId = 'synthetic-started-second';
    next.coverage.extractedAt = '2026-10-08T22:15:00+03:00'; next.records[0].notes = 'A genuine later source observation';
    await save(next);
    const originals = new Map(db.rows);
    expect(db.rows.get('sweater_owner_booking_claims/990001').importRunId).toBe(legacy.importRunId);
    expect(db.rows.get('sweater_bookings/B-990001').lastImportRunId).toBe(next.importRunId);
    const p = await previewOperations(db, completed);
    expect(p.rows[0].observationPromotion?.eligible).toBe(true);
    const r = await saveOperations(db, syncFV, syncRequest(completed, p), 'synthetic-agent');
    expect(r.washesCreated).toBe(1);
    for (const [path, value] of originals) if (path !== 'sweater_integration_state/current') expect(db.rows.get(path)).toEqual(value);
    expect(await operationsStatus(db, completed)).toMatchObject({ verified: true, linksVerified: true });
  });
  it('proves an intact on-the-way claim with genuine later Start/End, never inferred completion', async () => {
    db = syncDb(); const way = structuredClone(legacy); way.importRunId = 'synthetic-on-way';
    way.coverage.extractedAt = '2026-10-08T21:30:00+03:00';
    Object.assign(way.records[0], { rawStatus: 'On the Way', startedAt: null });
    await save(way);
    const original = structuredClone(db.rows.get('sweater_bookings/B-990001'));
    const r = await save(completed);
    expect(r.washesCreated).toBe(1);
    expect(db.rows.get('sweater_bookings/B-990001')).toEqual(original);
    expect(db.rows.get('washes/ssp__B-990001').worker_commission_paid).toBe(false);
    expect(await operationsStatus(db, completed)).toMatchObject({ verified: true, linksVerified: true });
  });
  it('proves on-the-way, then started, then actual End without equating the first and latest import IDs', async () => {
    db = syncDb(); const way = structuredClone(legacy); way.importRunId = 'synthetic-on-way';
    way.coverage.extractedAt = '2026-10-08T21:30:00+03:00';
    Object.assign(way.records[0], { rawStatus: 'On the Way', startedAt: null });
    await save(way); await save(legacy);
    const p = await previewOperations(db, completed);
    expect(p.rows[0].observationPromotion?.eligible).toBe(true);
    expect(p.rows[0].observationPromotion?.evidenceRefs.map(r => r.id)).toEqual(expect.arrayContaining([
      'synthetic-on-way', 'synthetic-on-way__B-990001', 'synthetic-started', 'synthetic-started__B-990001',
    ]));
    expect((await saveOperations(db, syncFV, syncRequest(completed, p), 'synthetic-agent')).washesCreated).toBe(1);
    expect((await save({ ...completed, importRunId: 'synthetic-followup-observation' })).washesCreated).toBe(0);
    expect([...db.rows.keys()].filter(p => p.startsWith('washes/'))).toHaveLength(1);
  });
  it.each([
    ['missing claim raw', rows => rows.delete('sweater_raw_payloads/synthetic-on-way__B-990001')],
    ['missing latest raw', rows => rows.delete('sweater_raw_payloads/synthetic-started__B-990001')],
    ['missing claim run', rows => rows.delete('sweater_import_runs/synthetic-on-way')],
    ['claim run unfinished', rows => { rows.get('sweater_import_runs/synthetic-on-way').status = 'processing'; }],
    ['claim run already executed', rows => { rows.get('sweater_import_runs/synthetic-on-way').result.rows[0].washCreated = true; }],
    ['claim run worker conflict', rows => { rows.get('sweater_import_runs/synthetic-on-way').result.rows[0].bikerId = 'another-worker'; }],
    ['ambiguous claim receipt', rows => { const r = rows.get('sweater_import_runs/synthetic-on-way'); r.result.rows.push(structuredClone(r.result.rows[0])); }],
    ['claim observed after actual Start', rows => { rows.get('sweater_import_runs/synthetic-on-way').coverage.extractedAt = '2026-10-08T21:36:00+03:00'; }],
    ['latest observed after End', rows => { rows.get('sweater_import_runs/synthetic-started').coverage.extractedAt = '2026-10-08T22:40:00+03:00'; }],
    ['financially locked historical source', rows => { rows.get('sweater_raw_payloads/synthetic-on-way__B-990001').financialLock = true; }],
    ['changed latest Start', rows => { rows.get('sweater_raw_payloads/synthetic-started__B-990001').normalizedRecord.startedAt = '2026-10-08T21:36:00+03:00'; }],
    ['missing final Start', (_rows, payload) => { payload.records[0].startedAt = null; }],
    ['cancellation is not completion', (_rows, payload) => { payload.records[0].rawStatus = 'Cancelled by Admin'; }],
  ])('rejects a source chain with %s without replacing old evidence', async (_label, change) => {
    await seedChain(); change(db.rows, completed); const originals = new Map(db.rows);
    const r = await save(completed); expect(r.washesCreated).toBe(0);
    for (const [path, value] of originals) if (path !== 'sweater_integration_state/current') expect(db.rows.get(path)).toEqual(value);
  });
  it('rejects conflicting claim source facts even if its own raw hash and receipt agree', async () => {
    await seedChain();
    const raw = db.rows.get('sweater_raw_payloads/synthetic-on-way__B-990001');
    raw.rawPayload.driverExternalId = 'other-driver'; raw.normalizedRecord = normalizeRecord(raw.rawPayload);
    raw.sourceHash = hashRecord(raw.normalizedRecord);
    db.rows.get('sweater_import_runs/synthetic-on-way').result.rows[0].sourceHash = raw.sourceHash;
    expect((await save(completed)).washesCreated).toBe(0);
  });
  it('binds both source endpoints to the preview and checks preserved endpoints on readback', async () => {
    await seedChain(); const p = await previewOperations(db, completed);
    db.rows.get('sweater_import_runs/synthetic-on-way').coverage.extractedAt = '2026-10-08T21:29:00+03:00';
    await expect(saveOperations(db, syncFV, syncRequest(completed, p), 'synthetic-agent')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect([...db.rows.keys()].some(p => p.startsWith('washes/'))).toBe(false);
    await seedChain(); await save(completed);
    db.rows.get('sweater_raw_payloads/synthetic-on-way__B-990001').rawPayload.notes = 'changed';
    expect(await operationsStatus(db, completed)).toMatchObject({ verified: false, rawVerified: true, linksVerified: false });
  });
  it('never resumes or rewrites an already saved raw-only batch when the source chain becomes eligible', async () => {
    await seedChain(); const raw = db.rows.get('sweater_raw_payloads/synthetic-on-way__B-990001');
    const original = structuredClone(raw); raw.sourceHash = 'broken';
    expect((await save(completed)).washesCreated).toBe(0);
    db.rows.set('sweater_raw_payloads/synthetic-on-way__B-990001', original);
    const run = structuredClone(db.rows.get(`sweater_import_runs/${completed.importRunId}`));
    expect((await save(completed))).toMatchObject({ replay: true, washesCreated: 0 });
    expect(db.rows.get(`sweater_import_runs/${completed.importRunId}`)).toEqual(run);
    expect([...db.rows.keys()].some(p => p.startsWith('washes/'))).toBe(false);
  });
  it('preview is read-only, and promotes once using the original reserved wash ID without rewriting history', async () => {
    const originals = new Map(db.rows), writes = [...db.writes];
    const p = await previewOperations(db, completed);
    expect(db.rows).toEqual(originals); expect(db.writes).toEqual(writes);
    expect(p.rows[0]).toMatchObject({ reasonCode: null, washId: 'ssp__B-990001',
      observationPromotion: { eligible: true, promotionSaved: false, claimPreserved: true } });
    const result = await saveOperations(db, syncFV, syncRequest(completed, p), 'synthetic-agent');
    expect(result).toMatchObject({ washesCreated: 1, ledgerPosted: false, payrollPaid: false });
    expect(result.rows[0].observationPromotion.promotionSaved).toBe(true);
    for (const [path, value] of originals) if (path !== 'sweater_integration_state/current') expect(db.rows.get(path)).toEqual(value);
    const wash = db.rows.get('washes/ssp__B-990001');
    expect(wash).toMatchObject({ ssp_booking_id: 'S-990001', quantity: 1, price: 20, net_amount: 20, vat_amount: 3,
      gross_amount: 23, payment_method: null, collection_status: 'pending', worker_commission_per_wash: 4.5, worker_commission_paid: false });
    expect(wash.owner_completion_decision).toBeUndefined();
    expect(await operationsStatus(db, completed)).toMatchObject({ verified: true, verification: [
      { currentNaturalClaimMatches: true, observationPromotionVerified: true }] });
    expect(await operationsStatus(db, legacy)).toMatchObject({ verified: true });
    expect((await save(completed)).replay).toBe(true);
    expect((await save({ ...completed, importRunId: 'synthetic-new-run' })).washesCreated).toBe(0);
    expect((await save({ ...completed, importRunId: 'synthetic-other-prefix',
      records: [{ ...completed.records[0], sspBookingId: 'C-990001' }] })).washesCreated).toBe(0);
    expect([...db.rows.keys()].filter(p => p.startsWith('washes/'))).toHaveLength(1);
    expect([...db.rows.keys()].some(p => /^(journal_entries|payroll_runs|sweater_owner_collection_confirmations|sweater_collections)\//.test(p))).toBe(false);
  });
  it('serializes same-run retries and rejects stale distinct-run previews', async () => {
    const p = await previewOperations(db, completed);
    const results = await Promise.all([1, 2, 3].map(() => saveOperations(db, syncFV, syncRequest(completed, p), 'synthetic-agent')));
    expect(results.filter(r => !r.replay)).toHaveLength(1);
    await seed();
    const other = { ...completed, importRunId: 'synthetic-racing-run' };
    const [a, b] = await Promise.all([previewOperations(db, completed), previewOperations(db, other)]);
    const saves = await Promise.allSettled([saveOperations(db, syncFV, syncRequest(completed, a), 'synthetic-agent'),
      saveOperations(db, syncFV, syncRequest(other, b), 'synthetic-agent')]);
    expect(saves.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(saves.find(r => r.status === 'rejected').reason.code).toBe('failed-precondition');
  });
  it.each(['startedAt', 'serviceDate', 'driverExternalId', 'serviceType', 'bookingKind', 'completedAt', 'rawStatus'])(
    'does not promote conflicting or missing %s', async field => {
      const values = { startedAt: '2026-10-08T21:36:00+03:00', serviceDate: '2026-10-09', driverExternalId: 'other',
        serviceType: 'other', bookingKind: 'corporate', completedAt: null, rawStatus: 'Cancelled by Admin' };
      completed.records[0][field] = values[field];
      expect((await save(completed)).washesCreated).toBe(0);
    });
  it.each([
    ['washes/ssp__C-990001', { ssp_booking_id: 'C-990001', price: 20 }],
    ['washes/ssp__S-990001', { unrelated: true }],
    ['sweater_owner_collection_confirmations/C-990001', { owner: true }],
    ['sweater_booking_links/orphan', { source: { ref: { ssp_booking_id: 'C-990001' } } }],
    ['journal_entries/orphan', { sourceId: 'C-990001' }],
    ['posting_locks/orphan', { source: { bookingNumber: 990001 } }],
    ['transactions/orphan', { washId: 'ssp__C-990001' }],
    ['sweater_collections/orphan', { sourceRef: 'b__C-990001' }],
    ['sweater_adjustments/orphan', { source: { ref: { ssp_booking_id: 'C-990001' } } }],
    ['accounting_periods/2026-10', { status: 'closed' }],
    ['sweater_settlements/2026-10', { status: 'approved' }],
  ])('retains protection and preserves %s', async (path, value) => {
    db.rows.set(path, value);
    const before = new Map(db.rows);
    const result = await save(completed);
    expect(result.rows[0]).toMatchObject({ outcome: 'needs_review', reasonCode: 'protected_existing_record', bookingSaved: false });
    expect(result.washesCreated).toBe(0);
    for (const [key, row] of before) if (key !== 'sweater_integration_state/current') expect(db.rows.get(key)).toEqual(row);
  });
  it.each([
    ['sweater_bookings/B-990001', row => { row.ownerCompletionDecision = { decision: 'owner' }; }],
    ['sweater_bookings/B-990001', row => { row.unrecognizedMetadata = true; }],
    ['sweater_owner_booking_claims/990001', row => { row.source = 'staff_owner_confirmation'; }],
    ['sweater_raw_payloads/synthetic-started__B-990001', row => { row.sourceHash = 'different'; }],
    ['sweater_import_runs/synthetic-started', row => { row.status = 'processing'; }],
    ['sweater_import_runs/synthetic-started', row => { row.result.rows[0].washCreated = true; }],
  ])('requires intact source history: %s', async (path, change) => {
    change(db.rows.get(path));
    expect((await save(completed)).washesCreated).toBe(0);
  });
  it('rechecks even previously unreferenced financial rows at save, and detects historical tampering in readback', async () => {
    const p = await previewOperations(db, completed);
    db.rows.set('journal_entries/after-preview', { sourceId: 'C-990001' });
    await expect(saveOperations(db, syncFV, syncRequest(completed, p), 'synthetic-agent')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect([...db.rows.keys()].filter(p => p.startsWith('washes/'))).toHaveLength(0);
    await seed(); await save(completed);
    db.rows.get('sweater_bookings/B-990001').record.startedAt = 'changed';
    expect(await operationsStatus(db, completed)).toMatchObject({ verified: false, rawVerified: true, linksVerified: false });
  });
});
