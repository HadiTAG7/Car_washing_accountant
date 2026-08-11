// ═══════════════════════════════════════════════════════════════════════════
// Callable Cloud Functions — the only door into the ledger
// ═══════════════════════════════════════════════════════════════════════════
// Firestore rules deny every client write to journal_entries, journal_lines,
// posting_locks, counters, accounting_periods and audit_logs. These functions
// run with the Admin SDK, which bypasses rules, so they are the sole path.
//
// Each one does exactly two things of its own: establish WHO is calling and
// whether their role permits the action, then hand off to `src/ledger.js`,
// which holds the accounting. Keeping the auth check here and the invariants
// there means neither can be skipped by calling the other directly.
//
// Roles come from `users/{uid}.role`, read server-side. A custom claim would
// be cheaper, but the role already lives in Firestore and a token claim can
// lag behind a revocation by up to an hour.
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import {
  postEntry, postSource, reverseEntry, closePeriod, reopenPeriod,
  seedChartOfAccounts, ensureAccount, LedgerError,
} from './src/ledger.js';
import { issueDocument, voidDocument, InvoicingError } from './src/invoicing.js';
import { canPost } from './src/posting.js';

initializeApp();
const db = getFirestore();

const REGION = 'us-central1';
const OPTS = { region: REGION, cors: true };

/** Resolves the caller's role from Firestore, never from a client claim. */
async function callerRole(auth) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'تسجيل الدخول مطلوب.');
  const [userSnap, adminSnap] = await Promise.all([
    db.collection('users').doc(auth.uid).get(),
    db.collection('app_admins').doc(auth.uid).get(),
  ]);
  if (adminSnap.exists) return 'admin';
  if (!userSnap.exists) throw new HttpsError('permission-denied', 'الحساب غير مُصرَّح له.');
  const role = userSnap.data().role;
  return ['admin', 'accountant', 'operator', 'partner'].includes(role) ? role : 'operator';
}

async function requireAccountant(auth) {
  const role = await callerRole(auth);
  if (role !== 'admin' && role !== 'accountant') {
    throw new HttpsError('permission-denied', 'الترحيل مقصور على المحاسب أو المدير.');
  }
  return { uid: auth.uid, role };
}

/**
 * An operator may post a WASH and nothing else.
 *
 * The reasoning, written down because it is a real widening of what an
 * operator can touch: an operator already decides when a wash is complete,
 * and auto-posting is meant to fire at exactly that moment. The alternatives
 * were to disable auto-posting for the people who actually use the app, or to
 * give them the accountant role — a far wider grant. So this is the narrow
 * one: `ledgerPostSource` for an allow-listed kind, never a manual entry,
 * never a period close, never a reversal.
 */
async function requirePostSource(auth, kind) {
  const role = await callerRole(auth);
  if (canPost(role, kind)) return { uid: auth.uid, role };
  throw new HttpsError('permission-denied',
    'ترحيل هذا النوع مقصور على المحاسب أو المدير.');
}

async function requireAdmin(auth) {
  const role = await callerRole(auth);
  if (role !== 'admin') {
    throw new HttpsError('permission-denied', 'هذه العملية مقصورة على المدير.');
  }
  return { uid: auth.uid, role };
}

/** Turns a LedgerError into the callable error the client can read. */
function toHttps(e) {
  if (e instanceof HttpsError) return e;
  if (e instanceof InvoicingError) {
    return new HttpsError(e.code || 'failed-precondition', e.message);
  }
  if (e instanceof LedgerError) {
    return new HttpsError(e.code || 'failed-precondition', e.message, {
      problems: e.problems || null,
    });
  }
  // Anything else is a bug: log it in full, tell the caller nothing internal.
  console.error('[ledger] unexpected failure', e);
  return new HttpsError('internal', 'تعذّر إتمام العملية — حاول مرة أخرى.');
}

