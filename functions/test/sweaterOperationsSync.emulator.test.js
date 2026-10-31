import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';
import { operationsHandler, operationsSigningHash } from '../src/sweater/operationsHttp.js';
import { createIntegrationKey, computeSignature } from '../src/sweater/integrationKeys.js';
import { previewOwnerHandoff, saveOwnerHandoff } from '../src/sweater/staffHandoff.js';
import { calculatePayrollPreview } from '../src/payroll.js';
import * as legacyWriter from './helpers/legacyOperationsSync.js';

const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app, db, originalEncryption;
const payload = () => ({ contractVersion: 2, importRunId: 'synthetic-operations', agentStatus: 'ok', workerLinks: { 'worker-1': 'biker-1' },
  records: [{ sspBookingId: 'C-980001', serviceType: 'observed-service', bookingKind: 'individual', serviceDate: '2026-10-08', rawStatus: 'Collecting Payment', driverExternalId: 'worker-1', sourceUrl: 'https://ssp-portal.sweater.sa/' }],
  coverage: { rangeFrom: '2026-10-08', rangeTo: '2026-10-08', extractedAt: '2026-10-09T00:00:00+03:00', pageCount: 2, pagesFetched: 1, recordCount: 1,
    isComplete: false, sourceUrl: 'https://ssp-portal.sweater.sa/', modules: { individual: 'partial', corporate: 'unavailable' }, gaps: ['Missing page 2 and B2B'] } });
