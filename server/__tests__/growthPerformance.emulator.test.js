import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readGrowthPerformance } from '../growthPerformance.js';

// Real query verification, isolated from both production and other test data.
const enabled = /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '');
describe.skipIf(!enabled)('growth real Firestore queries (demo only)', () => {
  let app, db;
  const refs = ['users/growth-admin', 'users/growth-partner', 'bikers/growth-worker',
    'washes/growth-wash', 'sweater_bookings/growth-booking', 'sweater_import_runs/growth-run'];
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-sweater-growth' }, `growth-${Date.now()}`);
    db = getFirestore(app);
    await Promise.all([
      db.doc(refs[0]).set({ role: 'admin' }), db.doc(refs[1]).set({ role: 'partner' }),
      db.doc(refs[2]).set({ driver_external_id: '1984', name: 'Synthetic worker', salary: 999, contact_number: 'PRIVATE' }),
      db.doc(refs[3]).set({ biker_id: 'growth-worker', driver_external_id: '1984', wash_date: '2026-10-17', quantity: 1, status: 'completed', ssp_booking_id: 'growth-booking' }),
      db.doc(refs[4]).set({ sspBookingId: 'growth-booking', serviceDate: '2026-10-17', operationalWorkerId: 'growth-worker',
        record: { bookingKind: 'individual', driverExternalId: '1984', normalizedStatus: 'payment_collection',
          startedAt: '2026-10-17T12:00:00+03:00', completedAt: '2026-10-17T13:00:00+03:00', customerName: 'PRIVATE' } }),
      db.doc(refs[5]).set({ status: 'completed_with_gaps', coverage: { rangeFrom: '2026-10-16', rangeTo: '2026-10-19',
        pageCount: 2, pagesFetched: 2, modules: { individual: 'complete', corporate: 'partial' } } }),
    ]);
  });
  afterAll(async () => {
    if (db) { await Promise.all(refs.map(path => db.doc(path).delete())); await db.terminate(); }
    if (app) await deleteApp(app);
  });
  it('reads real bounded/projection queries and overlapping coverage, preserving zero and privacy', async () => {
    const result = await readGrowthPerformance(db, { uid: 'growth-admin' }, { from: '2026-10-17', to: '2026-10-17' });
    expect(result.workers).toHaveLength(7);
    expect(result.workers.find(w => w.code === '1984').days.at(-1)).toMatchObject({ count: 1, coverage: 'complete', workEligible: true });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|"salary"|"contact_number"|"customerName"/);
    expect((await db.doc('washes/growth-wash').get()).data().status).toBe('completed');
  });
  it('refuses an actual partner membership before returning performance', async () => {
    await expect(readGrowthPerformance(db, { uid: 'growth-partner' }, { from: '2026-10-17', to: '2026-10-17' }))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('resolves an existing worker through consistent wash UID evidence, without updating the worker', async () => {
    await db.doc('bikers/growth-worker').update({ driver_external_id: FieldValue.delete() });
    try {
      const result = await readGrowthPerformance(db, { uid: 'growth-admin' }, { from: '2026-10-17', to: '2026-10-17' });
      expect(result.workers.find(w => w.code === '1984')).toMatchObject({ id: 'growth-worker', name: 'Synthetic worker' });
      expect((await db.doc('bikers/growth-worker').get()).data().driver_external_id).toBeUndefined();
    } finally { await db.doc('bikers/growth-worker').update({ driver_external_id: '1984' }); }
  });
});
