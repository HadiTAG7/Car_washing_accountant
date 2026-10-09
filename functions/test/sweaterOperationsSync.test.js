import { describe, it, expect } from 'vitest';
import { validateOperationsPayload, previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';

export const syncPayload = () => ({ contractVersion: 2, importRunId: 'synthetic-sync-1', agentStatus: 'ok',
  coverage: { rangeFrom: '2026-10-08', rangeTo: '2026-10-08', extractedAt: '2026-10-09T00:00:00+03:00',
    pageCount: 1, pagesFetched: 1, recordCount: 1, isComplete: false, sourceUrl: 'https://ssp-portal.sweater.sa/bookings',
    modules: { individual: 'complete', corporate: 'unavailable' }, gaps: ['Corporate module unavailable'] },
  workerLinks: { 'driver-1': 'worker-1' },
  records: [{ sspBookingId: 'C-990001', bookingKind: 'individual', serviceType: 'observed-service',
    serviceDate: '2026-10-08', rawStatus: 'Collecting Payment', driverExternalId: 'driver-1',
    sourceUrl: 'https://ssp-portal.sweater.sa/bookings' }] });

export function syncDb() {
  const rows = new Map([['bikers/worker-1', { name: 'Synthetic worker', driver_external_id: 'driver-1', salary: 900 }]]);
  const writes = []; const snapshot = path => ({ exists: rows.has(path), id: path.split('/').at(-1), data: () => structuredClone(rows.get(path)) });
  const ref = path => ({ path, get: async () => snapshot(path) }); let queue = Promise.resolve();
  return { rows, writes, collection: name => ({ doc: id => ref(`${name}/${id}`),
    get: async () => ({ docs: [...rows.keys()].filter(p => p.startsWith(`${name}/`)).map(snapshot) }) }),
  runTransaction: fn => { const result = queue.then(async () => {
    const pending = []; const out = await fn({ get: ref => ref.get(), set: (ref, value, options) => pending.push([ref.path, value, options]) });
    for (const [path, value, options] of pending) { rows.set(path, options?.merge ? { ...rows.get(path), ...structuredClone(value) } : structuredClone(value)); writes.push(path); }
    return out;
  }); queue = result.catch(() => {}); return result; } };
}
export const syncFV = { serverTimestamp: () => 'synthetic-time' };
export const syncRequest = (payload, p) => ({ payload, reviewedPayloadHash: p.reviewedPayloadHash, previewStateHash: p.previewStateHash });
const save = async (db, payload) => saveOperations(db, syncFV, syncRequest(payload, await previewOperations(db, payload)), 'sweater-browser-agent');

describe('bounded operational raw sync, not a financial or owner assertion', () => {
  it('previews without writing and atomically saves raw facts only with B2B gaps', async () => {
    const db = syncDb(), b = syncPayload(); const p = await previewOperations(db, b); expect(db.writes).toEqual([]);
    const result = await saveOperations(db, syncFV, syncRequest(b, p), 'sweater-browser-agent');
    expect(result).toMatchObject({ saved: true, status: 'completed_with_gaps', washesCreated: 0, ledgerPosted: false, payrollPaid: false });
    expect(db.rows.get('sweater_bookings/C-990001').record).toMatchObject({ rawStatus: 'Collecting Payment', platformAmount: null, completedAt: null });
    expect(db.rows.get('sweater_bookings/C-990001').recognitionEligibility).toBeNull();
    expect(db.writes.every(p => p.startsWith('sweater_'))).toBe(true);
    expect(await operationsStatus(db, b)).toMatchObject({ found: true, verified: true, result: { washesCreated: 0 } });
  });
  it('recovers a lost response and new-run duplicates with no second booking or wash', async () => {
    const db = syncDb(), b = syncPayload(); await save(db, b); const writes = db.writes.length;
    expect(await operationsStatus(db, b)).toMatchObject({ found: true, verified: true });
    expect((await save(db, b)).replay).toBe(true); expect(db.writes.length).toBe(writes);
    const next = { ...b, importRunId: 'synthetic-next' }; expect((await save(db, next)).counts.duplicate).toBe(1);
    expect([...db.rows.keys()].filter(p => p.startsWith('sweater_bookings/'))).toHaveLength(1);
    expect([...db.rows.keys()].filter(p => p.startsWith('washes/'))).toHaveLength(0);
  });
  it.each(['coverage', 'agentStatus', 'workerLinks'])('rejects changed %s under the same run, despite unchanged records', async field => {
    const db = syncDb(), b = syncPayload(); await save(db, b); const changed = structuredClone(b);
    if (field === 'coverage') changed.coverage.extractedAt = '2026-10-09T00:01:00+03:00';
    if (field === 'agentStatus') changed.agentStatus = 'partial';
    if (field === 'workerLinks') changed.workerLinks['driver-1'] = 'other-worker';
    await expect(previewOperations(db, changed)).rejects.toMatchObject({ code: 'already-exists' });
    await expect(operationsStatus(db, changed)).rejects.toMatchObject({ code: 'already-exists' });
  });
  it.each(['sweater_owner_collection_confirmations', 'sweater_booking_links', 'sweater_operational_wash_links', 'washes'])('preserves a protected %s link and saves conflicting observations for review only', async collection => {
    const db = syncDb(), b = syncPayload(); const path = `${collection}/legacy`;
    const original = { sspBookingId: 'S-990001', ssp_booking_id: 'S-990001', postedEntryId: 'protected-entry', washId: 'legacy-wash' };
    db.rows.set(path, original); const result = await save(db, b);
    expect(result.rows[0]).toMatchObject({ outcome: 'needs_review', rawSaved: true, bookingSaved: false });
    expect(db.rows.get(path)).toEqual(original); expect(db.rows.has('sweater_bookings/C-990001')).toBe(false);
  });
  it('does not modify a financially locked booking even when a new run carries a new status', async () => {
    const db = syncDb(), b = syncPayload(); await save(db, b);
    const row = db.rows.get('sweater_bookings/C-990001'); row.settlementId = 'protected-settlement';
    const original = structuredClone(row); b.importRunId = 'synthetic-change'; b.records[0].rawStatus = 'Cancelled by Admin';
    expect((await save(db, b)).rows[0].outcome).toBe('needs_review'); expect(db.rows.get('sweater_bookings/C-990001')).toEqual(original);
  });
  it.each(['Initiated', 'An entirely new status'])('retains %s as raw review, not completed, paid, or owner-confirmed', async rawStatus => {
    const db = syncDb(), b = syncPayload(); b.records[0].rawStatus = rawStatus;
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'needs_review', rawSaved: true, reasonCode: 'unknown_status' });
    expect(db.rows.get('sweater_bookings/C-990001').processingStatus).toBe('needs_review');
    expect(db.writes.some(p => /^(washes|journal_entries|sweater_owner_collection_confirmations)\//.test(p))).toBe(false);
  });
  it('missing service is rejected, missing worker is retained for review without a guessed link', async () => {
    const db = syncDb(), b = syncPayload(); delete b.records[0].serviceType;
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'rejected', rawSaved: false });
    b.importRunId = 'synthetic-missing-worker'; b.records[0].serviceType = 'observed-service'; delete b.records[0].driverExternalId;
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'needs_review', rawSaved: true, bikerId: null });
  });
  it('a worker map is not enough without an established registry or existing operational link', async () => {
    const db = syncDb(), b = syncPayload(); delete db.rows.get('bikers/worker-1').driver_external_id;
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'needs_review', reasonCode: 'unverified_worker_link', bikerId: null });
  });
  it('concurrent new batch/prefix variants cannot overwrite the natural claim or duplicate a booking', async () => {
    const db = syncDb(), a = syncPayload(), b = syncPayload(); b.importRunId = 'synthetic-race'; b.records[0].sspBookingId = 'S-990001';
    const [pa, pb] = await Promise.all([previewOperations(db, a), previewOperations(db, b)]);
    const results = await Promise.allSettled([saveOperations(db, syncFV, syncRequest(a, pa), 'agent'), saveOperations(db, syncFV, syncRequest(b, pb), 'agent')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect([...db.rows.keys()].filter(p => p.startsWith('sweater_bookings/'))).toHaveLength(1);
    expect(db.rows.get('sweater_owner_booking_claims/990001').sspBookingId).toBe('C-990001');
  });
  it.each([
    b => { b.ownerConfirmation = { source: 'owner_statement' }; },
    b => { b.workerLinks = { x: { token: 'never' } }; },
    b => { b.coverage.isComplete = true; },
    b => { b.coverage.sourceUrl = 'https://evil.example/'; },
    b => { b.importRunId = '../unsafe'; },
    b => { b.records = new Array(101).fill(b.records[0]); b.coverage.recordCount = 101; },
  ])('fails a malformed or dishonest envelope before data access', mutate => {
    const b = syncPayload(); mutate(b); expect(() => validateOperationsPayload(b)).toThrow();
  });
  it('rejects prohibited fields without persisting their values', async () => {
    const db = syncDb(), b = syncPayload(); b.records[0].netAmount = 20;
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'rejected', rawSaved: false });
    expect(JSON.stringify([...db.rows.values()])).not.toContain('netAmount');
  });
  it('does not choose the first of conflicting same-number rows in a batch', async () => {
    const db = syncDb(), b = syncPayload(); b.records.push({ ...b.records[0], sspBookingId: 'S-990001', rawStatus: 'Cancelled by Admin' }); b.coverage.recordCount = 2;
    const result = await save(db, b); expect(result.counts.rejected).toBe(2);
    expect(result.rawSavedCount).toBe(0); expect(db.rows.has('sweater_bookings/C-990001')).toBe(false);
  });
  it('reports historical raw persistence separately from changed current booking/links', async () => {
    const db = syncDb(), b = syncPayload(); await save(db, b);
    db.rows.get('sweater_bookings/C-990001').sourceHash = 'changed-after-save';
    expect(await operationsStatus(db, b)).toMatchObject({ found: true, verified: false, rawVerified: true, linksVerified: false });
  });
  it('an established existing worker/wash mapping supports raw facts without changing worker or wash', async () => {
    const db = syncDb(), b = syncPayload(); delete db.rows.get('bikers/worker-1').driver_external_id;
    db.rows.set('washes/prior-other-booking', { ssp_booking_id: 'C-880002', driver_external_id: 'driver-1', biker_id: 'worker-1' });
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'new', bikerId: 'worker-1' });
    expect(db.writes.some(p => p.startsWith('washes/'))).toBe(false);
  });
});
