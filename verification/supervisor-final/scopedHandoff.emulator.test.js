import { afterAll, beforeAll, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { previewOwnerHandoff, saveOwnerHandoff } from '../functions/src/sweater/staffHandoff.js';
import { ACCOUNT_BOOKINGS_SCOPE_WARNING } from '../src/lib/sweater/handoff.js';

const projectId = 'demo-supervisor-scoped-handoff';
let app; let db;
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
    || process.env.GCLOUD_PROJECT !== 'demo-sweater') throw new Error('Local demo emulator required');
  app = initializeApp({ projectId }, 'scoped-handoff-final-check');
  db = getFirestore(app);
  const response = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Cannot clear isolated test project');
  await db.collection('bikers').doc('synthetic-worker').set({ name: 'Synthetic worker', salary: 900 });
});
afterAll(async () => { await db?.terminate(); if (app) await deleteApp(app); });

it('atomically saves a complete accountBookings scope once while retaining company gaps and creating no financial/payroll records', async () => {
  const payload = {
    importRunId: 'synthetic-final-account-scope',
    records: Array.from({ length: 7 }, (_, index) => ({ sspBookingId: `FINAL-SYNTHETIC-${index}`,
      driverExternalId: 'synthetic-ssp-worker', serviceDate: '2026-10-03',
      serviceType: 'interior_exterior_wash', rawStatus: 'Collecting Payment' })),
    coverage: { rangeFrom: '2026-10-03', rangeTo: '2026-10-03', extractedAt: '2026-10-04T20:18:00Z',
      pageCount: 1, pagesFetched: 1, recordCount: 7, scope: 'accountBookings', scopeComplete: true,
      sourceRecordCount: 10, excludedCancelled: 3, imported: 7, isComplete: false },
    workerLinks: { 'synthetic-ssp-worker': 'synthetic-worker' },
    ownerConfirmation: { source: 'owner_statement', ownerName: 'Synthetic owner',
      statement: 'Synthetic test confirmation', unitAmount: 20, totalAmount: 140, vatAmount: null },
  };
  const preview = await previewOwnerHandoff(db, payload);
  expect(preview.canSave).toBe(true);
  expect(preview.coverage).toEqual(payload.coverage);
  expect(preview.reviewWarnings).toContain(ACCOUNT_BOOKINGS_SCOPE_WARNING);
  expect((await db.collection('washes').get()).size).toBe(0);
  const request = { payload, reviewedPayloadHash: preview.reviewedPayloadHash, previewStateHash: preview.previewStateHash };
  const results = await Promise.all(Array.from({ length: 3 }, () => saveOwnerHandoff(db, FieldValue, request, 'synthetic-actor')));
  expect(results.filter(result => !result.replay)).toHaveLength(1);
  for (const result of results) {
    expect(result).toMatchObject({ saved: true, ledgerPosted: false, payrollPaid: false, coverage: payload.coverage });
    expect(result.reviewWarnings).toContain(ACCOUNT_BOOKINGS_SCOPE_WARNING);
  }
  expect((await db.collection('washes').get()).size).toBe(7);
  expect((await db.collection('sweater_bookings').get()).size).toBe(7);
  const run = (await db.collection('sweater_import_runs').doc(payload.importRunId).get()).data();
  expect(run).toMatchObject({ status: 'completed_with_gaps', coverage: payload.coverage });
  expect((await db.collection('sweater_integration_state').doc('current').get()).data().lastCoverage).toEqual(payload.coverage);
  const replay = await saveOwnerHandoff(db, FieldValue, request, 'synthetic-actor');
  expect(replay).toMatchObject({ replay: true, coverage: { isComplete: false } });
  expect(replay.reviewWarnings).toContain(ACCOUNT_BOOKINGS_SCOPE_WARNING);
  expect((await db.collection('washes').get()).size).toBe(7);
  for (const collection of ['journal_entries', 'journal_lines', 'posting_locks', 'payroll_runs', 'monthly_worker_payments', 'sweater_collections']) {
    expect((await db.collection(collection).get()).size).toBe(0);
  }
}, 180000);
