import { beforeEach, describe, expect, it } from 'vitest';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { previewBikerDeduction, saveBikerDeduction, readBikerDeduction } from '../src/bikerDeductions.js';
import { deductionSeed, deductionInput, actor, month } from './bikerDeductionFixture.js';
import { isBikerDeduction, bikerDeductionIdentity } from '../../src/lib/sweater/bikerDeductions.js';
import { qualityObjectionId, saveQualityObjection } from '../src/qualityObjections.js';
import { hashRecord } from '../src/sweater/record.js';
import { encodeDocument, decodeDocument } from '../../src/lib/data/schema/codec.js';
import { tableFor } from '../../src/lib/data/schema/registry.js';
const FieldValue = { serverTimestamp: () => 'synthetic-time' };
describe('source biker deduction follow-up without payroll or financial writes', () => {
  let db;
  it('a ticket review with an Accepted SSP outcome is not an internal accepted objection or payroll deduction', async () => {
    const db = memoryFinanceDb(deductionSeed());
    db.rows.set('quality_objections/ssp-ticket-synthetic', { recordType:'ssp_ticket_review_v1',status:'accepted',
      metricKey:'cancelledByBiker',sourceId:'event-one',objectionHistory:[{id:'OBJ-TEST',status:'Accepted'}] });
    expect((await previewBikerDeduction(db,deductionInput(),actor)).canSave).toBe(true);
  });
  beforeEach(() => { db = memoryFinanceDb(deductionSeed()); });
  const prepare = async (input = deductionInput(), requestId = 'test-request') => {
    const p = await previewBikerDeduction(db, input, actor);
    return { payload: input, reviewedPayloadHash: p.reviewedPayloadHash, previewStateHash: p.previewStateHash, requestId };
  };
  it('previews with zero writes; a count with unknown money remains null', async () => {
    const before = structuredClone([...db.rows]);
    const p = await previewBikerDeduction(db, deductionInput(), actor);
    expect(p).toMatchObject({ canSave: true, dryRun: true, saved: false, proposed: { unit: 'count', quantity: 1, amountSAR: null, payrollApplied: false, ledgerPosted: false } });
    expect([...db.rows]).toEqual(before);
  });
  it('saves once, reads back independently and never writes a wash, payroll, settlement or journal', async () => {
    const before = [...db.rows].filter(([key]) => !key.startsWith('quality_objections/') && !key.startsWith('audit_logs/'));
    const request = await prepare(), saved = await saveBikerDeduction(db, FieldValue, request, actor);
    expect(saved.saved).toBe(true); expect(saved.record.original.amountSAR).toBeNull();
    expect((await readBikerDeduction(db, { id: saved.id }, actor)).record).toEqual(saved.record);
    const table = tableFor('quality_objections').table, encoded = encodeDocument(table, saved.id, saved.record);
    expect(decodeDocument(table, encoded.row, encoded.lines, {})).toEqual(saved.record);
    expect((await saveBikerDeduction(db, FieldValue, request, actor))).toMatchObject({ replay: true, saved: false, canSave: false });
    expect([...db.rows].filter(([key]) => !key.startsWith('quality_objections/') && !key.startsWith('audit_logs/'))).toEqual(before);
    expect([...db.rows].filter(([key, value]) => key.startsWith('quality_objections/') && isBikerDeduction(value))).toHaveLength(1);
  });
  it('does not re-add an identical event under a different request ID', async () => {
    const request = await prepare(), first = await saveBikerDeduction(db, FieldValue, request, actor);
    const p = await previewBikerDeduction(db, deductionInput({ expectedRevision: 1 }), actor);
    expect(p).toMatchObject({ duplicate: true, canSave: false });
    const again = await saveBikerDeduction(db, FieldValue, { ...request, requestId: 'second-request' }, actor);
    expect(again.record.revision).toBe(first.record.revision);
  });
  it('request reuse with changed content is refused', async () => {
    await saveBikerDeduction(db, FieldValue, await prepare(), actor);
    const changed = await prepare(deductionInput({ reason: 'Changed reason', expectedRevision: 1 }));
    await expect(saveBikerDeduction(db, FieldValue, changed, actor)).rejects.toMatchObject({ code: 'already-exists' });
  });
  it('canonicalizes aliases/category/date/read IDs for a cancelled booking', () => {
    const a = { metricKey: 'cancelledByBiker', bookingId: 'C-990001', sourceId: 'one' };
    expect(bikerDeductionIdentity(a)).toBe(bikerDeductionIdentity({ ...a, metricKey: 'cancelledMaintenance', bookingId: 'B-990001', sourceId: 'two', date: '2026-09-01' }));
    expect(bikerDeductionIdentity({ ...a, bookingId: null })).toBeNull();
  });
  it('new source reading and C/B alias update the same record, retaining its original', async () => {
    const first = await saveBikerDeduction(db, FieldValue, await prepare(), actor);
    const snap = structuredClone(db.rows.get('sweater_metric_snapshots/reading-one'));
    snap.extractedAtIso = '2026-10-28T16:00:00Z'; snap.eventDetails[0] = { ...snap.eventDetails[0], sourceId: 'new-event', bookingId: 'B-990001', amount: 25 };
    db.rows.set('sweater_metric_snapshots/reading-two', snap);
    const input = deductionInput({ sourceId: 'new-event', snapshotId: 'reading-two', expectedRevision: 1 });
    const corrected = await saveBikerDeduction(db, FieldValue, await prepare(input, 'correction'), actor);
    expect(corrected.id).toBe(first.id); expect(corrected.record.revision).toBe(2);
    expect(corrected.record.original).toEqual(first.record.original); expect(corrected.record.current.amountSAR).toBe(25);
    expect(corrected.record.history[1].before).toEqual(first.record.current);
  });
  it.each(['operator', 'partner'])('refuses role %s including readback', async userId => {
    await expect(previewBikerDeduction(db, deductionInput(), { userId })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(readBikerDeduction(db, { id: 'biker-deduction-' + 'a'.repeat(64) }, { userId })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it.each([
    ['accounting_periods/' + month, { status: 'closed' }],
    ['sweater_settlements/' + month, { status: 'approved' }],
    ['sweater_settlements/' + month, { journalEntryId: 'posted' }],
    ['payroll_periods/' + month, { currentRunId: 'protected-run' }],
    ['quality_objections/' + qualityObjectionId(month, 'cancelledByBiker', 'event-one'), { status: 'accepted' }],
  ])('keeps %s protected and cannot save around the gate', async (key, value) => {
    db.rows.set(key, value); db.rows.set('payroll_runs/protected-run', { status: 'approved' });
    const input = deductionInput(), p = await previewBikerDeduction(db, input, actor);
    expect(p).toMatchObject({ locked: true, canSave: false });
    await expect(saveBikerDeduction(db, FieldValue, await prepare(input), actor)).rejects.toMatchObject({ code: 'aborted' });
  });
  it('binds previews to membership, source, worker and lock state changes', async () => {
    const request = await prepare(); db.rows.get('bikers/worker-one').name = 'Changed identity';
    await expect(saveBikerDeduction(db, FieldValue, request, actor)).rejects.toMatchObject({ code: 'aborted' });
    db.rows.set('users/admin', { role: 'partner' });
    await expect(saveBikerDeduction(db, FieldValue, request, actor)).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it.each(['payrollApplied', 'ledgerPosted'].flatMap(flag => ['root', 'current'].map(position => [flag, position])))('protects consumed %s on %s without rewriting flags or history', async (flag, position) => {
    const saved = await saveBikerDeduction(db, FieldValue, await prepare(), actor);
    const record = db.rows.get('quality_objections/' + saved.id);
    (position === 'root' ? record : record.current)[flag] = true;
    const before = structuredClone([...db.rows]), input = deductionInput({ expectedRevision: 1, reason: 'Changed reason after consumption' });
    const p = await previewBikerDeduction(db, input, actor);
    expect(p).toMatchObject({ locked: true, canSave: false });
    await expect(saveBikerDeduction(db, FieldValue, await prepare(input, 'after-consumption'), actor)).rejects.toMatchObject({ code: 'aborted' });
    expect([...db.rows]).toEqual(before);
  });
  it('never accepts aggregate-only or stale details', async () => {
    const snap = structuredClone(db.rows.get('sweater_metric_snapshots/reading-one'));
    delete snap.eventDetails; delete snap.eventCoverage; snap.extractedAtIso = '2026-10-28T16:00:00Z';
    db.rows.set('sweater_metric_snapshots/reading-two', snap);
    await expect(previewBikerDeduction(db, deductionInput(), actor)).rejects.toMatchObject({ code: 'aborted' });
  });
  it('requires unique existing worker links and actual employment dates', async () => {
    db.rows.set('bikers/duplicate', { ...db.rows.get('bikers/worker-one') });
    await expect(previewBikerDeduction(db, deductionInput(), actor)).rejects.toThrow(/ربط العامل/);
    db.rows.delete('bikers/duplicate'); db.rows.get('bikers/worker-one').end_date = '2026-10-19';
    await expect(previewBikerDeduction(db, deductionInput(), actor)).rejects.toThrow(/فترة عمله/);
  });
  it.each([null, 0])('does not turn missing/zero SAR %s into a monetary deduction', async amount => {
    const snap = db.rows.get('sweater_metric_snapshots/reading-one');
    snap.metrics = { violations: amount || 0 }; snap.eventDetails[0] = { ...snap.eventDetails[0], metricKey: 'violations', amount };
    snap.eventCoverage[0].metricKey = 'violations';
    await expect(previewBikerDeduction(db, deductionInput({ metricKey: 'violations' }), actor)).rejects.toThrow();
  });
  it('records explicit booking-reason count by owner decision, without claiming a Compensations match', async () => {
    const input = deductionInput({ sourceKind: 'booking', sourceId: 'C-990002', snapshotId: 'raw-test-run' });
    const p = await previewBikerDeduction(db, input, actor);
    expect(p.proposed).toMatchObject({ matchedToCompensations: false, amountSAR: null, unit: 'count', quantity: 1,
      reconciliationStatus: 'awaiting_compensations_details', bookingEvidence: { rawStatus: 'Cancelled by Admin' } });
    expect((await saveBikerDeduction(db, FieldValue, await prepare(input), actor)).record.current.matchedToCompensations).toBe(false);
  });
  it('does not infer biker blame from a cancellation status or ambiguous accident reason', async () => {
    const input = deductionInput({ sourceKind: 'booking', sourceId: 'C-990002', snapshotId: 'raw-test-run' });
    db.rows.get('sweater_bookings/990002').sourceHash = 'changed';
    await expect(previewBikerDeduction(db, input, actor)).rejects.toThrow(/روابطه المحمية/);
  });
  it('accepts the import-verified existing worker link only when current booking and registry do not conflict', async () => {
    const input = deductionInput({ sourceKind: 'booking', sourceId: 'C-990002', snapshotId: 'raw-test-run' });
    db.rows.get('bikers/worker-one').driver_external_id = null;
    expect((await previewBikerDeduction(db, input, actor)).canSave).toBe(true);
    db.rows.get('sweater_bookings/990002').operationalWorkerId = null;
    await expect(previewBikerDeduction(db, input, actor)).rejects.toThrow(/ربط العامل/);
  });
  it('reads actual invoice SAR from stored raw only, keeping the cancellation count and original observation separate', async () => {
    const input = deductionInput({ sourceKind: 'booking', sourceId: 'C-990002', snapshotId: 'raw-test-run' });
    const rawEntry = [...db.rows].find(([key]) => key.startsWith('sweater_raw_payloads/'));
    const record = rawEntry[1].normalizedRecord;
    const evidence = { bookingId: record.sspBookingId, driverExternalId: record.driverExternalId, serviceDate: record.serviceDate, cancellationReason: 'Biker Refused Wash',
      sourceReadAt: '2026-10-28T13:00:00Z', sourceUrl: record.sourceUrl, currency: 'SAR', optimalAmountSAR: 20, deductionLabel: 'Booking Cancelled (Reason 13)',
      signedDeductionSAR: -129.95, netAmountSAR: -109.95, observedText: 'Invoice Optimal Amount 20.00 SAR Deductions Booking Cancelled (Reason 13) -129.95 SAR Net Amount -109.95 SAR' };
    record.notes += '\nSSP_INVOICE_DEDUCTION_V1=' + JSON.stringify(evidence);
    const sourceHash = hashRecord(record); rawEntry[1].sourceHash = sourceHash;
    db.rows.get('sweater_bookings/990002').sourceHash = sourceHash;
    db.rows.get('sweater_import_runs/raw-test-run').result.rows[0].sourceHash = sourceHash;
    const p = await previewBikerDeduction(db, input, actor);
    expect(p.proposed).toMatchObject({ amountSAR: 129.95, quantity: 1, unit: 'count', matchedToCompensations: false, sourceReadAt: evidence.sourceReadAt });
    const saved = await saveBikerDeduction(db, FieldValue, await prepare(input), actor);
    expect(saved.record.original.bookingEvidence.invoice.netAmountSAR).toBe(-109.95);
  });
  it('keeps ordinary objection follow-up separate and retains its private history', async () => {
    const result = await saveBikerDeduction(db, FieldValue, await prepare(), actor);
    const input = { periodKey: month, metricKey: 'cancelledByBiker', sourceId: 'event-one', snapshotId: 'reading-one', expectedRevision: 0, status: 'submitted', note: 'Private objection note' };
    await saveQualityObjection(db, FieldValue, input, actor);
    expect(db.rows.get('quality_objections/' + result.id)).toEqual(result.record);
    const audit = [...db.rows].filter(([key]) => key.startsWith('audit_logs/'));
    expect(JSON.stringify(audit)).not.toContain('Private objection note'); expect(JSON.stringify(audit)).not.toContain('Synthetic reviewed reason');
  });
});
