// Stores one signed reading of Sweater's Metabase numbers (metricsContract.js).
// Each reading is its own row, keyed by the agent's run id, and never rewritten:
// the latest reading of a month is what the overview shows, with its time.
import { hashBody } from './record.js';
import { SweaterIngestError } from './ingest.js';
import { METRICS_COL, MetricsContractError, validateMetricsSnapshot } from './metricsContract.js';

const CLOCK_SKEW_MS = 5 * 60_000;

/** The contract, as the operations endpoint reports refusals (400, not 500). */
export function checkMetricsSnapshot(payload) {
  try { return validateMetricsSnapshot(payload); }
  catch (error) { if (error instanceof MetricsContractError) throw new SweaterIngestError(error.message); throw error; }
}

/**
 * Saves the reading once. The same run id with the same body answers as
 * already stored (a retry after a lost response); with a different body it
 * is refused, so a reading is never silently replaced.
 */
export async function saveMetricsSnapshot(db, FieldValue, payload, { keyId, nowMs = Date.now() }) {
  checkMetricsSnapshot(payload);
  if (Date.parse(payload.extractedAt) > nowMs + CLOCK_SKEW_MS) {
    throw new SweaterIngestError('وقت القراءة في المستقبل؛ تحقّق من ساعة الوكيل.');
  }
  const payloadHash = hashBody(payload);
  const ref = db.collection(METRICS_COL).doc(payload.importRunId);
  const extractedAtIso = new Date(Date.parse(payload.extractedAt)).toISOString();
  const answer = stored => ({ snapshotId: payload.importRunId, periodKey: payload.periodKey, extractedAtIso, payloadHash, stored });
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      if (snap.data().payloadHash !== payloadHash) {
        throw new SweaterIngestError('معرّف اللقطة مستخدم بأرقام مختلفة؛ أرسل القراءة الجديدة بمعرّف جديد.', { code: 'already-exists' });
      }
      return answer(false);
    }
    tx.set(ref, {
      contractVersion: payload.contractVersion, periodKey: payload.periodKey, extractedAtIso, sourceUrl: payload.sourceUrl,
      payloadHash, keyId, metrics: payload.metrics,
      ...(Object.hasOwn(payload, 'tipsByBiker') ? { tipsByBiker: payload.tipsByBiker } : {}),
      ...(Object.hasOwn(payload, 'deductionDetails') ? { deductionDetails: payload.deductionDetails } : {}),
      ...(Object.hasOwn(payload, 'countDetails') ? { countDetails: payload.countDetails } : {}),
      receivedAt: FieldValue.serverTimestamp(), receivedAtIso: new Date(nowMs).toISOString(),
    });
    return answer(true);
  });
}
