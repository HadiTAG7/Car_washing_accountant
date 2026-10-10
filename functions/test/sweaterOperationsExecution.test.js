import { describe, expect, it } from 'vitest';
import { syncDb, syncFV, syncPayload, syncRequest } from './helpers/sweaterOperationsFixture.js';
import { previewOperations, saveOperations, operationsStatus } from '../src/sweater/operationsSync.js';
import { calculatePayrollPreview } from '../src/payroll.js';
import { mapWash } from '../../src/lib/mappers.js';
import { ownerWashTaxSplit } from '../../src/lib/sweater/ownerWashTax.js';
import { liveIncomeStatement } from '../../src/lib/accounting/liveIncomeStatement.js';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/accounting/chartOfAccounts.js';

const execution = () => {
  const p = syncPayload();
  p.records[0] = { ...p.records[0], serviceType: 'interior_exterior_wash', rawPaymentStatus: 'Pending',
    startedAt: '2026-10-08T10:00:00+03:00', completedAt: '2026-10-08T10:30:00+03:00' };
  return p;
};
const save = async (db, p) => saveOperations(db, syncFV, syncRequest(p, await previewOperations(db, p)), 'sweater-browser-agent');
const washes = db => [...db.rows.entries()].filter(([key]) => key.startsWith('washes/')).map(([key, row]) => ({ id: key.split('/').at(-1), ...row }));
const payroll = db => calculatePayrollPreview({ periodKey: '2026-10', now: new Date('2026-10-09T12:00:00Z'),
  bikers: [{ id: 'worker-1', name: 'Synthetic worker', salary: 900, start_date: '2026-10-01' }], washes: washes(db) });

