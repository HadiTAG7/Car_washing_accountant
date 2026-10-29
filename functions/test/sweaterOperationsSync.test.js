import { describe, it, expect } from 'vitest';
import { validateOperationsPayload, previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';
import { recordProblems } from '../src/sweater/record.js';
import { computeSettlement } from '../src/sweater/settlement.js';
import { RECOGNITION_POLICY_SEED } from '../src/sweater/recognition.js';
import { calculatePayrollPreview } from '../src/payroll.js';

import { syncPayload, syncDb, syncFV, syncRequest } from './helpers/sweaterOperationsFixture.js';
const save = async (db, payload) => saveOperations(db, syncFV, syncRequest(payload, await previewOperations(db, payload)), 'sweater-browser-agent');

describe('cloud source worker matching without exporting worker profiles', () => {
  it('reuses one established source ID link when the collector supplies no worker map', async () => {
    const db = syncDb(), payload = syncPayload();
    payload.workerLinks = {};
    db.rows.set('washes/older-established-wash', { driver_external_id: 'driver-1', biker_id: 'worker-1', ssp_booking_id: 'B-older' });
    await save(db, payload);
    expect(db.rows.get('sweater_bookings/C-990001').operationalWorkerId).toBe('worker-1');
    expect(await operationsStatus(db, payload)).toMatchObject({ verified: true });
  });
  it.each(['unknown', 'conflicting'])('keeps %s source ID links for review', async kind => {
    const db = syncDb(), payload = syncPayload();
    payload.workerLinks = {};
    if (kind === 'conflicting') {
      for (const id of ['worker-1', 'worker-2']) db.rows.set(`washes/older-${id}`, {
        driver_external_id: 'driver-1', biker_id: id, ssp_booking_id: `B-older-${id}`,
      });
    }
    await save(db, payload);
    expect(db.rows.get('sweater_bookings/C-990001')).toMatchObject({
      operationalWorkerId: null, processingStatus: 'needs_review',
    });
  });
});

// Characterize the boundary before implementing the separately authorized
// execution register. These assertions do NOT mean that v2 creates washes.
describe('execution-independent-of-collection implementation boundary', () => {
  it('even an observation carrying start/end evidence remains raw-only in current v2', async () => {
    const db = syncDb(), payload = syncPayload();
    Object.assign(payload.records[0], {
      rawPaymentStatus: 'Pending', startedAt: '2026-10-08T10:00:00+03:00',
      completedAt: '2026-10-08T10:30:00+03:00',
    });
    expect(await save(db, payload)).toMatchObject({
      washesCreated: 0, ledgerPosted: false, payrollPaid: false,
    });
    const status = await operationsStatus(db, payload);
    expect(status).toMatchObject({ verified: true, rawVerified: true, linksVerified: true });
    expect(db.rows.get('sweater_bookings/C-990001')).toMatchObject({
      processingStatus: 'needs_review', recognitionEligibility: null,
      operationalWorkerId: 'worker-1', record: {
        paymentStatus: 'pending', completedAt: '2026-10-08T10:30:00+03:00',
        serviceDate: '2026-10-08', serviceType: 'observed-service',
      },
    });
    expect([...db.rows.keys()].some(path => /^(washes|payroll_runs|journal_entries|sweater_collections)\//.test(path))).toBe(false);
  });

  it.each(['Approved', 'Cancelled by Admin'])('payment recorded with %s is not an executed wash', async rawStatus => {
    const db = syncDb(), payload = syncPayload();
    Object.assign(payload.records[0], { rawPaymentStatus: 'Recorded', rawStatus });
    await save(db, payload);
    expect(db.rows.get('sweater_bookings/C-990001').record).toMatchObject({
      paymentStatus: 'recorded', completedAt: null,
    });
    expect([...db.rows.keys()].filter(path => path.startsWith('washes/'))).toEqual([]);
    expect(await operationsStatus(db, payload)).toMatchObject({ verified: true });
  });

  it.each([0, null])('a hypothetical completed legacy wash changes payroll despite price %s and pending collection', price => {
    const input = {
      periodKey: '2026-10', now: new Date('2026-10-09T12:00:00Z'),
      bikers: [{ id: 'worker-1', name: 'Synthetic worker', salary: 900, start_date: '2026-10-01' }],
      washes: [],
    };
    const before = calculatePayrollPreview(input);
    const after = calculatePayrollPreview({ ...input, washes: [{
      id: 'hypothetical-not-persisted', ssp_booking_id: 'C-990001',
      biker_id: 'worker-1', quantity: 1, status: 'مكتملة',
      wash_date: '2026-10-08', price, collection_status: 'pending',
    }] });
    expect(before.totals.commissions).toBe(0);
    expect(after.totals.commissions).toBe(4.5);
    expect(after.totals.net - before.totals.net).toBe(4.5);
  });

  it('retains original service day when observed completion crosses midnight', async () => {
    const db = syncDb(), payload = syncPayload();
    payload.coverage.extractedAt = '2026-10-09T00:15:00+03:00';
    Object.assign(payload.records[0], {
      startedAt: '2026-10-08T23:45:00+03:00', completedAt: '2026-10-09T00:10:00+03:00',
    });
    await save(db, payload);
    expect(db.rows.get('sweater_bookings/C-990001')).toMatchObject({
      serviceDate: '2026-10-08', periodKey: '2026-10',
      record: { serviceDate: '2026-10-08', completedAt: '2026-10-09T00:10:00+03:00' },
    });
    expect(await operationsStatus(db, payload)).toMatchObject({ verified: true });
  });
});

describe('bounded operational raw sync, not a financial or owner assertion', () => {
  it('previews without writing and atomically saves raw facts only with B2B gaps', async () => {
    const db = syncDb(), b = syncPayload(); const p = await previewOperations(db, b); expect(db.writes).toEqual([]);
    const result = await saveOperations(db, syncFV, syncRequest(b, p), 'sweater-browser-agent');
    expect(result).toMatchObject({ saved: true, status: 'completed_with_gaps', washesCreated: 0, ledgerPosted: false, payrollPaid: false });
    expect(db.rows.get('sweater_bookings/C-990001').record).toMatchObject({ rawStatus: 'Collecting Payment', platformAmount: null, completedAt: null });
    expect(db.rows.get('sweater_bookings/C-990001').recognitionEligibility).toBeNull();
    expect(db.writes.every(p => p.startsWith('sweater_'))).toBe(true);
    expect(await operationsStatus(db, b)).toMatchObject({ found: true, verified: true, result: { washesCreated: 0 } });
  });
  it('recovers a lost response and new-run duplicates with no second booking or wash', async () => {
    const db = syncDb(), b = syncPayload(); await save(db, b); const writes = db.writes.length;
    expect(await operationsStatus(db, b)).toMatchObject({ found: true, verified: true });
    expect((await save(db, b)).replay).toBe(true); expect(db.writes.length).toBe(writes);
    const next = { ...b, importRunId: 'synthetic-next' }; expect((await save(db, next)).counts.duplicate).toBe(1);
    expect([...db.rows.keys()].filter(p => p.startsWith('sweater_bookings/'))).toHaveLength(1);
    expect([...db.rows.keys()].filter(p => p.startsWith('washes/'))).toHaveLength(0);
  });
  it.each(['coverage', 'agentStatus', 'workerLinks'])('rejects changed %s under the same run, despite unchanged records', async field => {
    const db = syncDb(), b = syncPayload(); await save(db, b); const changed = structuredClone(b);
    if (field === 'coverage') changed.coverage.extractedAt = '2026-10-09T00:01:00+03:00';
    if (field === 'agentStatus') changed.agentStatus = 'partial';
    if (field === 'workerLinks') changed.workerLinks['driver-1'] = 'other-worker';
    await expect(previewOperations(db, changed)).rejects.toMatchObject({ code: 'already-exists' });
    await expect(operationsStatus(db, changed)).rejects.toMatchObject({ code: 'already-exists' });
  });
  it.each(['sweater_owner_collection_confirmations', 'sweater_booking_links', 'sweater_operational_wash_links', 'washes'])('preserves a protected %s link and saves conflicting observations for review only', async collection => {
    const db = syncDb(), b = syncPayload(); const path = `${collection}/legacy`;
    const original = { sspBookingId: 'S-990001', ssp_booking_id: 'S-990001', postedEntryId: 'protected-entry', washId: 'legacy-wash' };
    db.rows.set(path, original); const result = await save(db, b);
    expect(result.rows[0]).toMatchObject({ outcome: 'needs_review', rawSaved: true, bookingSaved: false });
    expect(db.rows.get(path)).toEqual(original); expect(db.rows.has('sweater_bookings/C-990001')).toBe(false);
  });
  it('does not modify a financially locked booking even when a new run carries a new status', async () => {
    const db = syncDb(), b = syncPayload(); await save(db, b);
    const row = db.rows.get('sweater_bookings/C-990001'); row.settlementId = 'protected-settlement';
    const original = structuredClone(row); b.importRunId = 'synthetic-change'; b.records[0].rawStatus = 'Cancelled by Admin';
    expect((await save(db, b)).rows[0].outcome).toBe('needs_review'); expect(db.rows.get('sweater_bookings/C-990001')).toEqual(original);
  });
  it.each(['Initiated', 'An entirely new status'])('retains %s as raw review, not completed, paid, or owner-confirmed', async rawStatus => {
    const db = syncDb(), b = syncPayload(); b.records[0].rawStatus = rawStatus;
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'needs_review', rawSaved: true, reasonCode: 'unknown_status' });
    expect(db.rows.get('sweater_bookings/C-990001').processingStatus).toBe('needs_review');
    expect(db.writes.some(p => /^(washes|journal_entries|sweater_owner_collection_confirmations)\//.test(p))).toBe(false);
  });
  it('missing service is retained for raw review only; financial validation still rejects it', async () => {
    const db = syncDb(), b = syncPayload(); delete b.records[0].serviceType;
    const preview = await previewOperations(db, b);
    expect(preview.rows[0]).toMatchObject({ outcome: 'needs_review', reasonCode: 'unknown_service_type' });
    expect(db.writes).toEqual([]);
    const result = await saveOperations(db, syncFV, syncRequest(b, preview), 'agent');
    expect(result).toMatchObject({ rawSavedCount: 1, bookingSavedCount: 1, washesCreated: 0, ledgerPosted: false, payrollPaid: false });
    expect(result.rows[0]).toMatchObject({ outcome: 'needs_review', rawSaved: true, reasonCode: 'unknown_service_type' });
    const booking = db.rows.get('sweater_bookings/C-990001');
    expect(booking).toMatchObject({ processingStatus: 'needs_review', reviewReasonCode: 'unknown_service_type', recognitionEligibility: null });
    expect(booking.record.serviceType).toBe('');
    expect(recordProblems(booking.record)).toContainEqual(expect.objectContaining({ code: 'unknown_service_type' }));
    const settlement = computeSettlement({ bookings: [booking],
      policyRows: [{ ...RECOGNITION_POLICY_SEED, status: 'active', effectiveFrom: '2026-01-01' }],
      // Even a malformed blank-key price cannot price a missing service.
      priceRows: [{ serviceType: '', effectiveFrom: '2026-01-01', status: 'active', netRate: 20, vatRate: 0.15 }] });
    expect(settlement.counts.eligible).toBe(0); expect(settlement.services.gross).toBe(0);
    expect(settlement.counts.needsReview).toBe(1);
    expect(await operationsStatus(db, b)).toMatchObject({ verified: true, rawVerified: true, linksVerified: true });
    const writes = db.writes.length;
    expect((await save(db, b)).replay).toBe(true); expect(db.writes).toHaveLength(writes);
    expect(db.writes.some(p => /^(washes|journal_entries|sweater_owner_collection_confirmations)\//.test(p))).toBe(false);
  });
  it('missing worker is retained for review without a guessed link', async () => {
    const db = syncDb(), b = syncPayload();
    b.importRunId = 'synthetic-missing-worker'; b.records[0].serviceType = 'observed-service'; delete b.records[0].driverExternalId;
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'needs_review', rawSaved: true, bikerId: null });
  });
  it('an incomplete observation never erases an existing known service, even on an unposted booking', async () => {
    const db = syncDb(), b = syncPayload(); await save(db, b);
    const original = structuredClone(db.rows.get('sweater_bookings/C-990001'));
    b.importRunId = 'synthetic-service-gap'; delete b.records[0].serviceType;
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'needs_review', reasonCode: 'unknown_service_type', rawSaved: true, bookingSaved: false });
    expect(db.rows.get('sweater_bookings/C-990001')).toEqual(original);
    expect(await operationsStatus(db, b)).toMatchObject({ verified: true });
  });
  it.each([
    r => { r.customerPhone = 'synthetic-prohibited'; },
    r => { r.netAmount = 20; },
    r => { r.serviceDate = '2026-02-30'; },
    r => { r.sourceUrl = 'https://evil.example/'; },
    r => { r.bookingKind = 'guessed'; },
    r => { r.driverName = { nested: 'no' }; },
    r => { r.rawStatus = ''; },
  ])('missing service does not bypass any other row validation', async mutate => {
    const db = syncDb(), b = syncPayload(); delete b.records[0].serviceType; mutate(b.records[0]);
    const result = await save(db, b);
    expect(result.rows[0]).toMatchObject({ outcome: 'rejected', rawSaved: false, bookingSaved: false });
    expect(result.rawSavedCount).toBe(0);
  });
  it('later evidenced service can update a pending booking, without creating a wash or revenue', async () => {
    const db = syncDb(), b = syncPayload(); delete b.records[0].serviceType; await save(db, b);
    b.importRunId = 'synthetic-evidenced-service'; b.records[0].serviceType = 'observed-service';
    const result = await save(db, b);
    expect(result).toMatchObject({ bookingSavedCount: 1, washesCreated: 0, ledgerPosted: false });
    expect(db.rows.get('sweater_bookings/C-990001').record.serviceType).toBe('observed-service');
    expect(db.rows.get('sweater_bookings/C-990001').recognitionEligibility).toBeNull();
    expect(await operationsStatus(db, b)).toMatchObject({ verified: true });
  });
  it('a worker map is not enough without an established registry or existing operational link', async () => {
    const db = syncDb(), b = syncPayload(); delete db.rows.get('bikers/worker-1').driver_external_id;
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'needs_review', reasonCode: 'unverified_worker_link', bikerId: null });
  });
  it('concurrent new batch/prefix variants cannot overwrite the natural claim or duplicate a booking', async () => {
    const db = syncDb(), a = syncPayload(), b = syncPayload(); b.importRunId = 'synthetic-race'; b.records[0].sspBookingId = 'S-990001';
    const [pa, pb] = await Promise.all([previewOperations(db, a), previewOperations(db, b)]);
    const results = await Promise.allSettled([saveOperations(db, syncFV, syncRequest(a, pa), 'agent'), saveOperations(db, syncFV, syncRequest(b, pb), 'agent')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect([...db.rows.keys()].filter(p => p.startsWith('sweater_bookings/'))).toHaveLength(1);
    expect(db.rows.get('sweater_owner_booking_claims/990001').sspBookingId).toBe('C-990001');
  });
  it.each([
    b => { b.ownerConfirmation = { source: 'owner_statement' }; },
    b => { b.workerLinks = { x: { token: 'never' } }; },
    b => { b.coverage.isComplete = true; },
    b => { b.coverage.sourceUrl = 'https://evil.example/'; },
    b => { b.importRunId = '../unsafe'; },
    b => { b.records = new Array(101).fill(b.records[0]); b.coverage.recordCount = 101; },
  ])('fails a malformed or dishonest envelope before data access', mutate => {
    const b = syncPayload(); mutate(b); expect(() => validateOperationsPayload(b)).toThrow();
  });
  it('rejects prohibited fields without persisting their values', async () => {
    const db = syncDb(), b = syncPayload(); b.records[0].netAmount = 20;
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'rejected', rawSaved: false });
    expect(JSON.stringify([...db.rows.values()])).not.toContain('netAmount');
  });
  it('does not choose the first of conflicting same-number rows in a batch', async () => {
    const db = syncDb(), b = syncPayload(); b.records.push({ ...b.records[0], sspBookingId: 'S-990001', rawStatus: 'Cancelled by Admin' }); b.coverage.recordCount = 2;
    const result = await save(db, b); expect(result.counts.rejected).toBe(2);
    expect(result.rawSavedCount).toBe(0); expect(db.rows.has('sweater_bookings/C-990001')).toBe(false);
  });
  it('reports historical raw persistence separately from changed current booking/links', async () => {
    const db = syncDb(), b = syncPayload(); await save(db, b);
    db.rows.get('sweater_bookings/C-990001').sourceHash = 'changed-after-save';
    expect(await operationsStatus(db, b)).toMatchObject({ found: true, verified: false, rawVerified: true, linksVerified: false });
  });
  it('an established existing worker/wash mapping supports raw facts without changing worker or wash', async () => {
    const db = syncDb(), b = syncPayload(); delete db.rows.get('bikers/worker-1').driver_external_id;
    db.rows.set('washes/prior-other-booking', { ssp_booking_id: 'C-880002', driver_external_id: 'driver-1', biker_id: 'worker-1' });
    expect((await save(db, b)).rows[0]).toMatchObject({ outcome: 'new', bikerId: 'worker-1' });
    expect(db.writes.some(p => p.startsWith('washes/'))).toBe(false);
  });
});
