import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { previewOwnerHandoff, saveOwnerHandoff } from '../src/sweater/staffHandoff.js';

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const suite = enabled ? describe : describe.skip;
let app; let db;
const body = () => ({ importRunId: 'synthetic-atomic-ssp',
  records: Array.from({ length: 7 }, (_, i) => ({ sspBookingId: `EMULATOR-${i}`, driverExternalId: 'worker-1',
    serviceDate: '2026-10-03', serviceType: 'interior_exterior_wash', rawStatus: 'Collecting Payment' })),
  coverage: { rangeFrom: '2026-10-03', rangeTo: '2026-10-03', extractedAt: '2026-10-04T12:00:00Z', pageCount: 1, pagesFetched: 1, recordCount: 7, isComplete: true },
  workerLinks: { 'worker-1': 'biker-1' },
  ownerConfirmation: { source: 'owner_statement', ownerName: 'Synthetic owner', statement: 'Emulator-only collection confirmation', unitAmount: 20, totalAmount: 140, vatAmount: null } });
const request = (payload, preview) => ({ payload, reviewedPayloadHash: preview.reviewedPayloadHash, previewStateHash: preview.previewStateHash });

suite('SSP atomic save on isolated Firestore emulator', () => {
  beforeAll(() => {
    if (!String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw new Error('An isolated demo project is required.');
    app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'ssp-owner-handoff-emulator');
    db = getFirestore(app);
  });
  beforeEach(async () => {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Cannot clear isolated emulator.');
    await db.collection('bikers').doc('biker-1').set({ name: 'Emulator worker', salary: 900 });
  });
  afterAll(async () => { await db?.terminate(); if (app) await deleteApp(app); });
  it('concurrent same-run submissions save once and create no accounting/payroll records', async () => {
    const payload = body(); const preview = await previewOwnerHandoff(db, payload);
    expect((await db.collection('washes').get()).size).toBe(0);
    const results = await Promise.all(Array.from({ length: 3 }, () => saveOwnerHandoff(db, FieldValue, request(payload, preview), 'emulator-staff')));
    expect(results.filter(result => !result.replay)).toHaveLength(1);
    expect((await db.collection('washes').get()).size).toBe(7);
    expect((await db.collection('sweater_bookings').get()).size).toBe(7);
    expect((await db.collection('sweater_owner_collection_confirmations').get()).size).toBe(7);
    expect((await db.collection('sweater_operational_wash_links').get()).size).toBe(14);
    const names = (await db.listCollections()).map(collection => collection.id).sort();
    expect(names.every(name => name === 'bikers' || name === 'washes' || name.startsWith('sweater_'))).toBe(true);
    expect(names).not.toContain('sweater_collections'); expect(names).not.toContain('sweater_booking_links');
  });
  it('different run IDs racing for the same bookings require a fresh preview and never duplicate', async () => {
    const a = body(); const b = { ...a, importRunId: 'different-run' };
    const [pa, pb] = await Promise.all([previewOwnerHandoff(db, a), previewOwnerHandoff(db, b)]);
    const outcomes = await Promise.allSettled([saveOwnerHandoff(db, FieldValue, request(a, pa), 'emulator-staff'), saveOwnerHandoff(db, FieldValue, request(b, pb), 'emulator-staff')]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(result => result.status === 'rejected').reason.code).toBe('failed-precondition');
    const retry = outcomes[0].status === 'rejected' ? a : b;
    const refreshed = await previewOwnerHandoff(db, retry);
    expect((await saveOwnerHandoff(db, FieldValue, request(retry, refreshed), 'emulator-staff')).counts.duplicate).toBe(7);
    expect((await db.collection('washes').get()).size).toBe(7);
  });
  it('a stale worker mapping or missing worker writes no part of a batch', async () => {
    const payload = body(); const preview = await previewOwnerHandoff(db, payload);
    await db.collection('bikers').doc('biker-1').delete();
    await expect(saveOwnerHandoff(db, FieldValue, request(payload, preview), 'emulator-staff')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db.collection('washes').get()).size).toBe(0);
    expect((await db.collection('sweater_import_runs').get()).size).toBe(0);
  });
});