// ─── الترحيل ─────────────────────────────────────────────────────────────
/**
 * Posts an operational record. The payload names it; the SERVER reads it.
 *
 * `{ kind, sourceId }` is the whole contract — no entry, no lines, no amount.
 * Nothing about the posting can be forged, because nothing about it comes
 * from the caller.
 */
export const ledgerPostSource = onCall(OPTS, async (req) => {
  const kind = req.data?.kind;
  const { uid } = await requirePostSource(req.auth, kind);
  try {
    return await postSource(db, FieldValue, { kind, sourceId: req.data?.sourceId }, { userId: uid });
  } catch (e) { throw toHttps(e); }
});

/**
 * A manual or period-end entry — the one path where lines still come from the
 * caller, because there is no single source document to read them from.
 *
 * Accountant or admin only, and `sourceType` is confined to the kinds that
 * genuinely have no source record, so this cannot be used to fabricate a wash
 * or an expense entry and bypass `ledgerPostSource`.
 *
 * ⚠️ Stated plainly: a depreciation charge is computed by the client from the
 * asset register and is NOT recomputed here. The server still balances it,
 * checks every account, derives the period and refuses a closed one — but the
 * amount is trusted. Recomputing the register server-side is the next step.
 */
const MANUAL_SOURCE_TYPES = ['manual', 'adjustment', 'opening', 'depreciation', 'disposal'];

export const ledgerPostManual = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  const requested = req.data?.entry?.sourceType;
  const sourceType = MANUAL_SOURCE_TYPES.includes(requested) ? requested : 'manual';
  // Only the period-end kinds carry a source id, and it is what keeps a month
  // from being depreciated twice.
  const keepsSourceId = sourceType === 'depreciation' || sourceType === 'disposal';
  try {
    return await postEntry(db, FieldValue, {
      entry: {
        ...req.data?.entry,
        sourceType,
        sourceId: keepsSourceId ? req.data?.entry?.sourceId ?? null : null,
      },
      lines: req.data?.lines,
    }, { userId: uid, lockKind: keepsSourceId ? sourceType : null });
  } catch (e) { throw toHttps(e); }
});

export const ledgerReverseEntry = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  try {
    return await reverseEntry(db, FieldValue, req.data?.entryId, {
      entryDate: req.data?.entryDate,
      description: req.data?.description,
      userId: uid,
    });
  } catch (e) { throw toHttps(e); }
});

// ─── الفترات ─────────────────────────────────────────────────────────────
export const ledgerClosePeriod = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  try {
    return await closePeriod(db, FieldValue, req.data?.periodKey, { userId: uid });
  } catch (e) { throw toHttps(e); }
});

// Re-opening a filed month is the one action that changes what a filed period
// says, so it is an admin's call and carries a reason.
export const ledgerReopenPeriod = onCall(OPTS, async (req) => {
  const { uid } = await requireAdmin(req.auth);
  try {
    return await reopenPeriod(db, FieldValue, req.data?.periodKey, {
      reason: req.data?.reason, userId: uid,
    });
  } catch (e) { throw toHttps(e); }
});

// ─── المستندات الضريبية ──────────────────────────────────────────────────
// Totals are recomputed from the lines, and the number, sequence, seller
// identity and issuer all come from the server.
export const salesIssueDocument = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  try {
    return await issueDocument(db, FieldValue, req.data || {}, { userId: uid });
  } catch (e) { throw toHttps(e); }
});

export const salesVoidDocument = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  try {
    return await voidDocument(db, FieldValue, {
      documentId: req.data?.documentId, reason: req.data?.reason,
    }, { userId: uid });
  } catch (e) { throw toHttps(e); }
});

// ─── التهيئة ─────────────────────────────────────────────────────────────
export const ledgerSeedChart = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  try {
    return await seedChartOfAccounts(db, FieldValue, req.data?.accounts, { userId: uid });
  } catch (e) { throw toHttps(e); }
});

export const ledgerEnsureAccount = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  try {
    return await ensureAccount(db, FieldValue, req.data?.account, { userId: uid });
  } catch (e) { throw toHttps(e); }
});
