import { describe, expect, it } from 'vitest';
import { previewBookingIdentityCleanup, applyBookingIdentityCleanup, previewServiceTypeFill, applyServiceTypeFill,
  SERVICE_FILL_SOURCE } from '../src/sweater/bookingCleanup.js';
import { previewOperations, saveOperations } from '../src/sweater/operationsSync.js';
import { hashRecord } from '../src/sweater/record.js';
import * as legacyWriter from './helpers/legacyOperationsSync.js';
import { syncDb, syncFV, syncPayload, syncRequest } from './helpers/sweaterOperationsFixture.js';

// History as the writer before booking identity by number filed it: one booking per prefixed id, a variance per run.
const legacySave = async (db, payload) => legacyWriter.saveOperations(db, syncFV,
  syncRequest(payload, await legacyWriter.previewOperations(db, payload)), 'synthetic-agent');
const save = async (db, payload) => saveOperations(db, syncFV, syncRequest(payload, await previewOperations(db, payload)), 'synthetic-agent');
const reading = (id, rawStatus, extractedAt, fields = {}) => {
  const p = syncPayload(); p.importRunId = `run-${id}-${rawStatus.replace(/\W/g, '')}-${extractedAt.slice(11, 16).replace(':', '')}`;
  p.coverage.extractedAt = extractedAt;
  p.records[0] = { ...p.records[0], sspBookingId: id, rawStatus, serviceType: 'interior_exterior_wash', ...fields };
  return p;
};
const bookings = db => [...db.rows.keys()].filter(k => k.startsWith('sweater_bookings/')).sort();
// The old writer refused a second prefix of a number it already held; production's copies were filed by earlier
// paths. Here the copy is filed from the run's own raw row, as such a path would have.
const fileCopy = (db, payload) => {
  const id = payload.records[0].sspBookingId, raw = db.rows.get(`sweater_raw_payloads/${payload.importRunId}__${id}`);
  const found = [...db.rows.entries()].find(([k, v]) => k.startsWith('sweater_bookings/') && v.bookingNumber === id.replace(/^[A-Z]+-/, ''))?.[1];
  const { ownerCompletionDecision: _decision, ...first } = found;
  db.rows.set(`sweater_bookings/${id}`, { ...first, sspBookingId: id, record: raw.normalizedRecord, sourceHash: raw.sourceHash,
    lastImportRunId: payload.importRunId, normalizedStatus: raw.normalizedRecord.normalizedStatus,
    processingStatus: 'needs_review', reviewReasonCode: 'protected_existing_record' });
};
const legacyCopy = async (db, payload) => { await legacySave(db, payload); fileCopy(db, payload); };
const audits = db => [...db.rows.entries()].filter(([k]) => k.startsWith('audit_logs/')).map(([, v]) => v);
const apply = async (db, reason = 'توحيد الحجوزات برقمها بعد المراجعة') => {
  const preview = await previewBookingIdentityCleanup(db);
  return { preview, result: await applyBookingIdentityCleanup(db, syncFV, { reason, previewHash: preview.previewHash }, 'owner-1') };
};