describe('owner-authorized executed washes independent of customer collection', () => {
  it('previews without writes then persists one wash with23/3/20 and4.50 commission, not payment or journals', async () => {
    const db = syncDb(), p = execution(); const before = payroll(db);
    const preview = await previewOperations(db, p);
    expect(db.writes).toEqual([]);
    expect(preview.rows[0]).toMatchObject({ washCreated: false, washId: 'ssp__C-990001' });
    const result = await saveOperations(db, syncFV, syncRequest(p, preview), 'sweater-browser-agent');
    expect(result).toMatchObject({ washesCreated: 1, ledgerPosted: false, payrollPaid: false });
    expect(washes(db)).toHaveLength(1);
    const w = washes(db)[0];
    expect(w).toMatchObject({ biker_id: 'worker-1', quantity: 1, status: 'مكتملة', wash_date: '2026-10-08',
      price: 20, net_amount: 20, gross_amount: 23, vat_amount: 3, price_mode: 'exclusive',
      revenue_origin: 'sweater', payment_method: null, collection_status: 'pending',
      worker_commission_per_wash: 4.5, worker_commission_paid: false });
    expect(ownerWashTaxSplit(mapWash(w))).toEqual({ net: 20, vat: 3, gross: 23 });
    expect(payroll(db).totals.commissions - before.totals.commissions).toBe(4.5);
    const revenue = liveIncomeStatement({ accounts: DEFAULT_CHART_OF_ACCOUNTS, entries: [], lines: [],
      periodKey: '2026-10', sources: { washes: washes(db) }, policyAt: () => ({ known: false }) });
    expect(revenue).toMatchObject({ netRevenue: 20, ledgerNetRevenue: 0, issues: [] });
    expect(revenue.operationalItems[0]).toMatchObject({ gross: 23, vat: 3 });
    expect(await operationsStatus(db, p)).toMatchObject({ verified: true, result: { washesCreated: 1 } });
    expect(db.writes.some(path => /^(journal_entries|payroll_runs|advances|sweater_collections|sweater_owner_collection_confirmations|sweater_settlements)\//.test(path))).toBe(false);
  });
  it('replay, a new batch, and a numeric-prefix alias cannot add a second wash or commission', async () => {
    const db = syncDb(), p = execution(); await save(db, p);
    expect((await save(db, p)).replay).toBe(true);
    await save(db, { ...p, importRunId: 'synthetic-repeat' });
    await save(db, { ...p, importRunId: 'synthetic-prefix', records: [{ ...p.records[0], sspBookingId: 'S-990001' }] });
    expect(washes(db)).toHaveLength(1);
    expect(payroll(db).totals.commissions).toBe(4.5);
  });
  it.each([
    r => { delete r.completedAt; }, r => { delete r.startedAt; },
    r => { r.rawStatus = 'Approved'; r.rawPaymentStatus = 'Recorded'; },
    r => { r.rawStatus = 'Cancelled by Admin'; }, r => { r.rawStatus = 'Washing Started'; },
    r => { delete r.serviceType; }, r => { r.serviceType = 'polish'; },
    r => { delete r.driverExternalId; }, r => { r.completedAt = '2026-10-08'; },
    r => { r.completedAt = '2026-10-08T09:00:00+03:00'; },
    r => { r.completedAt = '2026-10-09T01:00:00+03:00'; },
    r => { r.completedAt = '2026-10-08T10:30:00'; },
  ])('does not create execution/commission from incomplete, cancelled, ambiguous, or non-wash evidence', async mutate => {
    const db = syncDb(), p = execution(); mutate(p.records[0]);
    expect((await save(db, p)).washesCreated).toBe(0);
    expect(washes(db)).toEqual([]);
    expect(payroll(db).totals.commissions).toBe(0);
  });
  it('preserves the original service date across midnight and corporate coverage remains explicit', async () => {
    const db = syncDb(), p = execution();
    p.coverage.extractedAt = '2026-10-09T00:15:00+03:00';
    Object.assign(p.records[0], { startedAt: '2026-10-08T23:45:00+03:00', completedAt: '2026-10-09T00:10:00+03:00' });
    expect((await save(db, p)).washesCreated).toBe(1);
    expect(washes(db)[0].wash_date).toBe('2026-10-08');
    expect((await operationsStatus(db, p)).coverage.modules).toEqual({ individual: 'complete', corporate: 'unavailable' });
  });
  it.each(['washes', 'sweater_owner_collection_confirmations', 'sweater_operational_wash_links', 'sweater_booking_links'])('does not overwrite protected/manual %s records or double their commission', async name => {
    const db = syncDb(), p = execution();
    const original = { ssp_booking_id: 'S-990001', sspBookingId: 'S-990001', washId: 'manual', postedEntryId: 'synthetic-protected' };
    db.rows.set(`${name}/manual`, structuredClone(original));
    expect((await save(db, p)).washesCreated).toBe(0);
    expect(db.rows.get(`${name}/manual`)).toEqual(original);
    expect(db.rows.has('washes/ssp__C-990001')).toBe(false);
  });
  it('detects financial tampering in wash readback without confusing it with missing raw persistence', async () => {
    const db = syncDb(), p = execution(); await save(db, p);
    db.rows.get('washes/ssp__C-990001').price = 999;
    expect(await operationsStatus(db, p)).toMatchObject({ verified: false, rawVerified: true, linksVerified: false });
  });
  it.each([
    ['accounting_periods/2026-10', { status: 'closed' }],
    ['sweater_settlements/2026-10', { status: 'approved', journalEntryId: 'synthetic-posting' }],
    ['sweater_owner_booking_claims/990001', { sspBookingId: 'C-990001', washId: 'other', source: 'staff_owner_confirmation' }],
    ['washes/ssp__C-990001', { ssp_booking_id: 'S-880002', status: 'مكتملة', quantity: 1 }],
  ])('preserves financial closure/claim/document collision at %s', async (path, row) => {
    const db = syncDb(), p = execution(); db.rows.set(path, structuredClone(row));
    expect((await save(db, p)).washesCreated).toBe(0);
    expect(db.rows.get(path)).toEqual(row);
    expect(db.writes).not.toContain(path);
  });
  it('can complete a previously raw-only observation without overwriting its raw history', async () => {
    const db = syncDb(), p = execution(); const missing = structuredClone(p); delete missing.records[0].completedAt;
    await save(db, missing); const historicalRaw = structuredClone([...db.rows.entries()].filter(([key]) => key.startsWith('sweater_raw_payloads/')));
    p.importRunId = 'synthetic-evidenced-completion';
    expect((await save(db, p)).washesCreated).toBe(1);
    for (const [key, value] of historicalRaw) expect(db.rows.get(key)).toEqual(value);
    expect(await operationsStatus(db, p)).toMatchObject({ verified: true });
  });
  it('does not guess prices from source payment/discounts or overwrite execution on later cancellation', async () => {
    const db = syncDb(), p = execution(); Object.assign(p.records[0], { platformAmount: 199, customerDiscount: 99, rawPaymentStatus: 'Recorded' });
    await save(db, p); const original = structuredClone(washes(db)[0]);
    expect(original).toMatchObject({ price: 20, vat_amount: 3, collection_status: 'pending' });
    p.importRunId = 'synthetic-later-cancelled'; p.records[0].rawStatus = 'Cancelled by Admin';
    expect((await save(db, p)).rows[0].reasonCode).toBe('protected_existing_record');
    expect(washes(db)[0]).toEqual(original); expect(payroll(db).totals.commissions).toBe(4.5);
  });
});
