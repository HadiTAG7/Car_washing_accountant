import { describe, expect, it } from 'vitest';
import { previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';
import { normalizeRecord } from '../src/sweater/record.js';
import { syncDb, syncFV, syncPayload, syncRequest } from './helpers/sweaterOperationsFixture.js';

const SOURCE = 'operations_sync_v2';
const save = async (db, payload) => saveOperations(db, syncFV, syncRequest(payload, await previewOperations(db, payload)), 'synthetic-agent');
function observation(id, status, cut, fields = {}) {
  const p = syncPayload(); p.importRunId = id; p.coverage.extractedAt = `2026-10-08T${cut}:00+03:00`;
  p.records[0] = { ...p.records[0], sspBookingId: 'B-990801', rawStatus: status,
    serviceType: 'interior_exterior_wash', ...fields };
  return p;
}
const finish = (status = 'Collecting Payment', prefix = 'S') => observation('synthetic-finish', status, '22:00', {
  sspBookingId: `${prefix}-990801`, startedAt: '2026-10-08T21:08:00+03:00', completedAt: '2026-10-08T21:50:00+03:00',
});
async function initiatedChain(db, latest = 'Reached') {
  const first = observation('synthetic-initiated', 'Initiated', '20:00'); await save(db, first);
  const next = observation('synthetic-latest', latest, '21:00'); await save(db, next);
  return { first, next };
}
const washRows = db => [...db.rows.entries()].filter(([p]) => p.startsWith('washes/'));
// The booking is kept under its number and shows Sweater's latest reading; everything else stays as it was.
const MOVES = new Set(['sweater_integration_state/current', 'sweater_bookings/990801', 'sweater_variances/ops__990801']);
describe('observed SSP source states in the operational execution contract only', () => {
  it('promotes Initiated → Reached → real Start/End while preserving unknown source facts and the initial claim', async () => {
    const db = syncDb(); const { first, next } = await initiatedChain(db);
    const originals = new Map(db.rows); const payload = finish();
    const p = await previewOperations(db, payload);
    expect(db.rows).toEqual(originals);
    expect(p.rows[0]).toMatchObject({ reasonCode: null, observationPromotion: { eligible: true } });
    const r = await saveOperations(db, syncFV, syncRequest(payload, p), 'synthetic-agent');
    expect(r).toMatchObject({ washesCreated: 1, ledgerPosted: false, payrollPaid: false });
    expect(db.rows.get('sweater_owner_booking_claims/990801')).toMatchObject({ importRunId: first.importRunId, source: SOURCE });
    // Reached was kept as still moving in Sweater; the source facts of each reading stay in its raw row.
    expect(originals.get('sweater_bookings/990801')).toMatchObject({ normalizedStatus: 'unknown', reviewReasonCode: 'unknown_status',
      processingStatus: 'pending_source', lastImportRunId: next.importRunId, record: { rawStatus: 'Reached', normalizedStatus: 'unknown' } });
    expect(db.rows.get('sweater_bookings/990801')).toMatchObject({ sspBookingId: 'S-990801', processingStatus: 'validated',
      aliases: ['B-990801', 'S-990801'], record: { rawStatus: 'Collecting Payment' } });
    for (const [path, value] of originals) if (!MOVES.has(path)) expect(db.rows.get(path)).toEqual(value);
    expect(await operationsStatus(db, payload)).toMatchObject({ verified: true, rawVerified: true, linksVerified: true });
    expect((await save(db, { ...payload, importRunId: 'synthetic-subsequent' })).washesCreated).toBe(0);
    expect(washRows(db)).toHaveLength(1);
  });
  it('accepts literal completed with genuine Start/End without renaming it Collecting Payment or asserting collection', async () => {
    const db = syncDb(), payload = finish('completed', 'B');
    expect(normalizeRecord(payload.records[0])).toMatchObject({ rawStatus: 'completed', normalizedStatus: 'unknown' });
    expect((await save(db, payload))).toMatchObject({ washesCreated: 1, ledgerPosted: false, payrollPaid: false });
    expect(washRows(db)[0][1]).toMatchObject({ worker_commission_per_wash: 4.5, worker_commission_paid: false,
      collection_status: 'pending', payment_method: null, price: 20, net_amount: 20, vat_amount: 3, gross_amount: 23 });
    expect(db.rows.get('sweater_bookings/990801')).toMatchObject({ processingStatus: 'validated',
      record: { rawStatus: 'completed', normalizedStatus: 'unknown' } });
    expect(await operationsStatus(db, payload)).toMatchObject({ verified: true });
    expect((await save(db, payload)).replay).toBe(true);
    expect((await save(db, { ...payload, importRunId: 'synthetic-later' })).washesCreated).toBe(0);
    expect(washRows(db)).toHaveLength(1);
  });
  it('can execute a later genuine completed observation following an earlier started record once', async () => {
    const db = syncDb(), payload = finish('completed', 'B');
    await save(db, observation('synthetic-started', 'Washing Started', '21:20', {
      startedAt: payload.records[0].startedAt,
    }));
    expect((await save(db, payload)).washesCreated).toBe(1);
    expect((await save(db, payload))).toMatchObject({ replay: true, washesCreated: 1 });
    expect(washRows(db)).toHaveLength(1);
  });
  it.each(['Initiated', 'Reached', 'Washing Started', 'Completed with issues', 'Something New', 'Cancelled by Admin'])(
    'never treats %s as a completed execution even when supplied with Start/End', async status => {
      const db = syncDb(); expect((await save(db, finish(status, 'B'))).washesCreated).toBe(0);
      expect(washRows(db)).toHaveLength(0);
    });
  it.each(['startedAt', 'completedAt'])('completed still requires actual %s', async field => {
    const db = syncDb(), payload = finish('completed', 'B'); payload.records[0][field] = null;
    expect((await save(db, payload)).washesCreated).toBe(0);
  });
  it.each(['Initiated', 'Reached'])('refuses an earlier %s observed after the actual Start', async status => {
    const db = syncDb(); await save(db, observation('synthetic-too-late', status, '21:09'));
    expect((await save(db, finish())).washesCreated).toBe(0);
  });
  it.each(['Washing Started', 'On the Way'])('retains the reassignment protection after an initial different driver and later %s', async status => {
    const db = syncDb(); db.rows.set('bikers/worker-2', { name: 'Synthetic second worker', driver_external_id: 'driver-2' });
    await save(db, observation('synthetic-first-driver', 'Initiated', '20:00', { driverExternalId: 'driver-2' }));
    await save(db, observation('synthetic-new-driver', status, status === 'Washing Started' ? '21:20' : '21:00',
      status === 'Washing Started' ? { startedAt: '2026-10-08T21:08:00+03:00' } : {}));
    const originals = new Map(db.rows), payload = finish(); const p = await previewOperations(db, payload);
    expect(p.rows[0]).toMatchObject({ reasonCode: 'protected_existing_record', observationPromotion: { eligible: false } });
    expect((await saveOperations(db, syncFV, syncRequest(payload, p), 'synthetic-agent')).washesCreated).toBe(0);
    for (const [path, value] of originals) if (!MOVES.has(path)) expect(db.rows.get(path)).toEqual(value);
    expect(db.rows.get('sweater_variances/ops__990801')).toMatchObject({ resolution: 'unresolved', reasonCode: 'protected_existing_record' });
    expect(washRows(db)).toHaveLength(0);
  });
  it.each([
    ['accounting_periods/2026-10', { status: 'closed' }],
    ['sweater_settlements/2026-10', { status: 'approved' }],
    ['washes/ssp__C-990801', { ssp_booking_id: 'C-990801', worker_commission_paid: true }],
    ['journal_entries/related', { sourceId: 'S-990801' }],
  ])('does not release a Reached chain protected by %s', async (path, value) => {
    const db = syncDb(); await initiatedChain(db); db.rows.set(path, value);
    expect((await save(db, finish())).washesCreated).toBe(0); expect(db.rows.get(path)).toEqual(value);
  });
});
