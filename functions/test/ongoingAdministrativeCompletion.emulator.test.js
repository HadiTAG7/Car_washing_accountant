import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { ongoingCompletionFixture } from './administrativeCompletionFixture.js';
import { previewAdministrativeCompletion, saveAdministrativeCompletion } from '../src/sweater/administrativeCompletion.js';
import { previewOperations, saveOperations } from '../src/sweater/operationsSync.js';
import { hashRecord, normalizeRecord } from '../src/sweater/record.js';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw Error('Loopback demo emulator required');
const suite = host ? describe : describe.skip;
const names = ['users','app_admins','bikers','washes','sweater_bookings','sweater_owner_booking_claims','sweater_owner_collection_confirmations',
  'sweater_operational_wash_links','sweater_booking_links','sweater_raw_payloads','sweater_import_runs','sweater_integration_state',
  'sweater_settlements','accounting_periods','audit_logs','journal_entries','payroll_runs'];
let app, db;
suite('ongoing administrative completion — isolated real transactions', () => {
  beforeAll(() => { app = initializeApp({ projectId: 'demo-sweater' }, 'ongoing-administrative-completion'); db = getFirestore(app); });
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => {
    for (const name of names) for (const doc of (await db.collection(name).get()).docs) await doc.ref.delete();
    const p = ongoingCompletionFixture(), r = normalizeRecord(p.records[0]);
    await db.collection('users').doc('admin').set({ role: 'admin' });
    await db.collection('bikers').doc('worker1').set({ name: 'Isolated worker', driver_external_id: '1982', start_date: '2026-10-01' });
    await db.collection('sweater_bookings').doc(r.sspBookingId).set({ sspBookingId: r.sspBookingId, source: 'operations_sync_v2', record: r,
      sourceHash: hashRecord(r), operationalWorkerId: 'worker1', processingStatus: 'needs_review', reviewReasonCode: 'execution_not_final' });
    await db.collection('sweater_owner_booking_claims').doc('880001').set({ bookingNumber: '880001', sspBookingId: r.sspBookingId,
      washId: `ssp__${r.sspBookingId}`, source: 'operations_sync_v2' });
  }, 60000);
  async function previewSave(p = ongoingCompletionFixture()) {
    const r = await previewAdministrativeCompletion(db, p, 'admin');
    return saveAdministrativeCompletion(db, FieldValue, { payload: p, reviewedPayloadHash: r.reviewedPayloadHash, previewStateHash: r.previewStateHash }, 'admin');
  }
  it('saves once atomically and preserves actual source, original claim and unpaid commission on concurrent replay', async () => {
    const p = ongoingCompletionFixture(), before = (await db.collection('sweater_bookings').doc('B-880001').get()).data();
    const claim = (await db.collection('sweater_owner_booking_claims').doc('880001').get()).data();
    const r = await previewAdministrativeCompletion(db, p, 'admin'), request = { payload: p, reviewedPayloadHash: r.reviewedPayloadHash, previewStateHash: r.previewStateHash };
    const saved = await Promise.all([saveAdministrativeCompletion(db, FieldValue, request, 'admin'), saveAdministrativeCompletion(db, FieldValue, request, 'admin')]);
    expect(saved.some(s => s.replay)).toBe(true);
    const washes = (await db.collection('washes').get()).docs.map(d => ({ id: d.id, ...d.data() }));
    expect(washes).toHaveLength(1); expect(washes[0]).toMatchObject({ id: 'ssp__B-880001', quantity: 1, status: 'مكتملة',
      worker_commission_per_wash: 4.5, worker_commission_paid: false, payment_method: null, collection_status: 'pending',
      completion_basis: 'owner_administrative_decision', ssp_raw_status: 'Washing Started' });
    const after = (await db.collection('sweater_bookings').doc('B-880001').get()).data();
    expect(after.record).toEqual(before.record); expect(after.record.completedAt).toBeNull(); expect(after.sourceHash).toBe(before.sourceHash);
    expect((await db.collection('sweater_owner_booking_claims').doc('880001').get()).data()).toEqual(claim);
    const second = await previewSave({ ...p, importRunId: 'synthetic-another-ongoing-run' }); expect(second.washesCreated).toBe(0);
    for (const name of ['journal_entries','payroll_runs','sweater_owner_collection_confirmations']) expect((await db.collection(name).get()).empty).toBe(true);
  });
  it.each(['B','S'])('a later genuine completion with prefix %s cannot create a second wash or entitlement', async prefix => {
    const p = ongoingCompletionFixture(); await previewSave(p);
    const before = (await db.collection('washes').doc('ssp__B-880001').get()).data();
    const payload = { contractVersion: 2, importRunId: `synthetic-later-completion-${prefix}`, agentStatus: 'partial', workerLinks: p.workerLinks,
      coverage: { rangeFrom: p.decision.serviceDate, rangeTo: p.decision.serviceDate, extractedAt: '2026-10-26T23:14:00+03:00',
        pageCount: 1, pagesFetched: 1, recordCount: 1, isComplete: false, sourceUrl: p.coverage.sourceUrl,
        modules: { individual: 'partial', corporate: 'unavailable' }, gaps: ['Synthetic bounded observation'] },
      records: [{ ...p.records[0], sspBookingId: `${prefix}-880001`, rawStatus: 'Collecting Payment', completedAt: '2026-10-26T23:06:00+03:00' }] };
    const r = await previewOperations(db, payload), saved = await saveOperations(db, FieldValue, { payload, reviewedPayloadHash: r.reviewedPayloadHash, previewStateHash: r.previewStateHash }, 'admin');
    expect(saved.washesCreated).toBe(0); expect((await db.collection('washes').get()).size).toBe(1);
    expect((await db.collection('washes').doc('ssp__B-880001').get()).data()).toEqual(before);
    expect((await db.collection('sweater_owner_booking_claims').doc('880001').get()).data().washId).toBe('ssp__B-880001');
    const raw = (await db.collection('sweater_raw_payloads').get()).docs.map(d => d.data());
    expect(raw.some(r => r.rawPayload.rawStatus === 'Collecting Payment' && r.rawPayload.completedAt === payload.records[0].completedAt)).toBe(true);
  });
  it.each(['start','worker','role','period','kind'])('rechecks %s inside the save transaction after preview', async kind => {
    const p = ongoingCompletionFixture(), r = await previewAdministrativeCompletion(db, p, 'admin');
    if (kind === 'start') await db.collection('sweater_bookings').doc('B-880001').update({ 'record.startedAt': '2026-10-26T21:14:00+03:00' });
    if (kind === 'worker') await db.collection('bikers').doc('worker1').update({ end_date: '2026-10-25' });
    if (kind === 'role') await db.collection('users').doc('admin').update({ role: 'operator' });
    if (kind === 'period') await db.collection('accounting_periods').doc('2026-10').set({ status: 'closed' });
    if (kind === 'kind') await db.collection('sweater_bookings').doc('B-880001').update({ 'record.bookingKind': 'corporate' });
    await expect(saveAdministrativeCompletion(db, FieldValue, { payload: p, reviewedPayloadHash: r.reviewedPayloadHash, previewStateHash: r.previewStateHash }, 'admin')).rejects.toThrow();
    expect((await db.collection('washes').get()).empty).toBe(true);
  });
});