describe('«توحيد الحجوزات» — one booking per Sweater number', () => {
  it('folds the B- and S- copies into the number with Sweater\'s latest reading, recorded and audited, once', async () => {
    const db = syncDb();
    await legacySave(db, reading('B-990001', 'On the Way', '2026-10-08T09:00:00+03:00'));
    await legacyCopy(db, reading('S-990001', 'Collecting Payment', '2026-10-08T12:00:00+03:00'));
    await legacySave(db, reading('B-990002', 'Initiated', '2026-10-08T10:00:00+03:00'));
    // As in production: the pair's one wash, filed under the first prefix.
    db.rows.set('washes/ssp__B-990001', { ssp_booking_id: 'B-990001', biker_id: 'worker-1', quantity: 1, status: 'مكتملة' });
    expect(bookings(db)).toEqual(['sweater_bookings/B-990001', 'sweater_bookings/B-990002', 'sweater_bookings/S-990001']);
    const copies = { B: structuredClone(db.rows.get('sweater_bookings/B-990001')), S: structuredClone(db.rows.get('sweater_bookings/S-990001')) };
    const openBefore = [...db.rows.entries()].filter(([k, v]) => k.startsWith('sweater_variances/') && v.resolution === 'unresolved').length;
    expect(openBefore).toBeGreaterThan(0);

    const { preview, result } = await apply(db);
    expect(preview.summary).toMatchObject({ numbers: 2, folded: 1, renamed: 1, duplicatesRemoved: 1, skipped: [] });
    expect(preview.rows.find(r => r.number === '990001')).toMatchObject({ copies: ['B-990001', 'S-990001'],
      latest: { sspBookingId: 'S-990001', rawStatus: 'Collecting Payment' } });
    expect(result).toMatchObject({ saved: true, applied: 2, ledgerPosted: false, washesCreated: 0 });
    expect(bookings(db)).toEqual(['sweater_bookings/990001', 'sweater_bookings/990002']);
    expect(db.rows.get('sweater_bookings/990001')).toMatchObject({ sspBookingId: 'S-990001', bookingNumber: '990001',
      aliases: ['B-990001', 'S-990001'], mergedFrom: ['B-990001', 'S-990001'], normalizedStatus: 'payment_collection',
      observedAtIso: '2026-10-08T12:00:00+03:00', record: { rawStatus: 'Collecting Payment' },
      identityCleanup: { appliedBy: 'owner-1', reason: 'توحيد الحجوزات برقمها بعد المراجعة' } });
    expect(db.rows.get('sweater_bookings/990001').sourceHash).toBe(hashRecord(db.rows.get('sweater_bookings/990001').record));
    // Initiated is still moving in Sweater: it waits for the next reading, it is not a question for the owner.
    expect(db.rows.get('sweater_bookings/990002')).toMatchObject({ processingStatus: 'pending_source', reviewReasonCode: 'unknown_status',
      mergedFrom: ['B-990002'] });
    // Every per-run question is closed; no booking is left needing a decision here.
    expect([...db.rows.entries()].filter(([k, v]) => k.startsWith('sweater_variances/') && v.resolution === 'unresolved')).toEqual([]);
    expect([...db.rows.entries()].filter(([k, v]) => k.startsWith('sweater_variances/') && v.resolution === 'superseded'))
      .toHaveLength(openBefore);
    // Who, when, why and from what: each folded copy is kept whole in the audit.
    const audit = audits(db).find(a => a.documentId === '990001');
    expect(audit).toMatchObject({ action: 'sweater.bookingIdentityCleanup', userId: 'owner-1', reason: 'توحيد الحجوزات برقمها بعد المراجعة',
      before: { 'B-990001': copies.B, 'S-990001': copies.S }, source: { kind: 'identity_cleanup', previewHash: preview.previewHash } });
    expect(audit.note).toContain('B-990001 وS-990001 ← 990001');
    expect(db.rows.get('sweater_integration_state/bookingIdentityCleanup')).toMatchObject({ appliedBy: 'owner-1', applied: 2,
      previewHash: preview.previewHash });
    // Nothing left to do; and no wash, claim or ledger row was touched.
    expect((await previewBookingIdentityCleanup(db)).summary.numbers).toBe(0);
    expect(db.writes.some(p => /^(washes|journal_entries|sweater_owner_booking_claims)\//.test(p) && !p.startsWith('sweater_owner_booking_claims/990'))).toBe(false);
  });

  it('takes the reading Sweater made last, not the one saved last', async () => {
    const db = syncDb();
    await legacySave(db, reading('S-990001', 'Collecting Payment', '2026-10-08T12:00:00+03:00'));
    await legacyCopy(db, reading('B-990001', 'Washing Started', '2026-10-08T10:00:00+03:00'));
    await apply(db);
    expect(db.rows.get('sweater_bookings/990001')).toMatchObject({ sspBookingId: 'S-990001', normalizedStatus: 'payment_collection' });
  });

  it('keeps an owner-held record as the owner left it, with Sweater\'s latest reading beside it, and raises a contradiction', async () => {
    const db = syncDb();
    await legacySave(db, reading('B-990003', 'Washing Started', '2026-10-08T10:00:00+03:00'));
    const held = db.rows.get('sweater_bookings/B-990003');
    held.ownerCompletionDecision = { decision: 'record_as_completed_wash', approved: true };
    await legacyCopy(db, reading('C-990003', 'Cancelled by Admin', '2026-10-08T12:00:00+03:00'));
    const record = structuredClone(held.record);
    await apply(db);
    const booking = db.rows.get('sweater_bookings/990003');
    expect(booking).toMatchObject({ sspBookingId: 'B-990003', record, ownerCompletionDecision: held.ownerCompletionDecision,
      latestObservation: { sspBookingId: 'C-990003', normalizedStatus: 'admin_cancelled' },
      processingStatus: 'needs_review', reviewReasonCode: 'protected_existing_record' });
    expect(db.rows.get('sweater_variances/ops__990003')).toMatchObject({ resolution: 'unresolved', reasonCode: 'protected_existing_record',
      conflictFields: ['normalizedStatus'], periodKey: '2026-10', bookingNumber: '990003' });
  });

  it('does not call a completion that agrees with the owner\'s decision a contradiction', async () => {
    const db = syncDb();
    await legacySave(db, reading('B-990004', 'Washing Started', '2026-10-08T10:00:00+03:00', { startedAt: '2026-10-08T09:50:00+03:00' }));
    db.rows.get('sweater_bookings/B-990004').ownerCompletionDecision = { decision: 'record_as_completed_wash', approved: true };
    await legacyCopy(db, reading('S-990004', 'Collecting Payment', '2026-10-08T12:00:00+03:00',
      { startedAt: '2026-10-08T09:50:00+03:00', completedAt: '2026-10-08T10:30:00+03:00' }));
    await apply(db);
    expect(db.rows.get('sweater_bookings/990004')).toMatchObject({ processingStatus: 'validated',
      latestObservation: { sspBookingId: 'S-990004', normalizedStatus: 'payment_collection', completedAt: '2026-10-08T10:30:00+03:00' } });
    expect(db.rows.has('sweater_variances/ops__990004')).toBe(false);
  });

  it('raises a proven execution that never got a wash, and leaves a posted booking untouched', async () => {
    const db = syncDb();
    // The execution was read for another worker than the reservation's, so no rule could promote it: no wash exists.
    db.rows.set('bikers/worker-2', { name: 'Synthetic second worker', driver_external_id: 'driver-2' });
    const first = reading('B-990005', 'On the Way', '2026-10-08T09:00:00+03:00', { driverExternalId: 'driver-2' });
    first.workerLinks = { 'driver-2': 'worker-2' };
    await legacySave(db, first);
    await legacyCopy(db, reading('S-990005', 'Collecting Payment', '2026-10-08T12:00:00+03:00',
      { startedAt: '2026-10-08T10:00:00+03:00', completedAt: '2026-10-08T10:40:00+03:00' }));
    expect([...db.rows.keys()].some(k => k.startsWith('washes/'))).toBe(false);
    await legacySave(db, reading('S-990006', 'Collecting Payment', '2026-10-08T12:00:00+03:00'));
    db.rows.get('sweater_bookings/S-990006').postedEntryId = 'je-1';
    const posted = structuredClone(db.rows.get('sweater_bookings/S-990006'));
    const { preview } = await apply(db);
    expect(preview.summary.skipped).toEqual([{ number: '990006', why: 'financially_locked' }]);
    expect(db.rows.get('sweater_bookings/990005')).toMatchObject({ processingStatus: 'needs_review', reviewReasonCode: 'execution_without_wash' });
    expect(db.rows.get('sweater_variances/ops__990005')).toMatchObject({ resolution: 'unresolved', reasonCode: 'execution_without_wash' });
    expect(db.rows.get('sweater_bookings/S-990006')).toEqual(posted);
    expect(db.rows.has('sweater_bookings/990006')).toBe(false);
  });

  it('refuses without a reason, on a stale preview, and when a booking moved after the preview', async () => {
    const db = syncDb();
    await legacySave(db, reading('B-990001', 'On the Way', '2026-10-08T09:00:00+03:00'));
    const preview = await previewBookingIdentityCleanup(db), before = new Map(db.rows);
    await expect(applyBookingIdentityCleanup(db, syncFV, { reason: ' ', previewHash: preview.previewHash }, 'owner-1'))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(applyBookingIdentityCleanup(db, syncFV, { reason: 'x', previewHash: 'stale' }, 'owner-1'))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    db.rows.get('sweater_bookings/B-990001').notes = 'changed after the preview';
    await expect(applyBookingIdentityCleanup(db, syncFV, { reason: 'x', previewHash: preview.previewHash }, 'owner-1'))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    for (const [key, value] of before) if (key !== 'sweater_bookings/B-990001') expect(db.rows.get(key)).toEqual(value);
    expect(audits(db)).toEqual([]);
  });

  it('after the cleanup, today\'s writer keeps one booking per number and settles its own question', async () => {
    const db = syncDb();
    await legacySave(db, reading('B-990001', 'On the Way', '2026-10-08T09:00:00+03:00'));
    // Until the cleanup runs, a reading of a number still filed under a prefix waits for it, and writes nothing over it.
    const waiting = await save(db, reading('S-990001', 'Collecting Payment', '2026-10-08T11:00:00+03:00'));
    expect(waiting.rows[0]).toMatchObject({ outcome: 'needs_review', reasonCode: 'awaiting_identity_cleanup', bookingSaved: false });
    expect(db.rows.get('sweater_variances/ops__990001')).toMatchObject({ resolution: 'unresolved', reasonCode: 'awaiting_identity_cleanup' });
    await apply(db);
    // The waiting question becomes the real one: Sweater shows it done, with no Start/End to prove the wash.
    expect(db.rows.get('sweater_bookings/990001')).toMatchObject({ sspBookingId: 'S-990001', processingStatus: 'needs_review',
      reviewReasonCode: 'missing_execution_evidence', aliases: ['B-990001', 'S-990001'] });
    expect(db.rows.get('sweater_variances/ops__990001')).toMatchObject({ resolution: 'unresolved', reasonCode: 'missing_execution_evidence' });
    const next = await save(db, reading('S-990001', 'Collecting Payment', '2026-10-08T13:00:00+03:00', { notes: 'later reading' }));
    expect(next.rows[0]).toMatchObject({ outcome: 'needs_review', reasonCode: 'missing_execution_evidence', bookingSaved: true });
    expect(db.rows.get('sweater_bookings/990001')).toMatchObject({ record: { notes: 'later reading' }, observedAtIso: '2026-10-08T13:00:00+03:00' });
    expect(bookings(db)).toEqual(['sweater_bookings/990001']);
    expect([...db.rows.keys()].filter(k => k.startsWith('sweater_variances/ops__'))).toEqual(['sweater_variances/ops__990001']);
  });
});

describe('«تعبئة نوع الخدمة» from Sweater\'s Biker Bookings and Tips report', () => {
  const completedWithoutType = async () => {
    const db = syncDb();
    await legacySave(db, reading('S-990010', 'Collecting Payment', '2026-10-08T12:00:00+03:00', { serviceType: undefined }));
    await legacySave(db, reading('S-990011', 'Collecting Payment', '2026-10-08T12:00:00+03:00', { serviceType: undefined }));
    await legacySave(db, reading('C-990012', 'Cancelled by Admin', '2026-10-08T12:00:00+03:00', { serviceType: undefined }));
    db.rows.set('washes/manual-990010', { ssp_booking_id: 'S-990010', biker_id: 'worker-1', quantity: 1 });
    return db;
  };
  it('waits for the identity cleanup', async () => {
    await expect(previewServiceTypeFill(await completedWithoutType(), { periodKey: '2026-10' })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('fills only completed bookings without a type, with the report as the audited source, and settles their question', async () => {
    const db = await completedWithoutType(); await apply(db);
    expect(db.rows.get('sweater_bookings/990010')).toMatchObject({ processingStatus: 'needs_review', reviewReasonCode: 'unknown_service_type' });
    const preview = await previewServiceTypeFill(db, { periodKey: '2026-10' });
    expect(preview).toMatchObject({ source: SERVICE_FILL_SOURCE, serviceType: 'interior_exterior_wash' });
    // With a wash recorded the booking is settled; without one, and with no Start/End, it stays a question.
    expect(preview.rows.map(r => [r.number, r.hasWash, r.processingStatus, r.reasonCode])).toEqual([['990010', true, 'validated', null],
      ['990011', false, 'needs_review', 'missing_execution_evidence']]);
    await expect(applyServiceTypeFill(db, syncFV, { periodKey: '2026-10', reason: '', previewHash: preview.previewHash }, 'owner-1'))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    const result = await applyServiceTypeFill(db, syncFV, { periodKey: '2026-10', reason: 'كل المكتمل في أكتوبر Full Wash', previewHash: preview.previewHash }, 'owner-1');
    expect(result).toMatchObject({ saved: true, filled: 2, ledgerPosted: false, washesCreated: 0 });
    const booking = db.rows.get('sweater_bookings/990010');
    expect(booking).toMatchObject({ record: { serviceType: 'interior_exterior_wash', serviceTypeLabel: 'Full Wash' }, processingStatus: 'validated',
      serviceTypeFill: { source: SERVICE_FILL_SOURCE, filledBy: 'owner-1', reason: 'كل المكتمل في أكتوبر Full Wash' } });
    expect(booking.sourceHash).toBe(hashRecord(booking.record));
    expect(db.rows.get('sweater_bookings/990012').record.serviceType).toBe('');
    expect(db.rows.get('sweater_variances/ops__990010')).toMatchObject({ resolution: 'superseded', supersededBecause: 'service_type_filled' });
    expect(db.rows.get('sweater_variances/ops__990011')).toMatchObject({ resolution: 'unresolved', reasonCode: 'missing_execution_evidence' });
    const audit = audits(db).find(a => a.action === 'sweater.serviceTypeFill' && a.documentId === '990010');
    expect(audit).toMatchObject({ userId: 'owner-1', source: { kind: 'sweater_report', report: SERVICE_FILL_SOURCE },
      before: { record: { serviceType: '' } }, after: { record: { serviceType: 'interior_exterior_wash' } } });
    expect((await previewServiceTypeFill(db, { periodKey: '2026-10' })).rows).toEqual([]);
  });
});

describe('who may run it', () => {
  it('is the admin\'s: an accountant can neither preview nor apply', async () => {
    const { dispatch } = await import('../src/handlers.js');
    const { memoryFinanceDb } = await import('../../server/__tests__/financeFixtures.js');
    const db = memoryFinanceDb({ 'users/admin': { role: 'admin' }, 'users/acc': { role: 'accountant' } });
    for (const name of ['sweaterBookingCleanupPreview', 'sweaterBookingCleanupApply', 'sweaterServiceTypeFillPreview', 'sweaterServiceTypeFillApply']) {
      await expect(dispatch(db, syncFV, name, { periodKey: '2026-10', reason: 'x', previewHash: 'x' }, { uid: 'acc' }))
        .rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect(await dispatch(db, syncFV, 'sweaterBookingCleanupPreview', {}, { uid: 'admin' })).toMatchObject({ dryRun: true, summary: { numbers: 0 } });
  });
});

describe('runs saved before the cleanup', () => {
  it('still verify afterwards: the booking is found under its number, moved on by a later reading', async () => {
    const { operationsStatus } = await import('../src/sweater/operationsSync.js');
    const db = syncDb(), first = reading('B-990001', 'On the Way', '2026-10-08T09:00:00+03:00');
    await legacySave(db, first);
    await legacyCopy(db, reading('S-990001', 'Collecting Payment', '2026-10-08T12:00:00+03:00'));
    db.rows.set('washes/ssp__B-990001', { ssp_booking_id: 'B-990001', biker_id: 'worker-1', quantity: 1 });
    expect(await operationsStatus(db, first)).toMatchObject({ verified: true });
    await apply(db);
    expect(await operationsStatus(db, first)).toMatchObject({ verified: true, rawVerified: true,
      verification: [{ bookingId: 'B-990001', currentBookingSupersededBy: expect.stringContaining('run-S-990001') }] });
  });
});

describe('a reservation whose execution Sweater proved but that never got its wash', () => {
  it('is kept on its open reading, and the next sync\'s source-proven promotion records the one wash', async () => {
    const db = syncDb();
    const started = reading('B-990007', 'Washing Started', '2026-10-08T10:00:00+03:00', { startedAt: '2026-10-08T09:50:00+03:00' });
    await legacySave(db, started);
    // At the time the old writer could not promote it (here: a claim it did not recognise), so the done reading is raw only.
    db.rows.get('sweater_owner_booking_claims/990007').unexpected = true;
    const done = reading('S-990007', 'Collecting Payment', '2026-10-08T12:00:00+03:00',
      { startedAt: '2026-10-08T09:50:00+03:00', completedAt: '2026-10-08T10:30:00+03:00' });
    expect((await legacySave(db, done)).washesCreated).toBe(0);
    delete db.rows.get('sweater_owner_booking_claims/990007').unexpected;
    const { preview } = await apply(db);
    expect(preview.summary.awaitingPromotion).toBe(1);
    expect(db.rows.get('sweater_bookings/990007')).toMatchObject({ sspBookingId: 'B-990007', processingStatus: 'pending_source',
      reviewReasonCode: 'execution_not_final', aliases: ['B-990007', 'S-990007'], record: { rawStatus: 'Washing Started' } });
    expect(db.rows.has('sweater_variances/ops__990007')).toBe(false);
    expect(audits(db).find(a => a.documentId === '990007').note).toContain('حتى تُثبت المزامنة التالية الغسلة');
    const { pendingBookings } = await import('../src/sweater/operationsSync.js');
    expect((await pendingBookings(db)).bookings.map(b => b.bookingNumber)).toEqual(['990007']);
    // The next sync re-reads it: the guarded promotion makes exactly one wash, under the reservation's id.
    const next = structuredClone(done); next.importRunId = 'run-S-990007-next'; next.coverage.extractedAt = '2026-10-08T13:00:00+03:00';
    const r = await save(db, next);
    expect(r).toMatchObject({ washesCreated: 1 });
    expect(r.rows[0].observationPromotion).toMatchObject({ eligible: true });
    expect(db.rows.get('washes/ssp__B-990007')).toMatchObject({ ssp_booking_id: 'S-990007', worker_commission_paid: false });
    expect(db.rows.get('sweater_bookings/990007')).toMatchObject({ sspBookingId: 'S-990007', processingStatus: 'validated' });
  });
});

describe('readers before the cleanup runs', () => {
  it('find a booking under its number, or else under the prefixed id it was seen with', async () => {
    const { readBookingDoc } = await import('../src/sweater/ingest.js');
    const db = syncDb(), read = ref => ref.get();
    db.rows.set('sweater_bookings/B-990020', { sspBookingId: 'B-990020' });
    expect((await readBookingDoc(db, read, 'B-990020')).id).toBe('B-990020');
    db.rows.set('sweater_bookings/990020', { sspBookingId: 'S-990020' });
    expect((await readBookingDoc(db, read, 'B-990020')).data()).toEqual({ sspBookingId: 'S-990020' });
    expect((await readBookingDoc(db, read, 'S-990021')).exists).toBe(false);
  });
});
