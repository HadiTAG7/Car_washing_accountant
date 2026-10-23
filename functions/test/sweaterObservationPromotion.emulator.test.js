import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';
import { operationsHandler, operationsSigningHash } from '../src/sweater/operationsHttp.js';
import { createIntegrationKey, computeSignature } from '../src/sweater/integrationKeys.js';
import { syncPayload, syncRequest } from './helpers/sweaterOperationsFixture.js';

const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app, db, previousEncryption;
const save = async payload => saveOperations(db, FieldValue, syncRequest(payload, await previewOperations(db, payload)), 'synthetic-agent');
async function seed() {
  await db.doc('bikers/worker-1').set({ name: 'Synthetic worker', driver_external_id: 'driver-1', salary: 900 });
  const legacy = syncPayload(); legacy.importRunId = 'synthetic-started';
  legacy.coverage.extractedAt = '2026-10-08T22:10:00+03:00'; legacy.coverage.recordCount = 2;
  legacy.records = ['990101', '990102'].map(number => ({ ...legacy.records[0], sspBookingId: `B-${number}`,
    serviceType: 'interior_exterior_wash', rawStatus: 'Washing Started', startedAt: '2026-10-08T21:35:00+03:00' }));
  await save(legacy);
  for (let i = 0; i < 43; i++) await db.doc(`washes/synthetic-existing-${i}`).set({ ssp_booking_id: `S-${880000 + i}`, price: 20 });
  const completed = structuredClone(legacy); completed.importRunId = 'synthetic-ended';
  completed.coverage.extractedAt = '2026-10-09T02:03:00+03:00';
  completed.records = completed.records.map(r => ({ ...r, sspBookingId: r.sspBookingId.replace('B-', 'S-'),
    rawStatus: 'Collecting Payment', completedAt: '2026-10-08T22:39:00+03:00' }));
  return { legacy, completed };
}
suite('source observation promotion in isolated demo transactions', () => {
  beforeAll(() => {
    if (!String(process.env.GCLOUD_PROJECT || '').startsWith('demo-sweater')) throw new Error('Only isolated demo-sweater allowed');
    app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'observation-promotion-emulator'); db = getFirestore(app);
    previousEncryption = process.env.SWEATER_KEY_ENCRYPTION_KEY;
    process.env.SWEATER_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
  beforeEach(async () => {
    const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Cannot clear isolated demo');
  });
  afterAll(async () => {
    if (previousEncryption == null) delete process.env.SWEATER_KEY_ENCRYPTION_KEY; else process.env.SWEATER_KEY_ENCRYPTION_KEY = previousEncryption;
    await db?.terminate(); if (app) await deleteApp(app);
  });
  it('signed preview and same-run concurrent save add exactly two, retain43/source/claim/run and verify replay', async () => {
    const { legacy, completed } = await seed();
    const paths = ['sweater_bookings/B-990101', 'sweater_bookings/B-990102',
      'sweater_owner_booking_claims/990101', 'sweater_owner_booking_claims/990102', 'sweater_import_runs/synthetic-started',
      'sweater_raw_payloads/synthetic-started__B-990101', 'sweater_raw_payloads/synthetic-started__B-990102',
      ...Array.from({ length: 43 }, (_, i) => `washes/synthetic-existing-${i}`)];
    const originals = await Promise.all(paths.map(path => db.doc(path).get()));
    const key = await createIntegrationKey(db, FieldValue, { label: 'Synthetic promotion test key' });
    const handler = operationsHandler({ getDb: () => db, FieldValue });
    const call = async (body, signed = body) => {
      const ts = String(Math.floor(Date.now() / 1000));
      const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ method: 'POST', body, headers: { 'x-sweater-key-id': key.keyId, 'x-sweater-timestamp': ts,
        'x-sweater-signature': computeSignature(key.secret, ts, signed.payload.importRunId, operationsSigningHash(signed)) } }, response);
      return response;
    };
    const previewBody = { action: 'preview', payload: completed };
    const p = await call(previewBody); expect(p.code).toBe(200);
    expect(p.body.result.rows.every(r => r.observationPromotion.eligible && !r.observationPromotion.promotionSaved)).toBe(true);
    expect((await db.collection('washes').get()).size).toBe(43);
    const tampered = structuredClone(previewBody); tampered.payload.records[0].completedAt = '2026-10-08T22:40:00+03:00';
    expect((await call(tampered, previewBody)).code).toBe(401);
    const saveBody = { action: 'save', ...syncRequest(completed, p.body.result) };
    const results = await Promise.all([call(saveBody), call(saveBody)]);
    expect(results.every(r => r.code === 200)).toBe(true);
    expect(results.filter(r => !r.body.result.replay)).toHaveLength(1);
    expect(results[0].body.result).toMatchObject({ washesCreated: 2, ledgerPosted: false, payrollPaid: false });
    expect((await db.collection('washes').get()).size).toBe(45);
    for (const original of originals) expect((await original.ref.get()).updateTime.isEqual(original.updateTime)).toBe(true);
    expect(await operationsStatus(db, legacy)).toMatchObject({ verified: true });
    expect(await operationsStatus(db, completed)).toMatchObject({ verified: true, verification: [
      { observationPromotionVerified: true }, { observationPromotionVerified: true }] });
    expect((await call(saveBody)).body.result.replay).toBe(true);
    expect((await save({ ...completed, importRunId: 'synthetic-later' })).washesCreated).toBe(0);
    const washes = await Promise.all(['990101', '990102'].map(n => db.doc(`washes/ssp__B-${n}`).get()));
    for (const wash of washes) expect(wash.data()).toMatchObject({ net_amount: 20, vat_amount: 3, gross_amount: 23,
      payment_method: null, collection_status: 'pending', worker_commission_per_wash: 4.5, worker_commission_paid: false });
    expect(washes.reduce((sum, wash) => sum + wash.data().worker_commission_per_wash, 0)).toBe(9);
    for (const col of ['journal_entries', 'payroll_runs', 'sweater_owner_collection_confirmations', 'sweater_collections']) expect((await db.collection(col).get()).empty).toBe(true);
  });
  it('distinct-run races and a concurrent owner link cannot reuse stale previews', async () => {
    const { completed } = await seed(); const other = { ...completed, importRunId: 'synthetic-competing' };
    const [a, b] = await Promise.all([previewOperations(db, completed), previewOperations(db, other)]);
    const results = await Promise.allSettled([saveOperations(db, FieldValue, syncRequest(completed, a), 'synthetic'),
      saveOperations(db, FieldValue, syncRequest(other, b), 'synthetic')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.code).toBe('failed-precondition');
    expect((await db.collection('washes').get()).size).toBe(45);
  });
  it('a financial or owner reference added after preview is protected and not overwritten', async () => {
    const { completed } = await seed(); const p = await previewOperations(db, completed);
    const owner = { source: { ref: { ssp_booking_id: 'C-990101' } } };
    await db.doc('journal_entries/synthetic-protection').set(owner);
    await expect(saveOperations(db, FieldValue, syncRequest(completed, p), 'synthetic')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db.collection('washes').get()).size).toBe(43);
    expect((await db.doc('journal_entries/synthetic-protection').get()).data()).toEqual(owner);
    const next = await previewOperations(db, completed);
    expect(next.rows[0]).toMatchObject({ reasonCode: 'protected_existing_record', observationPromotion: { eligible: false } });
  });
});
