import { beforeEach, describe, expect, it } from 'vitest';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { previewBikerDeduction, saveBikerDeduction } from '../src/bikerDeductions.js';
import { protectedDeductionSeed, deductionInput, actor } from './bikerDeductionFixture.js';
import { hashBody, hashRecord } from '../src/sweater/record.js';
const FieldValue = { serverTimestamp: () => 'synthetic-time' };
describe('deduction evidence binds preserved owner-completed bookings without rewriting them', () => {
  let db;
  const input = () => deductionInput({ sourceKind: 'booking', sourceId: 'C-990002', snapshotId: 'raw-test-run' });
  beforeEach(() => { db = memoryFinanceDb(protectedDeductionSeed()); });
  const request = async () => { const payload = input(), p = await previewBikerDeduction(db, payload, actor); return { payload,
    reviewedPayloadHash: p.reviewedPayloadHash, previewStateHash: p.previewStateHash, requestId: 'protected-source-request' }; };
  it('records only event follow-up while preserving old booking notes, real start, wash, claim and links', async () => {
    const before = structuredClone([...db.rows]), p = await previewBikerDeduction(db, input(), actor);
    expect(p.canSave).toBe(true); expect(p.proposed.bookingEvidence.binding.mode).toBe('protected_owner_completed_observation');
    expect(p.proposed.bookingEvidence.rawSourceHash).not.toBe(p.proposed.bookingEvidence.binding.bookingSourceHash);
    expect([...db.rows]).toEqual(before);
    const result = await saveBikerDeduction(db, FieldValue, await request(), actor);
    expect(result.saved).toBe(true); expect(result.record.current.matchedToCompensations).toBe(false);
    expect([...db.rows].filter(([key]) => !key.startsWith('quality_objections/') && !key.startsWith('audit_logs/'))).toEqual(before);
  });
  it.each(['sspBookingId', 'serviceDate', 'driverExternalId', 'rawStatus'])('rejects real current source identity conflict: %s', async field => {
    const booking = db.rows.get('sweater_bookings/C-990002'); booking.record[field] = field === 'serviceDate' ? '2026-10-21' : 'different';
    booking.sourceHash = hashRecord(booking.record);
    await expect(previewBikerDeduction(db, input(), actor)).rejects.toThrow(/روابطه المحمية/);
  });
  it.each(['worker_commission_paid', 'ledgerPosted', 'payrollApplied', 'financialLock'])('rejects current consumed wash %s even when the import link hash agrees', async flag => {
    const wash = db.rows.get('washes/ssp__C-990002'); wash[flag] = true;
    const refs = db.rows.get('sweater_import_runs/raw-test-run').result.rows[0].existingLinkRefs;
    refs.find(r => r.collection === 'washes').hash = hashBody(wash);
    const before = structuredClone([...db.rows]);
    await expect(previewBikerDeduction(db, input(), actor)).rejects.toThrow(/روابطه المحمية/);
    expect([...db.rows]).toEqual(before);
  });
  it.each(['postedEntryId', 'settlementId', 'financialLock'])('does not bypass protected booking field %s', async flag => {
    db.rows.get('sweater_bookings/C-990002')[flag] = 'protected';
    await expect(previewBikerDeduction(db, input(), actor)).rejects.toThrow(/روابطه المحمية/);
  });
  it('rejects a stale protected link or another worker or natural claim', async () => {
    const path = 'sweater_operational_wash_links/b__C-990002'; db.rows.get(path).bikerId = 'other';
    await expect(previewBikerDeduction(db, input(), actor)).rejects.toThrow(/روابطه المحمية/);
    db = memoryFinanceDb(protectedDeductionSeed()); db.rows.get('sweater_bookings/C-990002').operationalWorkerId = 'other';
    await expect(previewBikerDeduction(db, input(), actor)).rejects.toThrow(/روابطه المحمية/);
    db = memoryFinanceDb(protectedDeductionSeed()); db.rows.get('sweater_owner_booking_claims/990002').washId = 'another-wash';
    await expect(previewBikerDeduction(db, input(), actor)).rejects.toThrow(/روابطه المحمية/);
  });
  it('rechecks source links after preview and refuses without changing old source or follow-up history', async () => {
    const prepared = await request(); db.rows.get('washes/ssp__C-990002').worker_commission_paid = true;
    const before = structuredClone([...db.rows]);
    await expect(saveBikerDeduction(db, FieldValue, prepared, actor)).rejects.toThrow(/روابطه المحمية/); expect([...db.rows]).toEqual(before);
  });
});
