import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { operationsHandler, operationsSigningHash } from '../src/sweater/operationsHttp.js';
import { createIntegrationKey, computeSignature } from '../src/sweater/integrationKeys.js';
import { saveMetricsSnapshot } from '../src/sweater/metricsSnapshot.js';
import { hashBody } from '../src/sweater/record.js';

const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app, db, originalEncryption;
const COL = 'sweater_metric_snapshots';
// October's dashboards as Hadi read them: Business Dashboard 480 and net tips 68; Compensations.
const reading = (extra = {}) => ({ contractVersion: 'sweater-metrics-v1', importRunId: 'metrics-2026-10-23-0800', periodKey: '2026-10',
  extractedAt: '2026-10-23T08:00:00+03:00', sourceUrl: 'https://ssp-portal.sweater.sa/dashboard/business',
  metrics: { completedWashes: 480, tipsNet: 68, violations: 530, damages: 0, compensations: 0, freeWashCompensation: 8,
    cancelledByCustomer: 10, cancelledByBiker: 13, cancelledMaintenance: 4 }, ...extra });
const NOW = Date.parse('2026-10-23T06:00:00Z');

suite('Sweater metrics readings in an isolated demo store', () => {
  beforeAll(() => {
    if (!String(process.env.GCLOUD_PROJECT || '').startsWith('demo-sweater')) throw new Error('Only isolated demo-sweater allowed');
    app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'metrics-snapshot-emulator'); db = getFirestore(app);
    originalEncryption = process.env.SWEATER_KEY_ENCRYPTION_KEY; process.env.SWEATER_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
  beforeEach(async () => {
    const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Cannot clear isolated demo');
  });
  afterAll(async () => { if (originalEncryption == null) delete process.env.SWEATER_KEY_ENCRYPTION_KEY; else process.env.SWEATER_KEY_ENCRYPTION_KEY = originalEncryption;
    await db?.terminate(); if (app) await deleteApp(app); });

  it('stores a reading once; the same body again reads back, a different body under the same id is refused', async () => {
    const first = await saveMetricsSnapshot(db, FieldValue, reading(), { keyId: 'sk_test', nowMs: NOW });
    expect(first).toEqual({ snapshotId: 'metrics-2026-10-23-0800', periodKey: '2026-10', extractedAtIso: '2026-10-23T05:00:00.000Z',
      payloadHash: hashBody(reading()), stored: true });
    const row = (await db.collection(COL).doc('metrics-2026-10-23-0800').get()).data();
    expect(row).toMatchObject({ periodKey: '2026-10', extractedAtIso: '2026-10-23T05:00:00.000Z', keyId: 'sk_test',
      sourceUrl: 'https://ssp-portal.sweater.sa/dashboard/business', metrics: reading().metrics, payloadHash: first.payloadHash });
    expect(await saveMetricsSnapshot(db, FieldValue, reading(), { keyId: 'sk_test', nowMs: NOW })).toMatchObject({ stored: false, payloadHash: first.payloadHash });
    const changed = reading(); changed.metrics.completedWashes = 481;
    await expect(saveMetricsSnapshot(db, FieldValue, changed, { keyId: 'sk_test', nowMs: NOW })).rejects.toMatchObject({ code: 'already-exists' });
    expect((await db.collection(COL).doc('metrics-2026-10-23-0800').get()).data().metrics.completedWashes).toBe(480);
  });

  it('refuses a reading from the future, and keeps each later reading as its own row', async () => {
    await expect(saveMetricsSnapshot(db, FieldValue, reading({ importRunId: 'future', extractedAt: '2026-10-23T09:10:00+03:00' }), { keyId: 'k', nowMs: NOW }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await saveMetricsSnapshot(db, FieldValue, reading(), { keyId: 'k', nowMs: NOW });
    const later = reading({ importRunId: 'metrics-2026-10-23-0900', extractedAt: '2026-10-23T09:00:00+03:00', metrics: { completedWashes: 495 } });
    await saveMetricsSnapshot(db, FieldValue, later, { keyId: 'k', nowMs: NOW + 3_600_000 });
    const rows = await db.collection(COL).where('periodKey', '==', '2026-10').orderBy('extractedAtIso', 'desc').get();
    expect(rows.docs.map(d => d.id)).toEqual(['metrics-2026-10-23-0900', 'metrics-2026-10-23-0800']);
  });

  it('persists source-precision biker attribution and refuses changing it on replay', async () => {
    const payload = reading({ metrics: { tipsNet: 73.13 }, tipsByBiker: [{ driverExternalId: '1984', netAmount: 73.125 }] });
    expect(await saveMetricsSnapshot(db, FieldValue, payload, { keyId: 'k', nowMs: NOW })).toMatchObject({ stored: true });
    expect((await db.collection(COL).doc(payload.importRunId).get()).data().tipsByBiker).toEqual(payload.tipsByBiker);
    expect(await saveMetricsSnapshot(db, FieldValue, payload, { keyId: 'k', nowMs: NOW })).toMatchObject({ stored: false });
    await expect(saveMetricsSnapshot(db, FieldValue, { ...payload, tipsByBiker: [{ driverExternalId: '1989', netAmount: 73.125 }] }, { keyId: 'k', nowMs: NOW })).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('persists itemized monetary deductions immutably without changing another reading or any financial record', async () => {
    await saveMetricsSnapshot(db, FieldValue, reading(), { keyId: 'k', nowMs: NOW });
    const old = (await db.collection(COL).doc(reading().importRunId).get()).data();
    const payload = reading({ importRunId: 'details-only', metrics: { violations: 150 }, deductionDetails: [
      { metricKey: 'violations', sourceId: 'case-a', driverExternalId: 'TEST-A', date: '2026-10-20', amount: 150,
        category: 'Test reason', sourceUrl: 'https://ssp-portal.sweater.sa/violations/case-a', bookingId: null },
    ] });
    const first = await saveMetricsSnapshot(db, FieldValue, payload, { keyId: 'k', nowMs: NOW });
    expect(first).toMatchObject({ stored: true, payloadHash: hashBody(payload) });
    expect((await db.collection(COL).doc(payload.importRunId).get()).data().deductionDetails).toEqual(payload.deductionDetails);
    expect(await saveMetricsSnapshot(db, FieldValue, payload, { keyId: 'k', nowMs: NOW })).toMatchObject({ stored: false });
    const changed = structuredClone(payload); changed.deductionDetails[0].driverExternalId = 'TEST-B';
    await expect(saveMetricsSnapshot(db, FieldValue, changed, { keyId: 'k', nowMs: NOW })).rejects.toMatchObject({ code: 'already-exists' });
    expect((await db.collection(COL).doc(reading().importRunId).get()).data()).toEqual(old);
    for (const col of ['journal_entries', 'washes', 'sweater_adjustments', 'payroll_runs']) expect((await db.collection(col).get()).size).toBe(0);
  });

  it('arrives through the operations endpoint only under the agent key and the full-request signature', async () => {
    const key = await createIntegrationKey(db, FieldValue, { label: 'Synthetic demo-only key' });
    const handler = operationsHandler({ getDb: () => db, FieldValue });
    const call = async (body, signed = body) => {
      const ts = String(Math.floor(Date.now() / 1000));
      const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
      await handler({ method: 'POST', body, headers: { 'x-sweater-key-id': key.keyId, 'x-sweater-timestamp': ts,
        'x-sweater-signature': computeSignature(key.secret, ts, signed.payload.importRunId, operationsSigningHash(signed)) } }, res); return res;
    };
    const body = { action: 'metrics', payload: reading({ extractedAt: new Date(Date.now() - 60_000).toISOString() }) };
    const ok = await call(body);
    expect(ok.code).toBe(200); expect(ok.body.result).toMatchObject({ snapshotId: body.payload.importRunId, stored: true, payloadHash: hashBody(body.payload) });
    // The signature binds every number; a reading is not an operations batch.
    const altered = structuredClone(body); altered.payload.metrics.completedWashes = 1;
    expect((await call(altered, body)).code).toBe(401);
    expect((await call({ action: 'preview', payload: body.payload })).code).toBe(400);
    expect((await call({ action: 'metrics', payload: { ...body.payload, importRunId: 'unknown-metric', metrics: { tips: 5 } } })).code).toBe(400);
    expect((await db.collection(COL).get()).size).toBe(1);
    await db.collection('sweater_integration_keys').doc(key.keyId).set({ principal: 'another-agent' }, { merge: true });
    expect((await call({ ...body, payload: { ...body.payload, importRunId: 'other-principal' } })).code).toBe(403);
    expect((await db.collection(COL).get()).size).toBe(1);
  });
});
