// ═══════════════════════════════════════════════════════════════════════════
// طبقة الترحيل على Firestore — atomic ledger writes
// ═══════════════════════════════════════════════════════════════════════════
// Every ledger mutation runs inside a Firestore TRANSACTION. The entry
// number, the period-closed check, the entry header, its lines and the audit
// record either all land or none do — a read-then-write from the client
// could interleave with another device and mint a duplicate entry number or
// post into a month that was closed a second earlier.
//
// Collections
//   chart_of_accounts    — one doc per account, doc id = account code
//   journal_entries      — header
//   journal_lines        — one doc per line, `entryId` points at the header
//   accounting_periods   — doc id = 'YYYY-MM'
//   audit_logs           — append-only trail
//   counters/journal     — { nextNumber } for sequential entry numbers
// ═══════════════════════════════════════════════════════════════════════════

import {
  collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp,
  deleteDoc,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebaseClient';
import { fetchRows } from '../firestoreCrud';
import {
  validateEntry, mutationBlockedReason, buildReversal, normalizeEntry, periodKeyOf,
} from './journal';
import { DEFAULT_CHART_OF_ACCOUNTS, validateChart } from './chartOfAccounts';
import { closePreflight } from './periods';

export const COL = {
  ACCOUNTS: 'chart_of_accounts',
  ENTRIES:  'journal_entries',
  LINES:    'journal_lines',      // legacy: frozen, read-only (see below)
  PERIODS:  'accounting_periods',
  AUDIT:    'audit_logs',
  COUNTERS: 'counters',
  LOCKS:    'posting_locks',
};
const JOURNAL_COUNTER = 'journal';

/**
 * Lines live INSIDE their entry document.
 *
 * They used to be their own collection, which left a hole no rule could
 * close: `journal_lines` create had to stay open for the posting transaction,
 * and Firestore rules evaluate a batch against the state BEFORE it, so a rule
 * like "the parent must be a draft" would have rejected the very write that
 * creates the entry. An accountant could therefore append a line to a posted
 * entry and silently unbalance it.
 *
 * Embedded, the invariant is structural instead of enforced: the entry is
 * written once, and the only update rules permit is the reversal transition
 * with `hasOnly(['status','reversedBy','reversedAt'])` — which cannot touch
 * `lines`. There is no separate document to append to.
 *
 * The old collection is kept readable so entries posted before this change
 * still render, and is frozen against create/update/delete in the rules.
 */
export function embeddedLinesOf(entry) {
  const rows = Array.isArray(entry?.lines) ? entry.lines : [];
  return rows.map((l, i) => ({ ...l, entryId: entry.id, id: `${entry.id}:${i}` }));
}

/** Lock id for a source record — `wash__abc123`. */
export function postingLockId(sourceType, sourceId) {
  return `${sourceType}__${sourceId}`;
}

function requireDb() {
  if (!isFirebaseConfigured) throw new Error('Firebase غير مُهيّأ — لا يمكن الترحيل.');
}

// ─── القراءة ─────────────────────────────────────────────────────────────
export const fetchAccounts = () => fetchRows(COL.ACCOUNTS);
export const fetchEntries  = () => fetchRows(COL.ENTRIES);
export const fetchPeriods  = () => fetchRows(COL.PERIODS);
export const fetchLocks    = () => fetchRows(COL.LOCKS);

/**
 * Every line in the ledger: the ones embedded in entries, plus the legacy
 * collection for entries posted before lines moved inside. Both collections
 * are small, and hiding the seam here keeps every report on one shape.
 */
export async function fetchLines() {
  const [entries, legacy] = await Promise.all([fetchEntries(), fetchRows(COL.LINES)]);
  return entries.flatMap(embeddedLinesOf).concat(legacy);
}

/** Lines of one entry — used by the reversal flow and the entry detail view. */
export async function fetchLinesOf(entryId) {
  const snap = await getDoc(doc(db, COL.ENTRIES, entryId));
  if (snap.exists() && Array.isArray(snap.data().lines)) {
    return embeddedLinesOf({ id: snap.id, ...snap.data() });
  }
  const legacy = await getDocs(query(collection(db, COL.LINES), where('entryId', '==', entryId)));
  return legacy.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── سجل التدقيق ─────────────────────────────────────────────────────────
/**
 * Appends an audit record. Called INSIDE the caller's transaction so the log
 * cannot survive a rolled-back mutation, nor go missing after a successful
 * one. `before`/`after` are stored only for edits.
 */
function writeAuditInTx(tx, { action, collectionName, documentId, userId, before = null, after = null, note = '' }) {
  const ref = doc(collection(db, COL.AUDIT));
  tx.set(ref, {
    action,                       // create | update | post | reverse | void | close | seed
    collectionName,
    documentId: documentId ?? null,
    userId: userId ?? null,
    note,
    before,
    after,
    at: serverTimestamp(),
    atIso: new Date().toISOString(),
  });
  return ref.id;
}

// ─── الترحيل ─────────────────────────────────────────────────────────────
/**
 * Posts one balanced entry.
 *
 * Order matters inside a Firestore transaction: every read must happen before
 * the first write, so the counter and the period are read up front.
 *
 * Returns { entryId, entryNumber }. Throws an Arabic Error on any violation.
 */
export async function postEntry({ entry, lines }, { userId = null, knownAccountCodes = null } = {}) {
  requireDb();
  const normalized = normalizeEntry(entry, lines);
  const problems = validateEntry(normalized.entry, normalized.lines, { knownAccountCodes });
  if (problems.length) {
    const err = new Error(problems[0]);
    err.problems = problems;
    throw err;
  }

  return runTransaction(db, async (tx) => {
    // ── reads ──
    const counterRef = doc(db, COL.COUNTERS, JOURNAL_COUNTER);
    const counterSnap = await tx.get(counterRef);
    const periodRef = doc(db, COL.PERIODS, normalized.entry.periodKey);
    const periodSnap = await tx.get(periodRef);

    if (periodSnap.exists() && periodSnap.data().status === 'closed') {
      throw new Error(
        `الفترة ${normalized.entry.periodKey} مقفلة — لا يمكن الترحيل فيها. سجّل التصحيح في فترة مفتوحة.`,
      );
    }

    const nextNumber = (counterSnap.exists() ? Number(counterSnap.data().nextNumber) || 1 : 1);

    // ── writes ──
    const entryRef = doc(collection(db, COL.ENTRIES));
    tx.set(entryRef, {
      ...normalized.entry,
      entryNumber: nextNumber,
      // Lines live in the entry, so a posted entry has nothing appendable.
      lines: normalized.lines,
      lineCount: normalized.lines.length,
      createdBy: userId ?? normalized.entry.createdBy ?? null,
      createdAt: serverTimestamp(),
      postedAt:  normalized.entry.status === 'posted' ? serverTimestamp() : null,
    });
    // Locks the operational record this entry came from: once the books
    // record it, the source can no longer be edited or deleted from a client.
    // Enforced by the rules, which check for this document's existence.
    if (normalized.entry.status === 'posted'
        && normalized.entry.sourceType && normalized.entry.sourceId) {
      tx.set(doc(db, COL.LOCKS, postingLockId(normalized.entry.sourceType, normalized.entry.sourceId)), {
        sourceType: normalized.entry.sourceType,
        sourceId:   normalized.entry.sourceId,
        entryId:    entryRef.id,
        entryNumber: nextNumber,
        lockedBy:   userId ?? null,
        lockedAt:   serverTimestamp(),
      });
    }
    // Create the period lazily so a month is tracked from its first entry.
    if (!periodSnap.exists()) {
      tx.set(periodRef, {
        periodKey: normalized.entry.periodKey,
        status: 'open',
        closedAt: null,
        closedBy: null,
        createdAt: serverTimestamp(),
      });
    }
    tx.set(counterRef, { nextNumber: nextNumber + 1, updatedAt: serverTimestamp() }, { merge: true });
    writeAuditInTx(tx, {
      action: 'post', collectionName: COL.ENTRIES, documentId: entryRef.id, userId,
      after: { entryNumber: nextNumber, ...normalized.entry },
      note: `ترحيل قيد رقم ${nextNumber}`,
    });

    return { entryId: entryRef.id, entryNumber: nextNumber };
  });
}

/**
 * Reverses a posted entry: writes the mirror image and marks the original
 * `reversed`. The original's own lines are never touched — the trail must
 * show what was filed and what corrected it.
 */
export async function reverseEntry(entryId, { entryDate, description, userId = null } = {}) {
  requireDb();
  const original = await getDoc(doc(db, COL.ENTRIES, entryId));
  if (!original.exists()) throw new Error('القيد غير موجود.');
  const entry = { id: original.id, ...original.data() };

  const blocked = mutationBlockedReason(entry, 'reverse');
  if (blocked) throw new Error(blocked);

  const originalLines = await fetchLinesOf(entryId);
  const reversal = buildReversal(entry, originalLines, {
    entryDate: entryDate || new Date().toISOString().slice(0, 10),
    description,
    createdBy: userId,
  });

  return runTransaction(db, async (tx) => {
    const counterRef  = doc(db, COL.COUNTERS, JOURNAL_COUNTER);
    const counterSnap = await tx.get(counterRef);
    const revPeriodRef  = doc(db, COL.PERIODS, reversal.entry.periodKey);
    const revPeriodSnap = await tx.get(revPeriodRef);
    const originalRef  = doc(db, COL.ENTRIES, entryId);
    const originalSnap = await tx.get(originalRef);

    if (!originalSnap.exists()) throw new Error('القيد غير موجود.');
    if (originalSnap.data().status !== 'posted') throw new Error('لا يمكن عكس قيد غير مُرحّل.');
    if (revPeriodSnap.exists() && revPeriodSnap.data().status === 'closed') {
      throw new Error(`الفترة ${reversal.entry.periodKey} مقفلة — اختر تاريخاً في فترة مفتوحة.`);
    }

    const nextNumber = (counterSnap.exists() ? Number(counterSnap.data().nextNumber) || 1 : 1);
    const revRef = doc(collection(db, COL.ENTRIES));
    tx.set(revRef, {
      ...reversal.entry,
      entryNumber: nextNumber,
      lines: reversal.lines,
      lineCount: reversal.lines.length,
      createdAt: serverTimestamp(),
      postedAt:  serverTimestamp(),
    });
    // The original is marked, never deleted.
    tx.update(originalRef, { status: 'reversed', reversedBy: revRef.id, reversedAt: serverTimestamp() });
    if (!revPeriodSnap.exists()) {
      tx.set(revPeriodRef, {
        periodKey: reversal.entry.periodKey, status: 'open',
        closedAt: null, closedBy: null, createdAt: serverTimestamp(),
      });
    }
    tx.set(counterRef, { nextNumber: nextNumber + 1, updatedAt: serverTimestamp() }, { merge: true });
    writeAuditInTx(tx, {
      action: 'reverse', collectionName: COL.ENTRIES, documentId: entryId, userId,
      before: { status: 'posted' }, after: { status: 'reversed', reversalEntryId: revRef.id },
      note: `عكس القيد رقم ${entry.entryNumber} بقيد رقم ${nextNumber}`,
    });
    return { entryId: revRef.id, entryNumber: nextNumber };
  }).then(async (result) => {
    // Releasing the source lock happens AFTER the reversal commits, not
    // inside it: rules evaluate a transaction against the state before it,
    // so a rule requiring the entry to already read `reversed` could never
    // pass from within. Failing to release is the safe direction — the lock
    // simply stays and the record remains protected.
    if (entry.sourceType && entry.sourceId) {
      try {
        await deleteDoc(doc(db, COL.LOCKS, postingLockId(entry.sourceType, entry.sourceId)));
      } catch {
        // Left locked on purpose; correcting it is a deliberate act.
      }
    }
    return result;
  });
}

// ─── الفترات ─────────────────────────────────────────────────────────────
/**
 * Closes a month after re-running the preflight against freshly read data —
 * the UI's check could be seconds stale, and a close is the one action that
 * must not race an in-flight posting.
 */
export async function closePeriod(periodKey, { userId = null } = {}) {
  requireDb();
  const [entries, lines] = await Promise.all([fetchEntries(), fetchLines()]);
  const linesByEntry = new Map();
  for (const l of lines) {
    if (!linesByEntry.has(l.entryId)) linesByEntry.set(l.entryId, []);
    linesByEntry.get(l.entryId).push(l);
  }
  const pre = closePreflight(periodKey, { entries, linesByEntry });
  if (!pre.ok) {
    const err = new Error(pre.problems[0]);
    err.problems = pre.problems;
    throw err;
  }

  return runTransaction(db, async (tx) => {
    const ref = doc(db, COL.PERIODS, periodKey);
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data().status === 'closed') {
      throw new Error(`الفترة ${periodKey} مقفلة بالفعل.`);
    }
    tx.set(ref, {
      periodKey, status: 'closed',
      closedAt: serverTimestamp(), closedBy: userId ?? null,
    }, { merge: true });
    writeAuditInTx(tx, {
      action: 'close', collectionName: COL.PERIODS, documentId: periodKey, userId,
      before: { status: 'open' }, after: { status: 'closed' },
      note: `إقفال الفترة ${periodKey} — ${pre.entryCount} قيد، إجمالي ${pre.totals.debit.toFixed(2)}`,
    });
    return { periodKey, ...pre };
  });
}

/**
 * Re-opens a closed month. Deliberately separate from closePeriod and always
 * audited: re-opening a filed period is a decision, not a convenience.
 */
export async function reopenPeriod(periodKey, { userId = null, reason = '' } = {}) {
  requireDb();
  // Re-opening a filed period is a decision, and a decision without a stated
  // reason is indistinguishable from an accident. The rules require the field
  // too, so this is not merely a client-side courtesy.
  const why = String(reason || '').trim();
  if (!why) throw new Error('سبب إعادة فتح الفترة مطلوب.');
  return runTransaction(db, async (tx) => {
    const ref = doc(db, COL.PERIODS, periodKey);
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().status !== 'closed') {
      throw new Error(`الفترة ${periodKey} ليست مقفلة.`);
    }
    tx.set(ref, {
      status: 'open', reopenReason: why,
      reopenedAt: serverTimestamp(), reopenedBy: userId ?? null,
    }, { merge: true });
    writeAuditInTx(tx, {
      action: 'reopen', collectionName: COL.PERIODS, documentId: periodKey, userId,
      before: { status: 'closed' }, after: { status: 'open', reopenReason: why },
      note: `إعادة فتح الفترة ${periodKey} — ${why}`,
    });
    return { periodKey };
  });
}

