import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { historicalPayload, requestFrom, seedHistorical5643311 } from './helpers/historical5643311Fixture.js';
import { previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';
import { operationsHandler, operationsSigningHash } from '../src/sweater/operationsHttp.js';
import { createIntegrationKey, computeSignature } from '../src/sweater/integrationKeys.js';

const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app, db, encryption;
const worker = 'bikers/mjIi1UW9FlKYmomXxgJE';
const paths = ['sweater_bookings/B-5643311', 'sweater_owner_booking_claims/5643311', worker,
  'sweater_import_runs/ops-20261020-oct20-2200-190721', 'sweater_import_runs/ops-20261023-late-oct19-20-192552',
  'sweater_raw_payloads/ops-20261020-oct20-2200-190721__B-5643311',
  'sweater_raw_payloads/ops-20261023-late-oct19-20-192552__S-5643311'];
suite('historical5643311 on isolated real transactional storage', () => {
  beforeAll(() => {
    if (!String(process.env.GCLOUD_PROJECT || '').startsWith('demo-sweater')
      || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Only isolated local demo-sweater tests allowed');
    app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'historical5643311'); db = getFirestore(app);
    encryption = process.env.SWEATER_KEY_ENCRYPTION_KEY;
    process.env.SWEATER_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
  beforeEach(async () => {
    const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Cannot clear isolated demo');
    await db.doc(worker).set({ name: 'Synthetic internal employee', driver_external_id: '2007', salary: 900, start_date: '2026-08-17' });
    await seedHistorical5643311(db, FieldValue);
  });
  afterAll(async () => {
    if (encryption == null) delete process.env.SWEATER_KEY_ENCRYPTION_KEY; else process.env.SWEATER_KEY_ENCRYPTION_KEY = encryption;
    await db?.terminate(); if (app) await deleteApp(app);
  });
  it('signed preview, same-run concurrency, lost-response status and replay preserve history and create one effect', async () => {
    const before = await Promise.all(paths.map(path => db.doc(path).get()));
    const key = await createIntegrationKey(db, FieldValue, { label: 'Synthetic historical case' });
    const handler = operationsHandler({ getDb: () => db, FieldValue });
    const call = async (body, signed = body) => {
      const ts = String(Math.floor(Date.now() / 1000));
      const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ method: 'POST', body, headers: { 'x-sweater-key-id': key.keyId, 'x-sweater-timestamp': ts,
        'x-sweater-signature': computeSignature(key.secret, ts, signed.payload.importRunId, operationsSigningHash(signed)) } }, res);
      return res;
    };
    const payload = historicalPayload(), previewBody = { action: 'preview', payload };
    const p = await call(previewBody); expect(p.code).toBe(200);
    expect(p.body.result.rows[0].historicalIdentityResolution.eligible).toBe(true);
    expect((await db.collection('washes').get()).empty).toBe(true);
    for (const snapshot of before) expect((await snapshot.ref.get()).updateTime.isEqual(snapshot.updateTime)).toBe(true);
    const tampered = structuredClone(previewBody); tampered.payload.records[0].completedAt = '2026-10-20T22:11:00+03:00';
    expect((await call(tampered, previewBody)).code).toBe(401);
    const saveBody = { action: 'save', ...requestFrom(payload, p.body.result) };
    const responses = await Promise.all([call(saveBody), call(saveBody)]);
    expect(responses.every(r => r.code === 200)).toBe(true);
    expect(responses.filter(r => !r.body.result.replay)).toHaveLength(1);
    // Recover a simulated lost response through status, not a new run ID.
    const status = await call({ action: 'status', payload });
    expect(status.code).toBe(200); expect(status.body.result).toMatchObject({ verified: true, result: { washesCreated: 1 } });
    expect(status.body.result.verification[0].historicalIdentityResolutionVerified).toBe(true);
    expect((await call(saveBody)).body.result.replay).toBe(true);
    expect((await db.collection('washes').get()).size).toBe(1);
    for (const snapshot of before) expect((await snapshot.ref.get()).updateTime.isEqual(snapshot.updateTime)).toBe(true);
    expect((await db.doc(paths[0]).get()).data()).toMatchObject({ operationalWorkerId: null, reviewReasonCode: 'unverified_worker_link' });
    const wash = (await db.doc('washes/ssp__B-5643311').get()).data();
    expect(wash).toMatchObject({ biker_name: 'Mohammed Amit (2007)', quantity: 1, net_amount: 20, vat_amount: 3, gross_amount: 23,
      collection_status: 'pending', payment_method: null, worker_commission_per_wash: 4.5, worker_commission_paid: false,
      historical_identity_acceptance: { historicalWorkerLinkAsserted: false, employeeRename: false } });
    for (const c of ['journal_entries', 'transactions', 'payroll_runs', 'sweater_collections', 'sweater_owner_collection_confirmations']) expect((await db.collection(c).get()).empty).toBe(true);
  });
  it('different-run races cannot turn the same natural reservation into two washes or commissions', async () => {
    const a = historicalPayload(), b = { ...a, importRunId: 'synthetic-competing-5643311' };
    const [pa, pb] = await Promise.all([previewOperations(db, a), previewOperations(db, b)]);
    const replies = await Promise.allSettled([saveOperations(db, FieldValue, requestFrom(a, pa), 'synthetic'),
      saveOperations(db, FieldValue, requestFrom(b, pb), 'synthetic')]);
    expect(replies.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(replies.find(r => r.status === 'rejected').reason.code).toBe('failed-precondition');
    expect((await db.collection('washes').get()).size).toBe(1);
    expect(await operationsStatus(db, replies[0].status === 'fulfilled' ? a : b)).toMatchObject({ verified: true });
  });
  it.each([
    ['journal_entries/after-preview', { sourceId: 'C-5643311' }],
    ['sweater_booking_links/w__ssp__Z-5643311', { reason: 'synthetic protection' }],
    ['sweater_settlements/2026-10', { status: 'approved' }],
    ['payroll_runs/after-preview', { sourceId: 'ssp__B-5643311' }],
  ])('CAS rejects concurrent protected effects and commits no partial wash: %s', async (path, value) => {
    const payload = historicalPayload(), p = await previewOperations(db, payload);
    await db.doc(path).set(value);
    await expect(saveOperations(db, FieldValue, requestFrom(payload, p), 'synthetic')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db.collection('washes').get()).empty).toBe(true);
    expect((await db.doc(path).get()).data()).toEqual(value);
    expect((await db.doc(`sweater_import_runs/${payload.importRunId}`).get()).exists).toBe(false);
  });
  it('status catches historical evidence tampering after saving the new independent receipt', async () => {
    const payload = historicalPayload(), p = await previewOperations(db, payload);
    await saveOperations(db, FieldValue, requestFrom(payload, p), 'synthetic');
    await db.doc(paths[0]).set({ operationalWorkerId: 'synthetic-backdate' }, { merge: true });
    expect(await operationsStatus(db, payload)).toMatchObject({ verified: false, linksVerified: false });
  });
});
