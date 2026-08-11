// ═══════════════════════════════════════════════════════════════════════════
// طبقة الترحيل — reads from Firestore, writes through Cloud Functions
// ═══════════════════════════════════════════════════════════════════════════
// READS are direct: the ledger is world-readable to members, and a report
// needs the whole thing.
//
// WRITES all go through the callable functions in functions/. The client used
// to write the ledger inside a Firestore transaction, which was atomic but
// not trustworthy: rules have no fold, so no rule could check that an entry
// balanced, that a `reversed` status named a real mirror entry, or that a
// released source lock accompanied an actual reversal. A client holding a
// token could write Dr 100 / Cr 1 straight into the books.
//
// Rules now deny every client write to journal_entries, journal_lines,
// posting_locks, counters/journal, accounting_periods and audit_logs, so the
// functions are the only door. The signatures below are unchanged, which is
// why the pages and hooks did not have to move with them.
//
// Collections
//   chart_of_accounts    — one doc per account, doc id = account code
//   journal_entries      — header
//   journal_lines        — one doc per line, `entryId` points at the header
//   accounting_periods   — doc id = 'YYYY-MM'
//   audit_logs           — append-only trail
//   counters/journal     — { nextNumber } for sequential entry numbers
// ═══════════════════════════════════════════════════════════════════════════

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebaseClient';
import { callServer as call } from '../ledgerTransport';


import { fetchRows } from '../firestoreCrud';
import { validateEntry, normalizeEntry, periodKeyOf } from './journal';
import { DEFAULT_CHART_OF_ACCOUNTS, validateChart } from './chartOfAccounts';

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

// The audit trail is written by the ledger functions, inside the same
// transaction as the mutation it records — a client that could append here
// could fabricate the trail that is supposed to police it. Nothing in this
// file writes audit_logs any more; the rules deny it outright.

// ─── الترحيل ─────────────────────────────────────────────────────────────
/**
 * Posts one balanced entry through the trusted server.
 *
 * Returns { entryId, entryNumber, debit, credit }. Throws an Arabic Error
 * carrying `.problems` when the server refuses it.
 */
/**
 * Posts a SOURCE RECORD. The payload names it; the server reads it.
 *
 * `{ kind, sourceId }` is the whole contract. The amount, the date, the
 * payment method and the VAT treatment all come out of the stored document on
 * the server, so a caller cannot post a 50,000-riyal entry citing a
 * 115-riyal wash.
 */
export async function postSource(kind, sourceId) {
  requireDb();
  return call('ledgerPostSource', { kind, sourceId });
}

/**
 * A manual / adjusting entry, and the period-end entries the register
 * computes (depreciation, disposal).
 *
 * ⚠️ Honest limitation: unlike `postSource`, the LINES here come from the
 * client. The server still balances them, checks every account against the
 * chart, derives the period and refuses a closed one — but it does not
 * recompute a depreciation charge from the asset register. Accountant-only
 * for that reason, and `lockKind` keeps the idempotency that stops a month
 * being depreciated twice.
 */
export async function postEntry({ entry, lines }, { lockKind = null } = {}) {
  requireDb();
  // A local pass first: it cannot be trusted, but it turns the common
  // mistakes into an instant message instead of a round trip. The server
  // re-checks everything and its verdict is the one that counts.
  const normalized = normalizeEntry(entry, lines);
  const problems = validateEntry(normalized.entry, normalized.lines);
  if (problems.length) {
    const err = new Error(problems[0]);
    err.problems = problems;
    throw err;
  }
  // `userId` is deliberately NOT sent: the function reads the caller's uid
  // from the verified auth token, so a client cannot post as someone else.
  return call('ledgerPostManual', {
    entry: normalized.entry,
    lines: normalized.lines,
    lockKind,
  });
}

/**
 * Reverses a posted entry. The mirror is built ON THE SERVER from the
 * original's own stored lines, so it balances by construction — the client
 * has no way to supply an unbalanced "reversal" or to point `reversedBy` at
 * an entry that does not exist.
 */
export async function reverseEntry(entryId, { entryDate, description } = {}) {
  requireDb();
  return call('ledgerReverseEntry', {
    entryId,
    entryDate: entryDate || new Date().toISOString().slice(0, 10),
    description: description || null,
  });
}

// ─── الفترات ─────────────────────────────────────────────────────────────
/**
 * Closes a month after re-running the preflight against freshly read data —
 * the UI's check could be seconds stale, and a close is the one action that
 * must not race an in-flight posting.
 */
export async function closePeriod(periodKey) {
  requireDb();
  return call('ledgerClosePeriod', { periodKey });
}

/**
 * Re-opens a closed month. Admin-only and the reason is mandatory, both
 * enforced by the function — re-opening a filed period is the one action that
 * can change what a filed month says.
 */
export async function reopenPeriod(periodKey, { reason = '' } = {}) {
  requireDb();
  const why = String(reason || '').trim();
  if (!why) throw new Error('سبب إعادة فتح الفترة مطلوب.');
  return call('ledgerReopenPeriod', { periodKey, reason: why });
}

// ─── التهيئة ─────────────────────────────────────────────────────────────
/**
 * Seeds the chart of accounts. Idempotent: an account that already exists is
 * left exactly as it is, so re-running never overwrites a renamed account or
 * resurrects one that was deactivated.
 */
export async function seedChartOfAccounts({ extraAccounts = [] } = {}) {
  requireDb();
  const chart = [...DEFAULT_CHART_OF_ACCOUNTS, ...extraAccounts];
  const problems = validateChart(chart);
  if (problems.length) {
    const err = new Error(problems[0]);
    err.problems = problems;
    throw err;
  }
  return call('ledgerSeedChart', { accounts: chart });
}

/** Adds one account (a partner's capital sub-account, say). Idempotent. */
export async function ensureAccount(account) {
  requireDb();
  return call('ledgerEnsureAccount', { account });
}

/** Convenience for pages: everything a report needs, in one round trip. */
export async function fetchLedgerBundle() {
  const [accounts, entries, lines, periods] = await Promise.all([
    fetchAccounts(), fetchEntries(), fetchLines(), fetchPeriods(),
  ]);
  return { accounts, entries, lines, periods };
}

/**
 * True when the source record already has a posted (non-reversed) entry.
 *
 * Identity is the KIND plus the id, not the accounting source type: five
 * collections post with `sourceType: 'expense'`, so a monthly expense and a
 * variable expense sharing a document id would have masked each other — the
 * first posted would make the second look already-done, and it would never
 * reach the books.
 *
 * Entries written before `sourceKind` existed carry only `sourceType`, so
 * those fall back to the old comparison. That fallback is deliberately narrow:
 * it applies only when the stored entry has no kind of its own.
 */
export function hasPostedEntryFor(entries, kind, sourceId, sourceType = null) {
  const id = String(sourceId ?? '');
  return (entries || []).some((e) => {
    if (e.status !== 'posted' || String(e.sourceId ?? '') !== id) return false;
    if (e.sourceKind) return e.sourceKind === kind;
    // Legacy entry: the best it can say is its source type.
    return e.sourceType === (sourceType || kind);
  });
}

export { periodKeyOf };