// ─── التهيئة ─────────────────────────────────────────────────────────────
/**
 * Seeds the chart of accounts. Idempotent: an account that already exists is
 * left exactly as it is, so re-running never overwrites a renamed account or
 * resurrects one that was deactivated.
 */
export async function seedChartOfAccounts({ userId = null, extraAccounts = [] } = {}) {
  requireDb();
  const chart = [...DEFAULT_CHART_OF_ACCOUNTS, ...extraAccounts];
  const problems = validateChart(chart);
  if (problems.length) {
    const err = new Error(problems[0]);
    err.problems = problems;
    throw err;
  }

  const existing = new Set((await fetchAccounts()).map((a) => String(a.code)));
  const toCreate = chart.filter((a) => !existing.has(String(a.code)));
  if (toCreate.length === 0) return { created: 0, skipped: chart.length };

  // Chunked so one seed never exceeds a transaction's document limit.
  const CHUNK = 100;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const slice = toCreate.slice(i, i + CHUNK);
    await runTransaction(db, async (tx) => {
      for (const a of slice) {
        tx.set(doc(db, COL.ACCOUNTS, String(a.code)), {
          ...a,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      writeAuditInTx(tx, {
        action: 'seed', collectionName: COL.ACCOUNTS, documentId: null, userId,
        after: { codes: slice.map((a) => a.code) },
        note: `تهيئة دليل الحسابات — ${slice.length} حساب`,
      });
    });
  }
  return { created: toCreate.length, skipped: chart.length - toCreate.length };
}

/** Adds one account (e.g. a new partner's capital sub-account). Idempotent. */
export async function ensureAccount(account, { userId = null } = {}) {
  requireDb();
  const ref = doc(db, COL.ACCOUNTS, String(account.code));
  const snap = await getDoc(ref);
  if (snap.exists()) return { created: false };
  return runTransaction(db, async (tx) => {
    const again = await tx.get(ref);
    if (again.exists()) return { created: false };
    tx.set(ref, { ...account, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    writeAuditInTx(tx, {
      action: 'create', collectionName: COL.ACCOUNTS, documentId: String(account.code), userId,
      after: account, note: `إضافة حساب ${account.code}`,
    });
    return { created: true };
  });
}

/** Convenience for pages: everything a report needs, in one round trip. */
export async function fetchLedgerBundle() {
  const [accounts, entries, lines, periods] = await Promise.all([
    fetchAccounts(), fetchEntries(), fetchLines(), fetchPeriods(),
  ]);
  return { accounts, entries, lines, periods };
}

/** True when the source record already has a posted (non-reversed) entry. */
export function hasPostedEntryFor(entries, sourceType, sourceId) {
  return (entries || []).some(
    (e) => e.sourceType === sourceType && e.sourceId === sourceId && e.status === 'posted',
  );
}

export { periodKeyOf };
