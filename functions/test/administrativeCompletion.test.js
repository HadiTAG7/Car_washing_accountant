import { describe, expect, it } from 'vitest';
import { reviewAdministrativeCompletion } from '../../src/lib/sweater/administrativeCompletion.js';
import { completionFixture } from './administrativeCompletionFixture.js';
import { previewAdministrativeCompletion } from '../src/sweater/administrativeCompletion.js';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
describe('bounded administrative completion contract', () => {
  it('keeps original cancellations and actual/missing start/end evidence without a collection assertion', () => {
    const p = completionFixture(), copy = structuredClone(p), r = reviewAdministrativeCompletion(p);
    expect(r.ready).toBe(true); expect(r.payload).toEqual(copy);
    expect(r.rows).toHaveLength(4); expect(p.records.every(row => row.completedAt === null)).toBe(true);
    expect(r.payload.ownerConfirmation).toBeUndefined();
  });
  it.each([
    p => { p.records[0].sspBookingId = 'C-990005'; p.decision.bookingIds[0] = 'C-990005'; },
    p => { p.records.push({ ...p.records[0], sspBookingId: 'S-990001' }); p.decision.bookingIds.push('S-990001'); p.coverage.recordCount++; },
    p => { p.decision.messageId = ''; }, p => { p.decision.approved = false; },
    p => { p.records[0].rawStatus = 'Collecting Payment'; }, p => { p.coverage.isComplete = true; },
    p => { p.records[0].payment_method = 'cash'; }, p => { p.ownerConfirmation = { collectionStatus: 'confirmed_by_owner' }; },
    p => { p.decision.bookingIds = []; }, p => { p.workerLinks['1982'] = '../other'; },
  ])('rejects excluded/duplicate/out-of-scope/forged financial inputs', mutate => {
    const p = completionFixture(); mutate(p); expect(reviewAdministrativeCompletion(p).ready).toBe(false);
  });
  it('server preview works on a database with writes disabled', async () => {
    const db = memoryFinanceDb({ 'users/admin': { role: 'admin' },
      'bikers/worker1': { name: 'Synthetic one', driver_external_id: '1982', start_date: '2026-08-01' },
      'bikers/worker2': { name: 'Synthetic two', driver_external_id: '2009', start_date: '2026-08-01' } });
    db.runTransaction = () => { throw new Error('No writes permitted in preview'); };
    const before = JSON.stringify([...db.rows]);
    const r = await previewAdministrativeCompletion(db, completionFixture(), 'admin');
    expect(r.canSave).toBe(true); expect(r.rows).toHaveLength(4);
    expect(r.rows.every(x => x.collectionStatus === 'pending' && x.workerCommission === 4.5 && x.assertedAmount === 20 && x.vatAmount === 3 && x.grossAmount === 23)).toBe(true);
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
});
