import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { previewBikerDeduction, saveBikerDeduction, readBikerDeduction } from '../src/bikerDeductions.js';
import { deductionSeed, protectedDeductionSeed, deductionInput, actor } from './bikerDeductionFixture.js';
import { dispatch } from '../src/handlers.js';
import { hashRecord } from '../src/sweater/record.js';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):19080$/.test(host)) throw Error('Isolated local demo endpoint required');
const suite = host ? describe : describe.skip;
let app, db;
const names = ['users', 'app_admins', 'bikers', 'quality_objections', 'audit_logs', 'sweater_metric_snapshots', 'sweater_raw_payloads',
  'sweater_bookings', 'sweater_import_runs', 'accounting_periods', 'sweater_settlements', 'payroll_periods', 'payroll_runs', 'journal_entries', 'washes', 'sweater_adjustments',
  'sweater_owner_booking_claims', 'sweater_operational_wash_links'];
suite('biker deduction isolated transactional behavior', () => {
  beforeAll(() => { app = initializeApp({ projectId: 'demo-sweater' }, 'biker-deduction-isolated'); db = getFirestore(app); });
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => {
    for (const name of names) for (const doc of (await db.collection(name).get()).docs) await doc.ref.delete();
    for (const [path, value] of Object.entries(deductionSeed())) await db.doc(path).set(value);
  }, 60000);
  async function request(input = deductionInput(), requestId = 'isolated-request') {
    const p = await previewBikerDeduction(db, input, actor);
    return { payload: input, reviewedPayloadHash: p.reviewedPayloadHash, previewStateHash: p.previewStateHash, requestId };
  }
  it('commits one event under concurrent equal requests and independently reads the result', async () => {
    const input = await request();
    const outcomes = await Promise.all([saveBikerDeduction(db, FieldValue, input, actor), saveBikerDeduction(db, FieldValue, input, actor)]);
    expect(outcomes.filter(r => r.saved)).toHaveLength(1); expect(outcomes.filter(r => r.replay)).toHaveLength(1);
    const records = await db.collection('quality_objections').get(); expect(records.size).toBe(1);
    expect((await readBikerDeduction(db, { id: outcomes[0].id }, actor)).record.history).toHaveLength(1);
    expect((await db.collection('audit_logs').get()).size).toBe(1);
    expect((await db.doc('washes/unchanged').get()).data()).toEqual(deductionSeed()['washes/unchanged']);
    expect((await db.doc('sweater_adjustments/unchanged').get()).data()).toEqual(deductionSeed()['sweater_adjustments/unchanged']);
    expect((await db.collection('payroll_runs').get()).size).toBe(0); expect((await db.collection('journal_entries').get()).size).toBe(1);
  }, 120000);
  it('concurrent different corrections cannot overwrite one another; original is preserved', async () => {
    const first = await saveBikerDeduction(db, FieldValue, await request(), actor);
    const [a, b] = await Promise.all(['A', 'B'].map(reason => request(deductionInput({ expectedRevision: 1, reason: 'Correction ' + reason }), 'correction-' + reason)));
    const outcomes = await Promise.allSettled([saveBikerDeduction(db, FieldValue, a, actor), saveBikerDeduction(db, FieldValue, b, actor)]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(1);
    const readback = await readBikerDeduction(db, { id: first.id }, actor);
    expect(readback.record.original).toEqual(first.record.original); expect(readback.record.history).toHaveLength(2);
  }, 120000);
  it('rechecks closed periods and admin membership after preview', async () => {
    const input = await request(); await db.doc('accounting_periods/2026-10').set({ status: 'closed' });
    await expect(saveBikerDeduction(db, FieldValue, input, actor)).rejects.toMatchObject({ code: 'aborted' });
    await db.doc('users/admin').set({ role: 'operator' });
    await expect(saveBikerDeduction(db, FieldValue, input, actor)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.collection('quality_objections').get()).size).toBe(0);
  });
  it.each(['payrollApplied', 'ledgerPosted'].flatMap(flag => ['root', 'current'].map(position => [flag, position])))('protects consumed %s on %s transactionally', async (flag, position) => {
    const saved = await saveBikerDeduction(db, FieldValue, await request(), actor), ref = db.collection('quality_objections').doc(saved.id);
    const record = (await ref.get()).data(); (position === 'root' ? record : record.current)[flag] = true;
    await ref.set(record);
    const input = deductionInput({ expectedRevision: 1, reason: 'Correction after consumption' });
    const p = await previewBikerDeduction(db, input, actor); expect(p).toMatchObject({ locked: true, canSave: false });
    await expect(saveBikerDeduction(db, FieldValue, await request(input, 'protected-correction'), actor)).rejects.toMatchObject({ code: 'aborted' });
    expect((await ref.get()).data()).toEqual(record); expect((await db.collection('audit_logs').get()).size).toBe(1);
  });
  it('uses supported admin actions and preserves raw owner-classified cancellation evidence', async () => {
    const payload = deductionInput({ sourceKind: 'booking', sourceId: 'C-990002', snapshotId: 'raw-test-run' });
    const auth = { uid: 'admin', token: { role: 'admin' } };
    const preview = await dispatch(db, FieldValue, 'bikerDeductionPreview', payload, auth);
    expect(preview.canSave).toBe(true);
    const result = await dispatch(db, FieldValue, 'bikerDeductionSave', { payload, reviewedPayloadHash: preview.reviewedPayloadHash, previewStateHash: preview.previewStateHash, requestId: 'owner-classification' }, auth);
    const readback = await dispatch(db, FieldValue, 'bikerDeductionRead', { id: result.id }, auth);
    expect(readback.record.current).toMatchObject({ amountSAR: null, quantity: 1, unit: 'count', matchedToCompensations: false, payrollApplied: false });
    expect((await db.collection('sweater_bookings').get()).docs[0].data()).toEqual(deductionSeed()['sweater_bookings/990002']);
  });
  it('records actual invoice deduction 129.95 with count one, never invoice net 109.95', async () => {
    const rawDoc = (await db.collection('sweater_raw_payloads').get()).docs[0], raw = rawDoc.data(), record = raw.normalizedRecord;
    const invoice = { bookingId: record.sspBookingId, driverExternalId: record.driverExternalId, serviceDate: record.serviceDate, cancellationReason: 'Biker Refused Wash',
      sourceReadAt: '2026-10-28T13:00:00Z', sourceUrl: record.sourceUrl, currency: 'SAR', optimalAmountSAR: 20,
      deductionLabel: 'Booking Cancelled (Reason 13)', signedDeductionSAR: -129.95, netAmountSAR: -109.95,
      observedText: 'Invoice Optimal Amount 20.00 SAR Deductions Booking Cancelled (Reason 13) -129.95 SAR Net Amount -109.95 SAR' };
    record.notes += '\nSSP_INVOICE_DEDUCTION_V1=' + JSON.stringify(invoice);
    const sourceHash = hashRecord(record);
    await rawDoc.ref.set({ ...raw, normalizedRecord: record, sourceHash });
    await db.doc('sweater_bookings/990002').update({ record, sourceHash });
    const run = (await db.doc('sweater_import_runs/raw-test-run').get()).data(); run.result.rows[0].sourceHash = sourceHash;
    await db.doc('sweater_import_runs/raw-test-run').set(run);
    const input = deductionInput({ sourceKind: 'booking', sourceId: 'C-990002', snapshotId: 'raw-test-run' });
    const result = await saveBikerDeduction(db, FieldValue, await request(input), actor);
    const readback = await readBikerDeduction(db, { id: result.id }, actor);
    expect(readback.record.current).toMatchObject({ amountSAR: 129.95, quantity: 1, unit: 'count', matchedToCompensations: false, ledgerPosted: false, payrollApplied: false });
    expect((await db.collection('journal_entries').get()).size).toBe(1);
  });
  it('binds a protected owner-completed booking to newer raw without any source, wash, claim or commission write', async () => {
    for (const [path, value] of Object.entries(protectedDeductionSeed())) await db.doc(path).set(value);
    const snapshot = async () => Object.fromEntries(await Promise.all(names.filter(n => !['quality_objections', 'audit_logs'].includes(n)).map(async name => [name,
      (await db.collection(name).get()).docs.map(d => ({ id: d.id, data: d.data() }))])));
    const before = await snapshot(), payload = deductionInput({ sourceKind: 'booking', sourceId: 'C-990002', snapshotId: 'raw-test-run' });
    const result = await saveBikerDeduction(db, FieldValue, await request(payload), actor);
    expect(result.record.current.bookingEvidence.binding.mode).toBe('protected_owner_completed_observation'); expect(await snapshot()).toEqual(before);
    const prepared = await request({ ...payload, expectedRevision: 1, reason: 'Another reviewed reason' }, 'source-became-paid');
    await db.doc('washes/ssp__C-990002').update({ worker_commission_paid: true });
    const protectedBefore = await snapshot();
    await expect(saveBikerDeduction(db, FieldValue, prepared, actor)).rejects.toThrow(/روابطه المحمية/); expect(await snapshot()).toEqual(protectedBefore);
    expect((await readBikerDeduction(db, { id: result.id }, actor)).record.revision).toBe(1);
  });
});
