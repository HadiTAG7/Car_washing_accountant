import { describe, expect, it } from 'vitest';
import { syncDb, syncFV, syncRequest } from './helpers/sweaterOperationsFixture.js';
import { operationsStatus, previewOperations, saveOperations } from '../src/sweater/operationsSync.js';
import { calculatePayrollPreview } from '../src/payroll.js';

// Fictional records in memory, scoped IDs deliberately match the approved
// exception. No live document/credential is used by these tests.
export const scopedPayload = (legacy = false) => ({
  contractVersion: 2, importRunId: legacy ? 'ops-20261011-oct10-210648' : 'synthetic-5596423-resolution', agentStatus: 'partial',
  coverage: { rangeFrom: '2026-10-10', rangeTo: '2026-10-10', extractedAt: '2026-10-11T05:43:10Z',
    pageCount: 1, pagesFetched: 1, recordCount: 1, isComplete: false,
    sourceUrl: 'https://ssp-portal.sweater.sa/bookings', modules: { individual: 'partial', corporate: 'unavailable' }, gaps: ['Synthetic isolated partial coverage'] },
  workerLinks: legacy ? {} : { '1986': 'KehSV5K73zkyWWEE8hE9' },
  records: [{ sspBookingId: legacy ? 'B-5596423' : 'S-5596423', bookingKind: 'individual',
    serviceDate: '2026-10-10', driverExternalId: '1986', driverName: 'Synthetic worker',
    rawStatus: legacy ? 'completed' : 'Collecting Payment', sourceUrl: 'https://ssp-portal.sweater.sa/bookings',
    ...(legacy ? {} : { serviceType: 'interior_exterior_wash', startedAt: '2026-10-10T22:42:00+03:00', completedAt: '2026-10-10T23:35:00+03:00' }) }],
});
export function scopedDb() {
  const db = syncDb(), collection = db.collection;
  db.collection = name => ({ ...collection(name), select: (...fields) => ({ get: async () => {
    const snap = await collection(name).get();
    return { docs: snap.docs.map(d => ({ id: d.id, data: () => {
      const original = d.data(), projected = {};
      for (const field of fields) {
        const parts = field.split('.'); let value = original;
        for (const part of parts) value = value?.[part];
        if (value === undefined) continue;
        let target = projected;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        target[parts.at(-1)] = value;
      }
      return projected;
    } })) };
  } }), where: (field, op, values) => ({ get: async () => {
    const snap = await collection(name).get();
    return { docs: snap.docs.filter(d => op === 'in' ? values.includes(d.data()[field]) : d.data()[field] === values) };
  } }) });
  db.rows.set('bikers/KehSV5K73zkyWWEE8hE9', { name: 'Synthetic worker', driver_external_id: '1986', salary: 900 });
  return db;
}
const save = async (db, payload) => saveOperations(db, syncFV, syncRequest(payload, await previewOperations(db, payload)), 'integration_ingest');
const seeded = async () => { const db = scopedDb(); await save(db, scopedPayload(true)); db.writes.length = 0; return db; };
const allWashes = db => [...db.rows.entries()].filter(([path]) => path.startsWith('washes/')).map(([path, value]) => ({ id: path.slice(7), ...value }));

