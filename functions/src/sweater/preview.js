import { reviewSweaterHandoff } from '../../../src/lib/sweater/handoff.js';
import { ingestSweaterOperations, SweaterIngestError, COL } from './ingest.js';
import { hashBody } from './record.js';
import { previewOwnerHandoff } from './staffHandoff.js';

// Staff-only read path. A DB with writes disabled still supports this call.
export async function previewSweaterHandoff(db, payload, actor) {
  if (payload?.ownerConfirmation !== undefined) return previewOwnerHandoff(db, payload);
  const review = reviewSweaterHandoff(payload);
  if (!review.ready) throw new SweaterIngestError('ملف التسليم غير جاهز للمعاينة.', {
    details: { errors: review.errors, rows: review.rows.filter(row => row.problems.length) },
  });
  const input = review.payload;
  const previous = await db.collection(COL.RUNS).doc(input.importRunId).get();
  if (previous.exists && previous.data().bodyHash !== hashBody(input.records)) {
    throw new SweaterIngestError('importRunId مستخدم بسجلات مختلفة؛ استخدم معرّفاً جديداً.', { code: 'already-exists' });
  }
  const result = await ingestSweaterOperations(db, null, input, { dryRun: true, actor, source: 'coordinator_handoff' });
  return { ...result, reviewedPayloadHash: hashBody(input),
    previousRun: previous.exists ? { status: previous.data().status ?? null, sameRecords: true } : null,
    reviewWarnings: review.warnings, statusReviewRows: review.rows.filter(row => row.needsStatusReview).map(row => row.index) };
}
