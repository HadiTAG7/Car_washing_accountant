import { describe, expect, it } from 'vitest';
import { previewAdministrativeCompletion, saveAdministrativeCompletion } from '../src/sweater/administrativeCompletion.js';
import { completionFixture } from './administrativeCompletionFixture.js';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { bookingDocId, sspWashDocId, rawDocId, COL } from '../src/sweater/ingest.js';

async function savedFixture() {
  const db = memoryFinanceDb({ 'users/admin': { role: 'admin' }, 'users/partner': { role: 'partner' },
    'bikers/worker1': { name: 'Synthetic one', driver_external_id: '1982', start_date: '2026-08-01' },
    'bikers/worker2': { name: 'Synthetic two', driver_external_id: '2009', start_date: '2026-08-01' } });
  const payload = completionFixture(), preview = await previewAdministrativeCompletion(db, payload, 'admin');
  await saveAdministrativeCompletion(db, { serverTimestamp: () => 'TEST-SERVER-TIMESTAMP' }, {
    payload, reviewedPayloadHash: preview.reviewedPayloadHash, previewStateHash: preview.previewStateHash,
  }, 'admin');
  return { db, payload };
}
function noWrites(db) {
  const transaction = db.runTransaction;
  db.runTransaction = fn => transaction(tx => fn({ get: tx.get,
    set: () => { throw new Error('TEST write forbidden'); }, update: () => { throw new Error('TEST write forbidden'); },
    create: () => { throw new Error('TEST write forbidden'); }, delete: () => { throw new Error('TEST write forbidden'); } }));
}
describe('read-only current administrative completion verification', () => {
  it('checks current claim, one wash, original raw source, decision and unpaid commission, without a second save', async () => {
    const { db, payload } = await savedFixture(); noWrites(db);
    const before = JSON.stringify([...db.rows]);
    const result = await previewAdministrativeCompletion(db, payload, 'admin');
    expect(JSON.stringify([...db.rows])).toBe(before); expect(result.canSave).toBe(false); expect(result.replay).toBe(true);
    expect(result.verification).toMatchObject({ readOnly: true, status: 'verified', matched: 4, total: 4, coverage: { complete: true } });
    for (const row of result.verification.rows) {
      expect(row).toMatchObject({ verified: true, washCount: 1, claimCount: 1, commission: { amountPerWash: 4.5, paid: false, paymentTiming: 'payroll' } });
      expect(row.originalSource.completedAt).toBeNull(); expect(row.actualWashHash).toBe(row.expectedWashHash);
      expect(row.issues).toEqual([]);
    }
    for (const name of ['journal_entries', 'payroll_runs']) expect([...db.rows.keys()].some(key => key.startsWith(`${name}/`))).toBe(false);
  });
  it.each(['missing-claim', 'wrong-claim', 'duplicate-claim', 'missing-wash', 'duplicate-wash', 'paid-commission', 'missing-commission', 'wrong-commission', 'wrong-worker', 'wrong-decision', 'missing-raw', 'altered-raw'])('reports %s as a current mismatch without repairing anything', async fault => {
    const { db, payload } = await savedFixture(), raw = payload.records[0], number = raw.sspBookingId.slice(2), washId = sspWashDocId(raw.sspBookingId);
    const washKey = `washes/${washId}`, claimKey = `sweater_owner_booking_claims/${number}`;
    const wash = db.rows.get(washKey), claim = db.rows.get(claimKey);
    if (fault === 'missing-claim') db.rows.delete(claimKey);
    if (fault === 'wrong-claim') db.rows.set(claimKey, { ...claim, washId: 'TEST-other' });
    if (fault === 'duplicate-claim') db.rows.set('sweater_owner_booking_claims/TEST-alias', { ...claim });
    if (fault === 'missing-wash') db.rows.delete(washKey);
    if (fault === 'duplicate-wash') db.rows.set('washes/TEST-alias', { ...wash, ssp_booking_id: `B-${number}` });
    if (fault === 'paid-commission') db.rows.set(washKey, { ...wash, worker_commission_paid: true });
    if (fault === 'missing-commission') { const changed = { ...wash }; delete changed.worker_commission_paid; db.rows.set(washKey, changed); }
    if (fault === 'wrong-commission') db.rows.set(washKey, { ...wash, worker_commission_per_wash: 0 });
    if (fault === 'wrong-worker') db.rows.set(washKey, { ...wash, biker_id: 'TEST-other' });
    if (fault === 'wrong-decision') db.rows.set(washKey, { ...wash, owner_completion_decision: null });
    if (fault === 'missing-raw') db.rows.delete(`${COL.RAW}/${rawDocId(payload.importRunId, raw.sspBookingId)}`);
    if (fault === 'altered-raw') db.rows.set(`${COL.RAW}/${rawDocId(payload.importRunId, raw.sspBookingId)}`, {});
    noWrites(db); const before = JSON.stringify([...db.rows]);
    const result = await previewAdministrativeCompletion(db, payload, 'admin');
    expect(result.canSave).toBe(false); expect(result.verification.status).toBe('mismatch');
    expect(result.verification.rows[0].verified).toBe(false); expect(result.verification.rows[0].issues.length).toBeGreaterThan(0);
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('retains a legitimate existing claim from the raw import and reports a later SSP status separately', async () => {
    const { db, payload } = await savedFixture(), raw = payload.records[0], number = raw.sspBookingId.slice(2);
    const claimKey = `sweater_owner_booking_claims/${number}`, claim = db.rows.get(claimKey);
    db.rows.set(claimKey, { ...claim, source: 'operations_sync_v2', importRunId: 'TEST-earlier-source-run' });
    const bookingKey = `${COL.BOOKINGS}/${bookingDocId(raw.sspBookingId)}`, booking = db.rows.get(bookingKey);
    db.rows.set(bookingKey, { ...booking, record: { ...booking.record, rawStatus: 'Service Complete' } });
    noWrites(db); const result = await previewAdministrativeCompletion(db, payload, 'admin');
    expect(result.verification.status).toBe('verified');
    expect(result.verification.rows[0]).toMatchObject({ claimImportRunId: 'TEST-earlier-source-run', originalSource: { rawStatus: 'Cancelled by Admin' }, currentSource: { rawStatus: 'Service Complete' } });
  });
  it('keeps missing commission payment status unknown and does not disclose receipts to another role', async () => {
    const { db, payload } = await savedFixture(), key = `washes/${sspWashDocId(payload.records[0].sspBookingId)}`, row = { ...db.rows.get(key) };
    delete row.worker_commission_paid; db.rows.set(key, row); noWrites(db);
    expect((await previewAdministrativeCompletion(db, payload, 'admin')).verification.rows[0].commission.paid).toBeNull();
    await expect(previewAdministrativeCompletion(db, payload, 'partner')).rejects.toThrow(/للمدير/);
    const changed = structuredClone(payload); changed.decision.statement += ' changed';
    await expect(previewAdministrativeCompletion(db, changed, 'admin')).rejects.toThrow(/محتوى/);
  });
  it('does not call a limited scan complete or report an unknown unique-wash count as zero', async () => {
    const { db, payload } = await savedFixture();
    for (let i = 0; i < 10001; i++) db.rows.set(`washes/TEST-extra-${i}`, { ssp_booking_id: `B-${8000000 + i}` });
    noWrites(db); const result = await previewAdministrativeCompletion(db, payload, 'admin');
    expect(result.verification).toMatchObject({ status: 'unavailable', coverage: { complete: false, washCoverage: false } });
    expect(result.verification.rows[0].washCount).toBeNull(); expect(result.verification.rows[0].verified).toBe(false);
  });
});
