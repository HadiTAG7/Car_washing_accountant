import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';
import { operationsHandler, operationsSigningHash } from '../src/sweater/operationsHttp.js';
import { createIntegrationKey, computeSignature } from '../src/sweater/integrationKeys.js';
import { previewOwnerHandoff, saveOwnerHandoff } from '../src/sweater/staffHandoff.js';

const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app, db, originalEncryption;
const payload = () => ({ contractVersion: 2, importRunId: 'synthetic-operations', agentStatus: 'ok', workerLinks: { 'worker-1': 'biker-1' },
  records: [{ sspBookingId: 'C-980001', serviceType: 'observed-service', bookingKind: 'individual', serviceDate: '2026-10-08', rawStatus: 'Collecting Payment', driverExternalId: 'worker-1', sourceUrl: 'https://ssp-portal.sweater.sa/' }],
  coverage: { rangeFrom: '2026-10-08', rangeTo: '2026-10-08', extractedAt: '2026-10-09T00:00:00+03:00', pageCount: 2, pagesFetched: 1, recordCount: 1,
    isComplete: false, sourceUrl: 'https://ssp-portal.sweater.sa/', modules: { individual: 'partial', corporate: 'unavailable' }, gaps: ['Missing page 2 and B2B'] } });
const req = (b, p) => ({ payload: b, reviewedPayloadHash: p.reviewedPayloadHash, previewStateHash: p.previewStateHash });
const save = async b => saveOperations(db, FieldValue, req(b, await previewOperations(db, b)), 'sweater-browser-agent');
suite('production operations sync in isolated demo Firestore', () => {
  beforeAll(() => {
    if (!String(process.env.GCLOUD_PROJECT || '').startsWith('demo-sweater')) throw new Error('Only isolated demo-sweater allowed');
    app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'operations-sync-emulator'); db = getFirestore(app);
    originalEncryption = process.env.SWEATER_KEY_ENCRYPTION_KEY; process.env.SWEATER_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
  beforeEach(async () => {
    const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Cannot clear isolated demo');
    await db.collection('bikers').doc('biker-1').set({ name: 'Synthetic worker', driver_external_id: 'worker-1', salary: 900 });
  });
  afterAll(async () => { if (originalEncryption == null) delete process.env.SWEATER_KEY_ENCRYPTION_KEY; else process.env.SWEATER_KEY_ENCRYPTION_KEY = originalEncryption;
    await db?.terminate(); if (app) await deleteApp(app); });
  it('writes no financial or wash collections, verifies all rows, preserves incomplete coverage and replays safely', async () => {
    const b = payload(); await save(b);
    expect(await operationsStatus(db, b)).toMatchObject({ verified: true, status: 'completed_with_gaps', result: { washesCreated: 0 } });
    expect((await save(b)).replay).toBe(true);
    expect((await save({ ...b, importRunId: 'different-run' })).counts.duplicate).toBe(1);
    expect((await db.collection('sweater_bookings').get()).size).toBe(1);
    const names = (await db.listCollections()).map(c => c.id);
    expect(names.every(n => n === 'bikers' || n.startsWith('sweater_'))).toBe(true);
    expect(names.some(n => ['washes', 'sweater_collections', 'sweater_booking_links', 'sweater_owner_collection_confirmations'].includes(n))).toBe(false);
  });
  it('same-run concurrent writes commit once, and numeric prefix races cannot create a second booking', async () => {
    const a = payload(), p = await previewOperations(db, a);
    const same = await Promise.all(Array.from({ length: 3 }, () => saveOperations(db, FieldValue, req(a, p), 'agent')));
    expect(same.filter(r => !r.replay)).toHaveLength(1);
    const b = { ...a, importRunId: 'alias-run', records: [{ ...a.records[0], sspBookingId: 'S-980001' }] };
    expect((await save(b)).rows[0]).toMatchObject({ outcome: 'needs_review', bookingSaved: false, rawSaved: true });
    expect((await db.collection('sweater_bookings').get()).size).toBe(1);
  });
  it('retains missing-service facts for review, verifies readback and replay, and later accepts evidenced service', async () => {
    const b = payload(); delete b.records[0].serviceType;
    const preview = await previewOperations(db, b);
    expect(preview.rows[0]).toMatchObject({ outcome: 'needs_review', reasonCode: 'unknown_service_type' });
    expect((await db.collection('sweater_raw_payloads').get()).empty).toBe(true);
    const result = await saveOperations(db, FieldValue, req(b, preview), 'agent');
    expect(result).toMatchObject({ rawSavedCount: 1, bookingSavedCount: 1, washesCreated: 0, ledgerPosted: false, payrollPaid: false });
    const booking = (await db.collection('sweater_bookings').doc('C-980001').get()).data();
    expect(booking).toMatchObject({ processingStatus: 'needs_review', reviewReasonCode: 'unknown_service_type', recognitionEligibility: null });
    expect(booking.record.serviceType).toBe('');
    expect(await operationsStatus(db, b)).toMatchObject({ verified: true });
    expect((await save(b)).replay).toBe(true);
    expect((await db.collection('sweater_raw_payloads').get()).size).toBe(1);
    const evidenced = structuredClone(b); evidenced.importRunId = 'evidenced-service'; evidenced.records[0].serviceType = 'observed-service';
    expect((await save(evidenced)).bookingSavedCount).toBe(1);
    const knownBefore = await db.collection('sweater_bookings').doc('C-980001').get();
    const gap = { ...b, importRunId: 'missing-again' };
    expect((await save(gap)).rows[0]).toMatchObject({ rawSaved: true, bookingSaved: false, reasonCode: 'unknown_service_type' });
    const knownAfter = await db.collection('sweater_bookings').doc('C-980001').get();
    expect(knownAfter.updateTime.isEqual(knownBefore.updateTime)).toBe(true);
    expect(await operationsStatus(db, gap)).toMatchObject({ verified: true });
    for (const col of ['washes', 'journal_entries', 'sweater_owner_collection_confirmations', 'sweater_collections']) {
      expect((await db.collection(col).get()).empty).toBe(true);
    }
  });
  it('competing new runs recheck preview state and do not overwrite an update', async () => {
    const a = payload(), b = { ...a, importRunId: 'concurrent-other', records: [{ ...a.records[0], rawStatus: 'Cancelled by Admin' }] };
    const [pa, pb] = await Promise.all([previewOperations(db, a), previewOperations(db, b)]);
    const results = await Promise.allSettled([saveOperations(db, FieldValue, req(a, pa), 'agent'), saveOperations(db, FieldValue, req(b, pb), 'agent')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.code).toBe('failed-precondition');
  });
  it('preserves posted, owner and manual financial links, never replacing their data', async () => {
    const b = payload();
    for (const col of ['washes', 'sweater_owner_collection_confirmations', 'sweater_booking_links']) {
      await db.collection(col).doc('legacy').set({ ssp_booking_id: 'S-980001', sspBookingId: 'S-980001', washId: 'legacy', postedEntryId: 'posted' });
    }
    const before = await db.collection('washes').doc('legacy').get();
    expect((await save(b)).rows[0]).toMatchObject({ outcome: 'needs_review', bookingSaved: false });
    expect((await db.collection('washes').doc('legacy').get()).updateTime.isEqual(before.updateTime)).toBe(true);
    expect((await db.collection('sweater_bookings').get()).empty).toBe(true);
  });
  it('rejects same records with changed coverage and detects missing raw after hypothetical lost response', async () => {
    const b = payload(); await save(b); const changed = structuredClone(b); changed.coverage.extractedAt = '2026-10-09T00:05:00+03:00';
    await expect(operationsStatus(db, changed)).rejects.toMatchObject({ code: 'already-exists' });
    expect((await operationsStatus(db, b)).verified).toBe(true);
    const raws = await db.collection('sweater_raw_payloads').get(); await raws.docs[0].ref.delete(); // demo only, deliberate corruption regression
    expect((await operationsStatus(db, b)).verified).toBe(false);
  });
  it('full-envelope HMAC protects metadata/actions and scopes, with no operational write on preview', async () => {
    const key = await createIntegrationKey(db, FieldValue, { label: 'Synthetic demo-only key' });
    const handler = operationsHandler({ getDb: () => db, FieldValue });
    const call = async (body, signed = body) => {
      const ts = String(Math.floor(Date.now() / 1000));
      const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
      await handler({ method: 'POST', body, headers: { 'x-sweater-key-id': key.keyId, 'x-sweater-timestamp': ts,
        'x-sweater-signature': computeSignature(key.secret, ts, signed.payload.importRunId, operationsSigningHash(signed)) } }, res); return res;
    };
    const b = { action: 'preview', payload: payload() }; const p = await call(b); expect(p.code).toBe(200);
    expect((await db.collection('sweater_import_runs').get()).empty).toBe(true);
    const altered = structuredClone(b); altered.payload.coverage.gaps = ['Changed metadata']; expect((await call(altered, b)).code).toBe(401);
    expect((await call({ ...b, action: 'status' }, b)).code).toBe(401);
    const saved = await call({ action: 'save', ...req(b.payload, p.body.result) }); expect(saved.code).toBe(200);
    const status = await call({ action: 'status', payload: b.payload }); expect(status.body.result.verified).toBe(true);
    expect((await db.collection('washes').get()).empty).toBe(true);
    await db.collection('sweater_integration_keys').doc(key.keyId).set({ scope: 'admin' }, { merge: true }); expect((await call(b)).code).toBe(403);
  });
  it('shared natural claim serializes raw sync against owner handoff while retaining owner behavior', async () => {
    const a = payload(), owner = { importRunId: 'synthetic-owner-race', records: [{ sspBookingId: 'S-980001', serviceDate: '2026-10-08', serviceType: 'observed-service', rawStatus: 'Collecting Payment', driverExternalId: 'worker-1' }],
      workerLinks: a.workerLinks, coverage: { rangeFrom: '2026-10-08', rangeTo: '2026-10-08', extractedAt: '2026-10-09T00:00:00+03:00', pageCount: 1, pagesFetched: 1, recordCount: 1, isComplete: true },
      ownerConfirmation: { source: 'owner_statement', ownerName: 'Synthetic owner', statement: 'Synthetic isolated owner assertion', unitAmount: 20, totalAmount: 20, vatAmount: null } };
    const [pa, po] = await Promise.all([previewOperations(db, a), previewOwnerHandoff(db, owner)]);
    const results = await Promise.allSettled([saveOperations(db, FieldValue, req(a, pa), 'agent'), saveOwnerHandoff(db, FieldValue, req(owner, po), 'staff')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.collection('sweater_bookings').get()).size).toBe(1);
    expect((await db.collection('washes').get()).size).toBeLessThanOrEqual(1);
    expect((await db.collection('journal_entries').get()).empty).toBe(true);
  });
});
