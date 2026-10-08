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
  it('tax split and numeric claims atomically prevent concurrent prefix variants on Firestore', async () => {
    const a=body();a.records=[{sspBookingId:'S-870001',driverExternalId:'worker-1',serviceDate:'2026-10-03',rawStatus:'CollectingPayment',rawPaymentStatus:'Pending'}];a.coverage.recordCount=1;
    a.ownerConfirmation={...a.ownerConfirmation,totalAmount:20,vatAmount:3,priceMode:'exclusive',grossAmount:23,totalVatAmount:3,totalGrossAmount:23};
    const b=structuredClone(a);b.importRunId='synthetic-emulator-other-prefix';b.records[0].sspBookingId='C-870001';
    const [pa,pb]=await Promise.all([previewOwnerHandoff(db,a),previewOwnerHandoff(db,b)]);
    const results=await Promise.allSettled([saveOwnerHandoff(db,FieldValue,request(a,pa),'emulator-staff'),saveOwnerHandoff(db,FieldValue,request(b,pb),'emulator-staff')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const washes=await db.collection('washes').get();expect(washes.size).toBe(1);
    expect(washes.docs[0].data()).toMatchObject({price:20,vat_amount:3,net_amount:20,gross_amount:23,worker_commission_paid:false});
    expect((await db.collection('sweater_owner_booking_claims').doc('870001').get()).exists).toBe(true);
    expect((await db.collection('journal_entries').get()).empty).toBe(true);
  });

  it.each([
    ['C-5589967', '1986', 'KehSV5K73zkyWWEE8hE9'],
    ['C-5595180', '1988', '5MMg7pj0wjYM06NLuzS7'],
  ])('previews the authorized October 8 booking %s on Firestore without creating any wash or financial record', async (id, driver, worker) => {
    const ref = db.collection('bikers').doc(worker);
    await ref.set({ name: 'Synthetic October worker', salary: 900 });
    const before = await ref.get();
    const payload = body(); payload.importRunId = `emulator-oct8-${id}`;
    payload.records = [{ sspBookingId: id, driverExternalId: driver, serviceDate: '2026-10-08', rawStatus: 'Cancelled by Admin' }];
    payload.workerLinks = { [driver]: worker };
    payload.coverage = { rangeFrom: '2026-10-08', rangeTo: '2026-10-08', extractedAt: '2026-10-08T20:24:47Z', pageCount: 1, pagesFetched: 1, recordCount: 1,
      isComplete: false, scope: 'singleBooking', scopeBookingId: id, scopeComplete: true, sourceRecordCount: 1, excludedCancelled: 0, imported: 1 };
    payload.ownerConfirmation = { ...payload.ownerConfirmation, totalAmount: 20, vatAmount: 3, priceMode: 'exclusive', grossAmount: 23, totalVatAmount: 3, totalGrossAmount: 23 };
    payload.ownerCompletionDecision = { source: 'owner_statement', ownerName: 'Synthetic owner', statement: 'Emulator-only owner completion decision',
      approved: true, decision: 'record_as_completed_wash', sspBookingId: id, bookingNumber: id.slice(2), driverExternalId: driver, serviceDate: '2026-10-08', rawStatus: 'Cancelled by Admin' };
    const preview = await previewOwnerHandoff(db, payload);
    expect(preview.canSave).toBe(true);
    expect(preview.rows[0]).toMatchObject({ sspBookingId: id, bikerId: worker, rawStatus: 'Cancelled by Admin', normalizedStatus: 'admin_cancelled' });
    expect((await ref.get()).updateTime.isEqual(before.updateTime)).toBe(true);
    expect((await db.listCollections()).map(c => c.id)).toEqual(['bikers']);
  });

  it('saves the explicit cancelled-booking decision once, retaining raw status and making no financial writes', async () => {
    await db.collection('bikers').doc('2N4FP4rQAxXQ7rpuBrla').set({ name: 'Emulator Ajith', salary: 900 });
    const payload = body(); payload.importRunId = 'emulator-owner-cancelled-5584720';
    payload.records = [{ sspBookingId: 'C-5584720', driverExternalId: '1984', serviceDate: '2026-10-06', rawStatus: 'Cancelled by Admin' }];
    payload.workerLinks = { '1984': '2N4FP4rQAxXQ7rpuBrla' };
    payload.coverage = { rangeFrom: '2026-10-06', rangeTo: '2026-10-06', extractedAt: '2026-10-06T12:00:00Z', pageCount: 1, pagesFetched: 1, recordCount: 1,
      isComplete: false, scope: 'singleBooking', scopeBookingId: 'C-5584720', scopeComplete: true, sourceRecordCount: 1, excludedCancelled: 0, imported: 1 };
    payload.ownerConfirmation = { ...payload.ownerConfirmation, totalAmount: 20, vatAmount: 3, priceMode: 'exclusive', grossAmount: 23, totalVatAmount: 3, totalGrossAmount: 23 };
    payload.ownerCompletionDecision = { source: 'owner_statement', ownerName: 'Synthetic owner', statement: 'Emulator-only explicit owner completion decision',
      approved: true, decision: 'record_as_completed_wash', sspBookingId: 'C-5584720', bookingNumber: '5584720', driverExternalId: '1984', serviceDate: '2026-10-06', rawStatus: 'Cancelled by Admin' };
    const p = await previewOwnerHandoff(db, payload);
    expect((await db.collection('washes').get()).empty).toBe(true);
    const results = await Promise.all([saveOwnerHandoff(db, FieldValue, request(payload, p), 'emulator-staff'), saveOwnerHandoff(db, FieldValue, request(payload, p), 'emulator-staff')]);
    expect(results.filter(r => !r.replay)).toHaveLength(1);
    const washes = await db.collection('washes').get(); expect(washes.size).toBe(1);
    expect(washes.docs[0].data()).toMatchObject({ status: 'مكتملة', ssp_raw_status: 'Cancelled by Admin', net_amount: 20, vat_amount: 3, gross_amount: 23, worker_commission_paid: false });
    expect((await db.collection('sweater_bookings').doc('C-5584720').get()).data()).toMatchObject({ record: { rawStatus: 'Cancelled by Admin', normalizedStatus: 'admin_cancelled' }, ownerCompletionDecision: payload.ownerCompletionDecision });
    expect((await db.collection('sweater_owner_booking_claims').doc('5584720').get()).data().sspBookingId).toBe('C-5584720');
    for (const name of ['journal_entries', 'bank_accounts', 'transactions', 'payroll', 'sweater_collections', 'sweater_booking_links']) expect((await db.collection(name).get()).empty).toBe(true);
  });

});