describe('Hadi approved single raw-only B/S5596423 reconciliation', () => {
  it('previews the full guard decision without writes, then retains B/raw/claim and creates precisely one reserved-ID wash', async () => {
    const db = await seeded(), payload = scopedPayload();
    for (let i = 0; i < 24; i++) db.rows.set(`washes/synthetic-other-${i}`, { ssp_booking_id: `S-${880000 + i}`, quantity: 1, status: 'مكتملة', biker_id: 'other', price: 20 });
    const originals = structuredClone([...db.rows.entries()]);
    const p = await previewOperations(db, payload);
    expect(p.rows[0]).toMatchObject({ reasonCode: null, washCreated: false, washId: 'ssp__B-5596423',
      identityResolution: { eligible: true, resolutionSaved: false, legacyBookingId: 'B-5596423', currentBookingId: 'S-5596423', claimPreserved: true } });
    expect(db.writes).toEqual([]);
    const result = await saveOperations(db, syncFV, syncRequest(payload, p), 'integration_ingest');
    expect(result.rows[0].identityResolution.resolutionSaved).toBe(true);
    expect(result).toMatchObject({ washesCreated: 1, ledgerPosted: false, payrollPaid: false });
    for (const [path, value] of originals) {
      if (path !== 'sweater_integration_state/current') expect(db.rows.get(path)).toEqual(value);
    }
    const wash = db.rows.get('washes/ssp__B-5596423');
    expect(wash).toMatchObject({ ssp_booking_id: 'S-5596423', wash_date: '2026-10-10', biker_id: 'KehSV5K73zkyWWEE8hE9',
      quantity: 1, price: 20, net_amount: 20, gross_amount: 23, vat_amount: 3,
      collection_status: 'pending', payment_method: null, worker_commission_per_wash: 4.5, worker_commission_paid: false });
    const payroll = calculatePayrollPreview({ periodKey: '2026-10', now: new Date('2026-10-11T06:00:00Z'),
      bikers: [{ id: 'KehSV5K73zkyWWEE8hE9', name: 'Synthetic worker', salary: 900, start_date: '2026-10-01' }], washes: allWashes(db) });
    expect(payroll.totals.commissions).toBe(4.5);
    expect(await operationsStatus(db, payload)).toMatchObject({ verified: true, result: { washesCreated: 1 } });
    expect(db.writes.some(path => /^(journal_entries|posting_locks|transactions|sweater_collections|payroll_runs|sweater_settlements|sweater_owner_collection_confirmations)\//.test(path))).toBe(false);
  });
  it('lost response/replay/concurrent runs never produce a second wash or change the natural claim', async () => {
    const db = await seeded(), a = scopedPayload(), b = { ...a, importRunId: 'synthetic-competing-resolution' };
    const originalClaim = structuredClone(db.rows.get('sweater_owner_booking_claims/5596423'));
    const [pa, pb] = await Promise.all([previewOperations(db, a), previewOperations(db, b)]);
    const results = await Promise.allSettled([saveOperations(db, syncFV, syncRequest(a, pa), 'integration_ingest'), saveOperations(db, syncFV, syncRequest(b, pb), 'integration_ingest')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await save(db, a)).replay).toBe(true);
    expect(await operationsStatus(db, a)).toMatchObject({ verified: true });
    expect((await save(db, { ...a, importRunId: 'synthetic-after-timeout' })).washesCreated).toBe(0);
    expect(allWashes(db)).toHaveLength(1);
    expect(db.rows.get('sweater_owner_booking_claims/5596423')).toEqual(originalClaim);
  });
  it.each([
    ['wash', db => db.rows.set('washes/existing', { ssp_booking_id: 'B-5596423', quantity: 1 })],
    ['owner', db => db.rows.set('sweater_owner_collection_confirmations/existing', { evidence: { sspBookingId: 'B-5596423' } })],
    ['ledger', db => db.rows.set('journal_entries/existing', { sourceId: 'ssp__B-5596423', status: 'posted' })],
    ['reversed ledger', db => db.rows.set('journal_entries/existing', { sourceId: null, reversedSourceId: 'ssp__B-5596423', status: 'posted' })],
    ['posting lock', db => db.rows.set('posting_locks/existing', { sourceId: 'ssp__S-5596423' })],
    ['adjustment', db => db.rows.set('sweater_adjustments/existing', { sspBookingId: 'B-5596423' })],
    ['collection', db => db.rows.set('sweater_collections/existing', { sspBookingId: 'S-5596423' })],
    ['approved settlement', db => db.rows.set('sweater_settlements/2026-10', { status: 'approved' })],
    ['nested settlement', db => db.rows.set('sweater_settlements/2026-10', { totals: { postedEntryId: 'protected' } })],
    ['closed period', db => db.rows.set('accounting_periods/2026-10', { status: 'closed' })],
    ['unknown period', db => db.rows.set('accounting_periods/2026-10', { status: 'pending-close' })],
    ['nested booking lock', db => { db.rows.get('sweater_bookings/B-5596423').meta = { financialLock: true }; }],
    ['owner booking evidence', db => { db.rows.get('sweater_bookings/B-5596423').ownerCompletionDecision = { approved: true }; }],
    ['nested claim effect', db => { db.rows.get('sweater_owner_booking_claims/5596423').meta = { journalEntryId: 'protected' }; }],
    ['wrong old date', db => { db.rows.get('sweater_bookings/B-5596423').record.serviceDate = '2026-10-09'; }],
    ['wrong old worker', db => { db.rows.get('sweater_bookings/B-5596423').record.driverExternalId = '1989'; }],
    ['wrong claim wash', db => { db.rows.get('sweater_owner_booking_claims/5596423').washId = 'manual'; }],
    ['no claim', db => db.rows.delete('sweater_owner_booking_claims/5596423')],
    ['legacy and claim missing', db => { db.rows.delete('sweater_owner_booking_claims/5596423'); db.rows.delete('sweater_bookings/B-5596423'); }],
    ['reserved wash collision', db => db.rows.set('washes/ssp__B-5596423', { ssp_booking_id: 'S-other' })],
    ['third prefix manual wash', db => db.rows.set('washes/manual', { ssp_booking_id: 'C-5596423', postedEntryId: 'protected' })],
    ['third prefix owner evidence', db => db.rows.set('sweater_owner_collection_confirmations/manual', { evidence: { sspBookingId: 'C-5596423' } })],
    ['third prefix booking', db => db.rows.set('sweater_bookings/C-5596423', { sspBookingId: 'C-5596423' })],
    ['orphan third prefix operational link', db => db.rows.set('sweater_operational_wash_links/b__C-5596423', {})],
    ['orphan third prefix financial link', db => db.rows.set('sweater_booking_links/w__ssp__C-5596423', { postedEntryId: 'protected' })],
    ['arbitrary established prefix', db => db.rows.set('washes/manual', { ssp_booking_id: 'LEGACY-5596423' })],
    ['orphan third prefix ledger', db => db.rows.set('journal_entries/manual', { sourceId: 'ssp__C-5596423' })],
    ['nested other prefix transaction', db => db.rows.set('transactions/manual', { source: { ref: { sspBookingId: 'Z-5596423' } } })],
    ['other prefix posting lock', db => db.rows.set('posting_locks/manual', { sourceId: 'Y-5596423' })],
    ['numeric nested booking collection', db => db.rows.set('sweater_collections/manual', { source: { booking_number: 5596423 } })],
    ['other prefix adjustment', db => db.rows.set('sweater_adjustments/manual', { sourceRef: 'C-5596423' })],
  ])('fails closed and leaves all protected originals untouched: %s', async (_label, mutate) => {
    const db = await seeded(); mutate(db); const before = structuredClone([...db.rows.entries()]);
    const r = await save(db, scopedPayload());
    expect(r.rows[0]).toMatchObject({ reasonCode: 'protected_existing_record', bookingSaved: false, washCreated: false,
      identityResolution: { eligible: false, resolutionSaved: false } });
    for (const [path, value] of before) {
      if (path !== 'sweater_integration_state/current') expect(db.rows.get(path)).toEqual(value);
    }
    expect(db.rows.has('sweater_bookings/S-5596423')).toBe(false);
  });
  it.each([
    p => { p.records[0].sspBookingId = 'S-5596424'; }, p => { p.records[0].serviceDate = '2026-10-09'; },
    p => { p.records[0].driverExternalId = '1989'; }, p => { p.records[0].completedAt = '2026-10-10T23:36:00+03:00'; },
    p => { p.records.push({ ...p.records[0], sspBookingId: 'S-other' }); p.coverage.recordCount = 2; },
  ])('does not generalize the approval to another scope/evidence/batch', async mutate => {
    const db = await seeded(), p = scopedPayload(); mutate(p);
    if (p.records[0].sspBookingId === 'S-5596424') {
      const old = structuredClone(db.rows.get('sweater_bookings/B-5596423'));
      old.sspBookingId = 'B-5596424'; old.record.sspBookingId = 'B-5596424';
      db.rows.set('sweater_bookings/B-5596424', old);
    }
    const r = await save(db, p);
    expect(r.rows[0].washCreated).not.toBe(true);
    expect(db.rows.has('washes/ssp__B-5596423')).toBe(false);
  });
  it('CAS notices a newly introduced ledger effect after preview and writes nothing', async () => {
    const db = await seeded(), p = scopedPayload(), preview = await previewOperations(db, p);
    db.rows.set('journal_entries/newly-posted', { sourceId: 'B-5596423', status: 'posted' });
    await expect(saveOperations(db, syncFV, syncRequest(p, preview), 'integration_ingest')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(db.writes).toEqual([]);
  });
});
