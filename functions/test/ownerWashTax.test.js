import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/handlers.js';
import { previewOwnerWashTax, saveOwnerWashTax } from '../src/sweater/ownerWashTax.js';
import { OWNER_WASH_TAX_PLAN as PLAN } from '../../src/lib/sweater/ownerWashTaxPlan.js';
import { mapWash } from '../../src/lib/mappers.js';
import { ownerWashTaxSplit } from '../../src/lib/sweater/ownerWashTax.js';

function fixture(role = 'admin') {
  const rows = new Map([['users/staff', { role }], ['washes/unrelated', { price: 99, vat_amount: null }]]); const writes = [];
  for (const [id, date] of PLAN.bookings) {
    rows.set(`washes/ssp__${id}`, { ssp_booking_id: id, wash_date: date, quantity: 1, price: 20, vat_amount: null,
      biker_id: 'synthetic-worker', biker_name: 'Synthetic worker', worker_commission_per_wash: 4.5,
      revenue_origin: 'sweater', status: 'مكتملة', collection_status: 'confirmed_by_owner', payment_method: null });
    rows.set(`sweater_owner_collection_confirmations/${id}`, { assertedAmount: 20, quantity: 1, collectionStatus: 'confirmed_by_owner', vatAmount: null });
    rows.set(`sweater_bookings/${id}`, { sspBookingId: id, record: { serviceDate: date, rawStatus: 'Collecting Payment' } });
  }
  const snap = path => ({ id: path.split('/').at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const ref = path => ({ id: path.split('/').at(-1), path, get: async () => snap(path) }); let queue = Promise.resolve();
  const db = { rows, writes, collection: name => ({ doc: id => ref(`${name}/${id}`), where: (field, _op, value) => ({
    get: async () => ({ docs: [...rows.keys()].filter(path => path.startsWith(`${name}/`) && rows.get(path)[field] === value).map(snap) }),
  }) }), runTransaction: callback => {
    const run = queue.then(async () => { const pending = [];
      const result = await callback({ get: r => r.get(), set: (r, value, options) => pending.push([r.path, value, options]) });
      for (const [path, value, options] of pending) { rows.set(path, options?.merge ? { ...rows.get(path), ...structuredClone(value) } : structuredClone(value)); writes.push(path); }
      return result;
    }); queue = run.catch(() => {}); return run;
  } }; return db;
}
const FV = { serverTimestamp: () => 'synthetic-server-time' };
describe('the twelve owner-authorized net-price clarifications', () => {
  it('previews without writes; atomically separates 240/36/276 without changing prices, identities, dates or evidence', async () => {
    const db = fixture(); const before = structuredClone([...db.rows.entries()]); const preview = await previewOwnerWashTax(db);
    expect(preview).toMatchObject({ count: 12, totals: { net: 240, vat: 36, gross: 276 }, dryRun: true }); expect(db.writes).toEqual([]);
    const result = await saveOwnerWashTax(db, FV, { previewHash: preview.previewHash }, 'staff');
    expect(result).toMatchObject({ saved: true, updated: 12, ledgerPosted: false, invoiceIssued: false });
    expect(db.writes).toHaveLength(13);
    for (const [path, row] of before) {
      const actual = db.rows.get(path);
      if (path.startsWith('washes/ssp__')) {
        const original = { ...row }; delete original.vat_amount;
        expect(actual).toMatchObject(original); expect(actual.vat_amount).toBe(3);
      } else expect(actual).toEqual(row);
    }
  });
  it('keeps originals and payroll facts, writes only the approved washes plus one audit, and makes retries write zero', async () => {
    const db = fixture(); const before = structuredClone([...db.rows.entries()]); const p = await previewOwnerWashTax(db);
    const results = await Promise.all([saveOwnerWashTax(db, FV, { previewHash: p.previewHash }, 'staff'), saveOwnerWashTax(db, FV, { previewHash: p.previewHash }, 'staff')]);
    expect(results.map(r => r.replay)).toEqual([false, true]); expect(db.writes).toHaveLength(13);
    for (const [path, row] of before) {
      const actual = db.rows.get(path);
      if (path.startsWith('washes/ssp__')) {
        const original = { ...row }; delete original.vat_amount;
        expect(actual).toMatchObject(original); expect(actual.vat_amount).toBe(3);
        expect(ownerWashTaxSplit(mapWash({ id: path.split('/').at(-1), ...actual }))).toEqual({ net: 20, vat: 3, gross: 23 });
      } else expect(actual).toEqual(row);
    }
    expect(db.writes.every(path => PLAN.bookings.some(([id]) => path === `washes/ssp__${id}`) || path === `sweater_owner_tax_clarifications/${PLAN.id}`)).toBe(true);
    expect((await previewOwnerWashTax(db)).rows.every(row => row.already)).toBe(true);
  });
  it.each([
    ['missing source', db => db.rows.delete(`sweater_bookings/${PLAN.bookings[0][0]}`)],
    ['wrong price', db => { db.rows.get(`washes/ssp__${PLAN.bookings[0][0]}`).price = 23; }],
    ['existing tax', db => { db.rows.get(`washes/ssp__${PLAN.bookings[0][0]}`).vat_amount = 2; }],
    ['closed period', db => db.rows.set('accounting_periods/2026-10', { status: 'closed' })],
    ['posted settlement', db => db.rows.set('sweater_settlements/2026-10', { journalEntryId: 'synthetic' })],
    ['posted wash', db => db.rows.set('journal_entries/posted', { sourceId: `ssp__${PLAN.bookings[0][0]}`, status: 'posted' })],
  ])('rejects %s with no writes', async (_name, mutate) => {
    const db = fixture(); mutate(db); await expect(previewOwnerWashTax(db)).rejects.toMatchObject({ code: 'failed-precondition' }); expect(db.writes).toEqual([]);
  });
  it('stale preview writes nothing', async () => {
    const db = fixture(); const p = await previewOwnerWashTax(db); db.rows.get(`washes/ssp__${PLAN.bookings[0][0]}`).biker_name = 'Changed';
    await expect(saveOwnerWashTax(db, FV, { previewHash: p.previewHash }, 'staff')).rejects.toMatchObject({ code: 'failed-precondition' }); expect(db.writes).toEqual([]);
  });
  it.each(['supervisor', 'operator', 'partner', 'integration_ingest'])('does not authorize %s', async role => {
    const db = fixture(role);
    await expect(dispatch(db, FV, 'sweaterPreviewOwnerWashTax', {}, { uid: 'staff' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.writes).toEqual([]);
  });
});
