import { beforeEach, describe, expect, it } from 'vitest';
import { syncDb, syncFV } from './helpers/sweaterOperationsFixture.js';
import { historicalPayload, requestFrom, seedHistorical5643311 } from './helpers/historical5643311Fixture.js';
import { operationsStatus, previewOperations, saveOperations } from '../src/sweater/operationsSync.js';
import { acceptedHistoricalIdentity5643311 } from '../src/sweater/operationsIdentity5643311.js';
import { calculatePayrollPreview } from '../src/payroll.js';

let db, history;
const workerPath = 'bikers/mjIi1UW9FlKYmomXxgJE';
const legacy = 'sweater_bookings/B-5643311';
const oldRaw = 'sweater_raw_payloads/ops-20261020-oct20-2200-190721__B-5643311';
const laterRaw = 'sweater_raw_payloads/ops-20261023-late-oct19-20-192552__S-5643311';
const oldRun = 'sweater_import_runs/ops-20261020-oct20-2200-190721';
const claimPath = 'sweater_owner_booking_claims/5643311';
const save = async payload => saveOperations(db, syncFV, requestFrom(payload, await previewOperations(db, payload)), 'synthetic-agent');
beforeEach(async () => {
  db = syncDb();
  db.rows.set(workerPath, { name: 'Synthetic internal name', driver_external_id: '2007', salary: 900, start_date: '2026-08-17' });
  history = await seedHistorical5643311(db, syncFV); db.writes.length = 0;
});
describe('one owner-conditioned later identity acceptance, preserving historical unknown identity', () => {
  it('previews without writes, creates one unpaid entitlement, and keeps all historical records and employee name intact', async () => {
    const before = structuredClone([...db.rows]); const payload = historicalPayload();
    const p = await previewOperations(db, payload);
    expect(db.writes).toEqual([]); expect([...db.rows]).toEqual(before);
    expect(p.rows[0]).toMatchObject({ washCreated: false, washId: 'ssp__B-5643311', reasonCode: null,
      historicalIdentityResolution: { eligible: true, claimPreserved: true, resolutionSaved: false,
        acceptance: { conditionMet: true, historicalWorkerLinkAsserted: false, employeeRename: false,
          internalReadAt: '2026-10-25T21:48:15.147Z', acceptedSourceName: 'Mohammed Amit (2007)' } } });
    const result = await saveOperations(db, syncFV, requestFrom(payload, p), 'synthetic-agent');
    expect(result).toMatchObject({ washesCreated: 1, saved: true, ledgerPosted: false, payrollPaid: false });
    expect(result.rows[0].historicalIdentityResolution).toMatchObject({ resolutionSaved: true, recordedAt: expect.any(String) });
    for (const [path, value] of before) if (path !== 'sweater_integration_state/current') expect(db.rows.get(path)).toEqual(value);
    expect(db.rows.get(legacy)).toMatchObject({ operationalWorkerId: null, reviewReasonCode: 'unverified_worker_link' });
    const wash = db.rows.get('washes/ssp__B-5643311');
    expect(wash).toMatchObject({ ssp_booking_id: 'S-5643311', wash_date: '2026-10-20', biker_id: 'mjIi1UW9FlKYmomXxgJE',
      biker_name: 'Mohammed Amit (2007)', driver_external_id: '2007', quantity: 1, net_amount: 20, vat_amount: 3, gross_amount: 23,
      collection_status: 'pending', payment_method: null, worker_commission_per_wash: 4.5, worker_commission_paid: false,
      worker_commission_payment_timing: 'payroll', historical_identity_acceptance: { historicalWorkerLinkAsserted: false } });
    expect(wash.owner_completion_decision).toBeUndefined();
    expect(db.rows.get(workerPath).name).toBe('Synthetic internal name');
    const payroll = calculatePayrollPreview({ periodKey: '2026-10', now: new Date('2026-10-26T00:00:00Z'),
      bikers: [{ id: 'mjIi1UW9FlKYmomXxgJE', name: 'Synthetic internal name', salary: 900, start_date: '2026-08-17' }],
      washes: [{ id: 'ssp__B-5643311', ...wash }] });
    expect(payroll.totals.commissions).toBe(4.5);
    for (const body of [history.old, history.later, payload]) expect(await operationsStatus(db, body)).toMatchObject({ verified: true });
    expect((await operationsStatus(db, payload)).verification[0].historicalIdentityResolutionVerified).toBe(true);
    expect(db.writes.some(p => /^(bikers|journal_entries|transactions|posting_locks|payroll_runs|sweater_settlements|sweater_owner_collection_confirmations|sweater_collections)\//.test(p))).toBe(false);
  });
  it('rejects forged or missing owner evidence and unrecognized client approval fields', async () => {
    const p = await previewOperations(db, historicalPayload()), acceptance = p.rows[0].historicalIdentityResolution.acceptance;
    expect(acceptedHistoricalIdentity5643311(acceptance)).toBe(true);
    for (const field of Object.keys(acceptance)) expect(acceptedHistoricalIdentity5643311({ ...acceptance, [field]: null })).toBe(false);
    expect(acceptedHistoricalIdentity5643311({ ...acceptance, conditionMet: false })).toBe(false);
    const payload = { ...historicalPayload(), phoneMatch: true };
    await expect(previewOperations(db, payload)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(db.writes).toEqual([]);
  });
  it.each([
    [legacy, row => { row.operationalWorkerId = 'different'; }], [legacy, row => { row.reviewReasonCode = 'execution_not_final'; }],
    [legacy, row => { row.sourceHash = 'bad'; }], [legacy, row => { row.record.startedAt = 'changed'; }],
    [legacy, row => { row.ownerCompletionDecision = { approved: true }; }], [legacy, row => { row.unrecognized = true; }],
    [claimPath, row => { row.washId = 'manual'; }], [claimPath, row => { row.source = 'other'; }],
    [oldRaw, row => { row.sourceHash = 'bad'; }], [oldRaw, row => { row.rawPayload.driverExternalId = 'other'; }],
    [laterRaw, row => { row.normalizedRecord.completedAt = 'changed'; }],
    [oldRun, row => { row.result.rows[0].washCreated = true; }], [oldRun, row => { row.result.rows[0].bikerId = 'backdated'; }],
    [oldRun, row => { row.status = 'processing'; }], [workerPath, row => { row.driver_external_id = 'other'; }],
    [workerPath, row => { row.end_date = '2026-10-19'; }],
  ])('fails closed on modified protected evidence: %s', async (path, change) => {
    change(db.rows.get(path)); const before = structuredClone([...db.rows]);
    expect((await save(historicalPayload())).washesCreated).toBe(0);
    for (const [key, value] of before) if (key !== 'sweater_integration_state/current') expect(db.rows.get(key)).toEqual(value);
  });
  it.each([
    [claimPath], [oldRaw], [laterRaw], [oldRun], [legacy], [workerPath],
  ])('fails closed when required evidence is missing: %s', async path => {
    db.rows.delete(path); expect((await save(historicalPayload())).washesCreated).toBe(0);
  });
  it.each([
    ['washes/ssp__B-5643311', { unrelated: true }], ['washes/manual', { ssp_booking_id: 'C-5643311' }],
    ['sweater_bookings/S-5643311', { sspBookingId: 'S-5643311' }],
    ['sweater_owner_collection_confirmations/manual', { evidence: { sspBookingId: 'Z-5643311' } }],
    ['sweater_operational_wash_links/b__C-5643311', {}], ['sweater_booking_links/w__ssp__C-5643311', {}],
    ['journal_entries/manual', { sourceId: 'C-5643311' }], ['transactions/manual', { source: { ref: { sspBookingId: 'Z-5643311' } } }],
    ['posting_locks/manual', { sourceId: 'Y-5643311' }], ['sweater_collections/manual', { source: { booking_number: 5643311 } }],
    ['sweater_adjustments/manual', { sourceRef: 'C-5643311' }], ['payroll_runs/manual', { washId: 'ssp__B-5643311' }],
    ['journal_entries/month', { sourceId: '2026-10' }], ['accounting_periods/2026-10', { status: 'closed' }],
    ['accounting_periods/2026-10', { financialLock: true }], ['sweater_settlements/2026-10', { status: 'approved' }],
  ])('protects aliases, financial references and period locks: %s', async (path, row) => {
    db.rows.set(path, row); const before = structuredClone([...db.rows]);
    expect((await save(historicalPayload())).washesCreated).toBe(0);
    for (const [key, value] of before) if (key !== 'sweater_integration_state/current') expect(db.rows.get(key)).toEqual(value);
  });
  it.each(['sspBookingId', 'serviceDate', 'driverExternalId', 'serviceType', 'bookingKind', 'startedAt', 'completedAt', 'rawStatus', 'notes', 'driverName'])(
    'does not generalize to another scope or invented %s', async field => {
      const p = historicalPayload(); p.records[0][field] = field === 'sspBookingId' ? 'S-5643312' : 'other';
      const result = await save(p);
      expect(result.rows[0].historicalIdentityResolution?.eligible).not.toBe(true);
      // An unrelated NEW booking still follows the unmodified normal writer.
      expect(db.rows.has('washes/ssp__B-5643311')).toBe(false);
      if (field !== 'sspBookingId') expect(result.washesCreated).toBe(0);
    });
  it('does not apply to batches, altered coverage or a more precise invented timestamp', async () => {
    for (const mutate of [p => { p.records.push({ ...p.records[0], sspBookingId: 'S-other' }); p.coverage.recordCount = 2; },
      p => { p.coverage.extractedAt = '2026-10-25T21:32:19Z'; }, p => { p.records[0].completedAt = '2026-10-20T22:10:20+03:00'; }]) {
      const p = historicalPayload(); mutate(p); const result = await previewOperations(db, p);
      expect(result.rows[0].washCreated).toBe(false); expect(result.rows[0].historicalIdentityResolution.eligible).toBe(false);
      expect(db.rows.has('washes/ssp__B-5643311')).toBe(false);
    }
  });
  it('same-run retries return the receipt, different runs/CAS races cannot create a second entitlement', async () => {
    const payload = historicalPayload(), p = await previewOperations(db, payload);
    const replies = await Promise.all([1, 2].map(() => saveOperations(db, syncFV, requestFrom(payload, p), 'synthetic-agent')));
    expect(replies.filter(r => !r.replay)).toHaveLength(1);
    expect((await operationsStatus(db, payload)).verified).toBe(true);
    expect((await save({ ...payload, importRunId: 'synthetic-second-run' })).washesCreated).toBe(0);
    const differentBody = { ...payload, agentStatus: 'ok' };
    await expect(previewOperations(db, differentBody)).rejects.toMatchObject({ code: 'already-exists' });
    expect([...db.rows.keys()].filter(path => path.startsWith('washes/'))).toHaveLength(1);
  });
  it.each([legacy, oldRaw, laterRaw, oldRun, claimPath, workerPath])('CAS rejects a change after preview and commits no partial writes: %s', async path => {
    const payload = historicalPayload(), p = await previewOperations(db, payload);
    db.rows.get(path).testChange = true;
    await expect(saveOperations(db, syncFV, requestFrom(payload, p), 'synthetic-agent')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(db.writes).toEqual([]);
  });
  it('status detects modified historical evidence or resolution receipt after success', async () => {
    const payload = historicalPayload(); await save(payload);
    db.rows.get(oldRaw).rawPayload.notes = 'changed';
    expect(await operationsStatus(db, payload)).toMatchObject({ verified: false, linksVerified: false });
  });
});
