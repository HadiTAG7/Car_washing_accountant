import { syncDb, syncFV, syncPayload, syncRequest } from './sweaterOperationsFixture.js';
// History as the writer of that time filed it (a booking per prefixed id); the later observation runs on today's writer.
import { previewOperations, saveOperations } from './legacyOperationsSync.js';
import { normalizeRecord, hashRecord, hashBody } from '../../src/sweater/record.js';

export async function seedUnconsumedCompletion() {
  const db = syncDb(), first = syncPayload(); first.importRunId = 'synthetic-initial-claim';
  first.coverage.extractedAt = '2026-10-08T09:00:00+03:00';
  Object.assign(first.records[0], { sspBookingId: 'B-990301', rawStatus: 'Initiated', serviceType: 'interior_exterior_wash' });
  const save = async p => saveOperations(db, syncFV, syncRequest(p, await previewOperations(db, p)), 'synthetic');
  await save(first);
  const old = structuredClone(first); old.importRunId = 'synthetic-old-completed';
  old.coverage.extractedAt = '2026-10-08T11:00:00+03:00';
  Object.assign(old.records[0], { rawStatus: 'Synthetic old unmapped final label',
    startedAt: '2026-10-08T10:00:00+03:00', completedAt: '2026-10-08T10:30:00+03:00' });
  await save(old);
  // Synthetic snapshot of the PRE-fix writer: literal completed was unknown,
  // its source and receipt were retained, and no application wash existed.
  // These fixture edits never execute against production or after a preview.
  old.records[0].rawStatus = 'completed'; const record = normalizeRecord(old.records[0]), hash = hashRecord(record);
  Object.assign(db.rows.get(`sweater_raw_payloads/${old.importRunId}__B-990301`), {
    rawPayload: structuredClone(old.records[0]), normalizedRecord: record, sourceHash: hash });
  Object.assign(db.rows.get('sweater_bookings/B-990301'), { record, sourceHash: hash });
  const run = db.rows.get(`sweater_import_runs/${old.importRunId}`);
  run.payloadHash = hashBody(old); run.bodyHash = hashBody(old.records); run.result.reviewedPayloadHash = hashBody(old);
  Object.assign(run.result.rows[0], { rawStatus: 'completed', sourceHash: hash });
  const current = structuredClone(old); current.importRunId = 'synthetic-genuine-later-observation';
  current.coverage.extractedAt = '2026-10-08T12:00:00+03:00';
  Object.assign(current.records[0], { sspBookingId: 'S-990301', rawStatus: 'Collecting Payment', notes: 'Synthetic later source observation' });
  return { db, first, old, current };
}