const req = (b, p) => ({ payload: b, reviewedPayloadHash: p.reviewedPayloadHash, previewStateHash: p.previewStateHash });
const save = async b => saveOperations(db, FieldValue, req(b, await previewOperations(db, b)), 'sweater-browser-agent');
// The 10 Oct B observation as the writer of that time filed it (a booking per prefixed id).
const legacySave = async b => legacyWriter.saveOperations(db, FieldValue, req(b, await legacyWriter.previewOperations(db, b)), 'sweater-browser-agent');
const identityPayload = (legacy = false) => {
  const b = payload(); b.importRunId = legacy ? 'ops-20261011-oct10-210648' : 'synthetic-isolated-5596423';
  Object.assign(b.coverage, { rangeFrom: '2026-10-10', rangeTo: '2026-10-10', extractedAt: '2026-10-11T05:43:10Z' });
  b.workerLinks = legacy ? {} : { '1986': 'KehSV5K73zkyWWEE8hE9' };
  b.records = [{ sspBookingId: legacy ? 'B-5596423' : 'S-5596423', bookingKind: 'individual', driverExternalId: '1986',
    serviceDate: '2026-10-10', rawStatus: legacy ? 'completed' : 'Collecting Payment', sourceUrl: 'https://ssp-portal.sweater.sa/bookings',
    ...(legacy ? {} : { serviceType: 'interior_exterior_wash', startedAt: '2026-10-10T22:42:00+03:00', completedAt: '2026-10-10T23:35:00+03:00' }) }];
  return b;
};
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
  it('atomically saves an unpaid execution once, increases commission once, and retains all financial stores', async () => {
    const b = payload(); Object.assign(b.records[0], { serviceType: 'interior_exterior_wash', rawPaymentStatus: 'Pending',
      startedAt: '2026-10-08T10:00:00+03:00', completedAt: '2026-10-08T10:30:00+03:00' });
    const protectedData = { 'journal_entries/synthetic': { status: 'posted', amount: 99 },
      'payroll_runs/synthetic': { status: 'paid', totals: { net: 99 } }, 'advances/synthetic': { amount: 99, recovered_amount: 10 },
      'sweater_collections/synthetic': { amount: 99 }, 'sweater_settlements/synthetic': { status: 'closed', amount: 99 } };
    // `advances` is no collection of the app's; on Postgres only known collections have tables.
    if (process.env.PGSTORE_TESTS) delete protectedData['advances/synthetic'];
    for (const [path, row] of Object.entries(protectedData)) await db.doc(path).set(row);
    const p = await previewOperations(db, b);
    expect((await db.collection('washes').get()).empty).toBe(true);
    const results = await Promise.all(Array.from({ length: 3 }, () => saveOperations(db, FieldValue, req(b, p), 'sweater-browser-agent')));
    expect(results.filter(r => !r.replay)).toHaveLength(1);
    expect(results[0].washesCreated).toBe(1);
    const alias = { ...b, importRunId: 'executed-alias', records: [{ ...b.records[0], sspBookingId: 'S-980001' }] };
    expect((await save(alias)).washesCreated).toBe(0);
    const ws = await db.collection('washes').get(); expect(ws.size).toBe(1);
    const wash = ws.docs[0].data(); expect(wash).toMatchObject({ status: 'مكتملة', quantity: 1, price: 20, vat_amount: 3,
      gross_amount: 23, collection_status: 'pending', payment_method: null, worker_commission_paid: false });
    const payroll = calculatePayrollPreview({ periodKey: '2026-10', now: new Date('2026-10-09T12:00:00Z'),
      bikers: [{ id: 'biker-1', name: 'Synthetic worker', salary: 900, start_date: '2026-10-01' }],
      washes: ws.docs.map(d => ({ id: d.id, ...d.data() })) });
    expect(payroll.totals.commissions).toBe(4.5);
    expect(await operationsStatus(db, b)).toMatchObject({ verified: true, rawVerified: true, linksVerified: true, result: { washesCreated: 1 } });
    for (const [path, row] of Object.entries(protectedData)) expect((await db.doc(path).get()).data()).toEqual(row);
    expect((await db.collection('sweater_owner_collection_confirmations').get()).empty).toBe(true);
  });
  it('concurrent distinct executed batches recheck the claim, and later cancellation does not reverse execution', async () => {
    const a = payload(); Object.assign(a.records[0], { serviceType: 'interior_exterior_wash',
      startedAt: '2026-10-08T10:00:00+03:00', completedAt: '2026-10-08T10:30:00+03:00' });
    const b = { ...a, importRunId: 'other-executed', records: [{ ...a.records[0], sspBookingId: 'S-980001' }] };
    const [pa, pb] = await Promise.all([previewOperations(db, a), previewOperations(db, b)]);
    const saves = await Promise.allSettled([saveOperations(db, FieldValue, req(a, pa), 'agent'), saveOperations(db, FieldValue, req(b, pb), 'agent')]);
    expect(saves.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const ws = await db.collection('washes').get(); expect(ws.size).toBe(1); const original = ws.docs[0].data();
    const cancelled = { ...a, importRunId: 'later-execution-cancel', records: [{ ...a.records[0], rawStatus: 'Cancelled by Admin' }] };
    expect((await save(cancelled)).washesCreated).toBe(0);
    expect((await ws.docs[0].ref.get()).data()).toEqual(original);
  });
  it('persists unpaid start/end observations with verified readback but does not create an execution register', async () => {
    const b = payload();
    Object.assign(b.records[0], { rawPaymentStatus: 'Pending',
      startedAt: '2026-10-08T10:00:00+03:00', completedAt: '2026-10-08T10:30:00+03:00' });
    const result = await save(b);
    expect(result).toMatchObject({ washesCreated: 0, ledgerPosted: false, payrollPaid: false });
    expect(await operationsStatus(db, b)).toMatchObject({ verified: true, rawVerified: true, linksVerified: true });
    const booking = (await db.collection('sweater_bookings').doc('980001').get()).data();
    expect(booking).toMatchObject({ processingStatus: 'needs_review', operationalWorkerId: 'biker-1',
      recognitionEligibility: null, serviceDate: '2026-10-08',
      record: { paymentStatus: 'pending', completedAt: '2026-10-08T10:30:00+03:00' } });
    for (const name of ['washes', 'journal_entries', 'payroll_runs', ...(process.env.PGSTORE_TESTS ? [] : ['advances']), 'sweater_collections', 'sweater_owner_collection_confirmations']) {
      expect((await db.collection(name).get()).empty).toBe(true);
    }
    expect((await save(b)).replay).toBe(true);
    expect((await db.collection('sweater_bookings').get()).size).toBe(1);
  });
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
    // One booking per number: the other prefix is the same booking's latest reading, never a second booking.
    expect((await save(b)).rows[0]).toMatchObject({ outcome: 'modified', bookingSaved: true, rawSaved: true });
    expect((await db.collection('sweater_bookings').get()).size).toBe(1);
    expect((await db.collection('sweater_bookings').doc('980001').get()).data()).toMatchObject({ sspBookingId: 'S-980001',
      aliases: ['C-980001', 'S-980001'] });
  });
  it('retains missing-service facts for review, verifies readback and replay, and later accepts evidenced service', async () => {
    const b = payload(); delete b.records[0].serviceType;
    const preview = await previewOperations(db, b);
    expect(preview.rows[0]).toMatchObject({ outcome: 'needs_review', reasonCode: 'unknown_service_type' });
    expect((await db.collection('sweater_raw_payloads').get()).empty).toBe(true);
    const result = await saveOperations(db, FieldValue, req(b, preview), 'agent');
    expect(result).toMatchObject({ rawSavedCount: 1, bookingSavedCount: 1, washesCreated: 0, ledgerPosted: false, payrollPaid: false });
    const booking = (await db.collection('sweater_bookings').doc('980001').get()).data();
    expect(booking).toMatchObject({ processingStatus: 'needs_review', reviewReasonCode: 'unknown_service_type', recognitionEligibility: null });
    expect(booking.record.serviceType).toBe('');
    expect(await operationsStatus(db, b)).toMatchObject({ verified: true });
    expect((await save(b)).replay).toBe(true);
    expect((await db.collection('sweater_raw_payloads').get()).size).toBe(1);
    const evidenced = structuredClone(b); evidenced.importRunId = 'evidenced-service'; evidenced.records[0].serviceType = 'observed-service';
    expect((await save(evidenced)).bookingSavedCount).toBe(1);
    const knownBefore = await db.collection('sweater_bookings').doc('980001').get();
    const gap = { ...b, importRunId: 'missing-again' };
    // The known service is kept, so the gap changes nothing and raises nothing.
    expect((await save(gap)).rows[0]).toMatchObject({ rawSaved: true, bookingSaved: false, outcome: 'duplicate', reasonCode: null });
    const knownAfter = await db.collection('sweater_bookings').doc('980001').get();
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
    const raws = await db.collection('sweater_raw_payloads').get(), missingId = raws.docs[0].id;
    // Simulate a missing read without deleting append-protected evidence.
    // The production PG role correctly has no DELETE grant on raw payloads.
    const missingRawView = { collection: name => name !== 'sweater_raw_payloads' ? db.collection(name) : {
      doc: id => ({ get: () => id === missingId ? Promise.resolve({ exists: false }) : db.collection(name).doc(id).get() }),
    } };
    expect((await operationsStatus(missingRawView, b)).verified).toBe(false);
    expect((await operationsStatus(db, b)).verified).toBe(true);
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
    const b = { action: 'preview', payload: payload() };
    Object.assign(b.payload.records[0], { serviceType: 'interior_exterior_wash', rawPaymentStatus: 'Pending',
      startedAt: '2026-10-08T10:00:00+03:00', completedAt: '2026-10-08T10:30:00+03:00' });
    const p = await call(b); expect(p.code).toBe(200);
    expect((await db.collection('sweater_import_runs').get()).empty).toBe(true);
    const altered = structuredClone(b); altered.payload.coverage.gaps = ['Changed metadata']; expect((await call(altered, b)).code).toBe(401);
    expect((await call({ ...b, action: 'status' }, b)).code).toBe(401);
    const saved = await call({ action: 'save', ...req(b.payload, p.body.result) }); expect(saved.code).toBe(200);
    const status = await call({ action: 'status', payload: b.payload });
    expect(status.body.result).toMatchObject({ verified: true, result: { washesCreated: 1, ledgerPosted: false, payrollPaid: false } });
    const executions = await db.collection('washes').get(); expect(executions.size).toBe(1);
    expect(executions.docs[0].data()).toMatchObject({ price: 20, gross_amount: 23, vat_amount: 3,
      collection_status: 'pending', worker_commission_per_wash: 4.5, worker_commission_paid: false });
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
  it('signed approved5596423 decision is read-only; atomic completion preserves B/raw/claim and all24other washes', async () => {
    await db.collection('bikers').doc('KehSV5K73zkyWWEE8hE9').set({ name: 'Synthetic isolated worker', driver_external_id: '1986', salary: 900 });
    const legacy = identityPayload(true); await legacySave(legacy);
    for (let i = 0; i < 24; i++) await db.collection('washes').doc(`synthetic-other-${i}`).set({ ssp_booking_id: `S-${880000 + i}`, price: 20 });
    const originals = await Promise.all(['sweater_bookings/B-5596423', 'sweater_owner_booking_claims/5596423',
      'sweater_raw_payloads/ops-20261011-oct10-210648__B-5596423', ...Array.from({ length: 24 }, (_, i) => `washes/synthetic-other-${i}`)].map(path => db.doc(path).get()));
    const key = await createIntegrationKey(db, FieldValue, { label: 'Synthetic identity-only demo key' });
    const handler = operationsHandler({ getDb: () => db, FieldValue });
    const call = async (body, signatureBody = body) => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ method: 'POST', body, headers: { 'x-sweater-key-id': key.keyId, 'x-sweater-timestamp': timestamp,
        'x-sweater-signature': computeSignature(key.secret, timestamp, signatureBody.payload.importRunId, operationsSigningHash(signatureBody)) } }, res);
      return res;
    };
    const p = identityPayload(), preview = await call({ action: 'preview', payload: p }); expect(preview.code).toBe(200);
    expect(preview.body.result.rows[0]).toMatchObject({ washCreated: false, identityResolution: { eligible: true, resolutionSaved: false } });
    expect((await db.collection('washes').get()).size).toBe(24);
    const altered = structuredClone(p); altered.records[0].completedAt = '2026-10-10T23:36:00+03:00';
    expect((await call({ action: 'preview', payload: altered }, { action: 'preview', payload: p })).code).toBe(401);
    const body = { action: 'save', ...req(p, preview.body.result) };
    const responses = await Promise.all([call(body), call(body)]);
    expect(responses.every(r => r.code === 200)).toBe(true);
    expect(responses.filter(r => !r.body.result.replay)).toHaveLength(1);
    const status = await call({ action: 'status', payload: p });
    expect(status.body.result).toMatchObject({ verified: true, result: { washesCreated: 1 } });
    expect(status.body.result.verification[0]).toMatchObject({ identityResolutionSaved: true, identityResolutionVerified: true });
    expect((await db.collection('washes').get()).size).toBe(25);
    expect((await db.doc('washes/ssp__B-5596423').get()).data()).toMatchObject({ ssp_booking_id: 'S-5596423',
      price: 20, vat_amount: 3, gross_amount: 23, collection_status: 'pending', worker_commission_per_wash: 4.5, worker_commission_paid: false });
    for (const original of originals) expect((await original.ref.get()).updateTime.isEqual(original.updateTime)).toBe(true);
    const writesAfterResponseLoss = await call(body); expect(writesAfterResponseLoss.body.result.replay).toBe(true);
    expect((await db.collection('journal_entries').get()).empty).toBe(true);
    expect((await db.collection('sweater_owner_collection_confirmations').get()).empty).toBe(true);
  });
  it('a non-ingest principal cannot save5596423; no fallback or second wash is attempted', async () => {
    await db.doc('bikers/KehSV5K73zkyWWEE8hE9').set({ name: 'Synthetic worker', driver_external_id: '1986' }); await legacySave(identityPayload(true));
    const key = await createIntegrationKey(db, FieldValue, { label: 'Synthetic unauthorized key' });
    await db.doc(`sweater_integration_keys/${key.keyId}`).set({ scope: 'admin' }, { merge: true });
    const p = identityPayload(), body = { action: 'save', ...req(p, await previewOperations(db, p)) }, timestamp = String(Math.floor(Date.now() / 1000));
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await operationsHandler({ getDb: () => db, FieldValue })({ method: 'POST', body, headers: {
      'x-sweater-key-id': key.keyId, 'x-sweater-timestamp': timestamp, 'x-sweater-signature': computeSignature(key.secret, timestamp, p.importRunId, operationsSigningHash(body)),
    } }, res);
    expect(res.code).toBe(403); expect((await db.collection('washes').get()).empty).toBe(true);
    expect((await db.doc('sweater_bookings/S-5596423').get()).exists).toBe(false);
  });
  it('a financial effect introduced after preview invalidates CAS and leaves every document unchanged', async () => {
    await db.doc('bikers/KehSV5K73zkyWWEE8hE9').set({ name: 'Synthetic worker', driver_external_id: '1986' }); await legacySave(identityPayload(true));
    const p = identityPayload(), preview = await previewOperations(db, p);
    await db.doc('journal_entries/synthetic-protected').set({ sourceId: 'ssp__B-5596423', status: 'posted' });
    const original = await db.doc('sweater_bookings/B-5596423').get();
    await expect(saveOperations(db, FieldValue, req(p, preview), 'sweater-browser-agent')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await original.ref.get()).updateTime.isEqual(original.updateTime)).toBe(true);
    expect((await db.collection('washes').get()).empty).toBe(true);
    expect((await db.doc('sweater_import_runs/synthetic-isolated-5596423').get()).exists).toBe(false);
  });
  it.each([
    ['washes/manual-protected', { ssp_booking_id: 'C-5596423', quantity: 1, status: 'مكتملة', postedEntryId: 'synthetic-entry' }],
    ['sweater_owner_collection_confirmations/manual-protected', { evidence: { sspBookingId: 'OTHER-5596423' } }],
    ['journal_entries/manual-protected', { sourceId: 'ssp__C-5596423', status: 'posted', amount: 999 }],
  ])('all-prefix protection at %s is fail-closed before and after CAS without touching its data', async (path, protectedRecord) => {
    await db.doc('bikers/KehSV5K73zkyWWEE8hE9').set({ name: 'Synthetic worker', driver_external_id: '1986' });
    await legacySave(identityPayload(true)); const p = identityPayload(), before = await previewOperations(db, p);
    expect(before.rows[0].identityResolution.eligible).toBe(true);
    await db.doc(path).set(protectedRecord); const original = await db.doc(path).get();
    await expect(saveOperations(db, FieldValue, req(p, before), 'sweater-browser-agent')).rejects.toMatchObject({ code: 'failed-precondition' });
    const fresh = await previewOperations(db, p);
    // Held by the assertion, or waiting for the identity cleanup while the B copy is filed apart: never a wash.
    expect(fresh.rows[0]).toMatchObject({ outcome: 'needs_review', washCreated: false, identityResolution: { eligible: false } });
    expect(['protected_existing_record', 'awaiting_identity_cleanup']).toContain(fresh.rows[0].reasonCode);
    const result = await saveOperations(db, FieldValue, req(p, fresh), 'sweater-browser-agent');
    expect(result.washesCreated).toBe(0);
    expect((await db.doc('washes/ssp__B-5596423').get()).exists).toBe(false);
    expect((await original.ref.get()).data()).toEqual(protectedRecord);
    expect((await original.ref.get()).updateTime.isEqual(original.updateTime)).toBe(true);
  });
  it('a Firestore document-reference financial pointer to an orphaned other-prefix wash is protected', async () => {
    await db.doc('bikers/KehSV5K73zkyWWEE8hE9').set({ name: 'Synthetic worker', driver_external_id: '1986' });
    await legacySave(identityPayload(true)); const p = identityPayload();
    await db.doc('transactions/synthetic-reference').set({ sourceRef: db.doc('washes/ssp__PREFIX-5596423'), amount: 999 });
    const original = await db.doc('transactions/synthetic-reference').get();
    expect((await previewOperations(db, p)).rows[0].identityResolution).toMatchObject({ eligible: false, checks: { noReferencedFinancialEffect: false } });
    expect((await save(p)).washesCreated).toBe(0);
    expect((await original.ref.get()).updateTime.isEqual(original.updateTime)).toBe(true);
    expect((await db.doc('washes/ssp__B-5596423').get()).exists).toBe(false);
  });
});
