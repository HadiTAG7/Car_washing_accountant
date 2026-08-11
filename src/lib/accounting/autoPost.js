// ═══════════════════════════════════════════════════════════════════════════
// الترحيل التلقائي عند الاعتماد — posting at the approval moment
// ═══════════════════════════════════════════════════════════════════════════
// Posting stays a decision, not a save side-effect. What this adds is that
// the decision can be expressed where it is actually made: the moment a wash
// is marked مكتملة, or an expense is marked مسدَّد. That transition IS the
// approval, and posting it then is what keeps the books current instead of
// waiting for someone to remember the sweep.
//
// Three properties make it safe to fire from a UI action:
//
//   1. It fires on a TRANSITION into the approved state, not on every save.
//      An operator editing a completed wash three times must not mint three
//      entries.
//   2. It runs the same guards as the manual sweep — same adapters, same
//      idempotency on `sourceType + sourceId`, same closed-period check — so
//      the two paths can never disagree about what a record becomes.
//   3. It never throws. The operational save already succeeded; tearing down
//      the UI action because the ledger hiccuped would lose the user's work.
//      It returns a result the caller MUST surface — a swallowed posting
//      failure is how books quietly go stale.
//
// The record is RE-READ from Firestore before posting, so what lands in the
// ledger is what was actually stored, not what the client believed it sent.
// ═══════════════════════════════════════════════════════════════════════════

import { getRow } from '../firestoreCrud';
import { postEntry, hasPostedEntryFor, fetchEntries, fetchPeriods } from './firestoreLedger';
import { ADAPTERS, adapterFor, AUTO_POSTABLE_KINDS } from './sourceAdapters';
import { isPeriodClosed, indexPeriods } from './periods';
import { periodKeyOf } from './journal';

export { AUTO_POSTABLE_KINDS };

export const AUTO_POST_RESULTS = ['posted', 'skipped', 'failed'];

/**
 * Did this save move the record INTO the approved state?
 *
 * Pure, and deliberately strict: already-approved → still approved is not a
 * transition, so re-saving a completed wash does nothing.
 */
export function transitionedToApproved(kind, before, after) {
  const a = ADAPTERS[kind];
  if (!a) return false;
  const was = before ? Boolean(a.isApproved(before)) : false;
  return !was && Boolean(a.isApproved(after));
}

/** Arabic one-liner for a result, ready to drop into a toast. */
export function describeAutoPost(result) {
  if (!result) return '';
  switch (result.status) {
    case 'posted':
      return `تم الترحيل تلقائياً إلى الدفاتر — قيد رقم ${result.entryNumber}.`;
    case 'skipped':
      return result.reason || 'لم يُرحَّل.';
    case 'failed':
      return `تعذّر الترحيل التلقائي: ${result.error} — استخدم «إقفال الفترة ← ترحيل» بعد المعالجة.`;
    default:
      return '';
  }
}

/** A failure or a blocking skip should be shown as a warning, not a success. */
export function autoPostTone(result) {
  if (!result) return 'info';
  if (result.status === 'failed') return 'error';
  if (result.status === 'skipped') return result.blocking ? 'error' : 'info';
  return 'success';
}

/**
 * Posts one approved record. Never throws.
 *
 * Returns:
 *   { status: 'posted',  entryId, entryNumber }
 *   { status: 'skipped', reason, blocking }   blocking → the user should act
 *   { status: 'failed',  error }
 */
export async function autoPost({
  kind, id, userId = null, vatRegistered = true, washPriceMode = 'inclusive', ctx = {},
}) {
  try {
    const a = adapterFor(kind);
    const row = await getRow(a.collection, id);
    if (!row) return { status: 'skipped', reason: 'السجل غير موجود.', blocking: false };

    if (!a.isApproved(row)) {
      return { status: 'skipped', reason: a.notApprovedReason || 'غير معتمد بعد.', blocking: false };
    }

    const sourceId = a.sourceId(row);
    const [entries, periods] = await Promise.all([fetchEntries(), fetchPeriods()]);
    if (hasPostedEntryFor(entries, a.sourceType, sourceId)) {
      // Not an error: the sweep or an earlier approval already did it.
      return { status: 'skipped', reason: 'مُرحّل مسبقاً.', blocking: false };
    }

    const date = a.dateOf(row);
    const periodKey = periodKeyOf(date);
    if (!periodKey) {
      return { status: 'skipped', reason: 'السجل بلا تاريخ صالح — لم يُرحَّل.', blocking: true };
    }
    if (isPeriodClosed(periodKey, indexPeriods(periods))) {
      return {
        status: 'skipped', blocking: true,
        reason: `الفترة ${periodKey} مقفلة — لم يُرحَّل. سجّل التصحيح بقيد في فترة مفتوحة.`,
      };
    }

    const built = a.build(row, { vatRegistered, washPriceMode, ...ctx });
    const res = await postEntry(built, { userId });
    return { status: 'posted', entryId: res.entryId, entryNumber: res.entryNumber };
  } catch (e) {
    return { status: 'failed', error: e?.message || String(e), blocking: true };
  }
}

/**
 * Runs `autoPost` only when the save was an approval transition. This is the
 * function a page calls after a successful write.
 */
export async function autoPostOnApproval({ kind, id, before, after, ...opts }) {
  if (!transitionedToApproved(kind, before, after)) return null;
  return autoPost({ kind, id, ...opts });
}

/**
 * Warns when a record the user is about to edit is already in the books.
 *
 * A posted entry is immutable, so an edit to its source record changes the
 * operational row and leaves the ledger untouched — the two then disagree
 * silently, which is worse than refusing. Returns an Arabic warning or null.
 */
export function editWarningFor(kind, record, entries) {
  const a = ADAPTERS[kind];
  if (!a || !record) return null;
  if (!hasPostedEntryFor(entries || [], a.sourceType, a.sourceId(record))) return null;
  return 'هذا السجل مُرحّل إلى الدفاتر. التعديل هنا لا يغيّر القيد المُرحّل — '
       + 'صحّح بقيد عكسي أو قيد تسوية من صفحة دفتر الأستاذ.';
}
