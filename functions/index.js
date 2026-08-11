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
  postEntry, reverseEntry, closePeriod, reopenPeriod,
  seedChartOfAccounts, ensureAccount, LedgerError,
} from './src/ledger.js';

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
export const ledgerPostEntry = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  try {
    return await postEntry(db, FieldValue, {
      entry: req.data?.entry, lines: req.data?.lines,
    }, { userId: uid });
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
