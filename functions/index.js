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
import {
  issueDocument, voidDocument, correctLinkedInvoice, InvoicingError,
} from './src/invoicing.js';
import { runLegacyInvoiceLinks } from './src/legacyLinks.js';
import {
  setTaxPolicy, seedTaxPolicy, setAccountingPreferences,
} from './src/accountingSettings.js';
import { TaxPolicyError } from './src/taxPolicy.js';
import { PurchaseTaxError } from './src/purchaseTax.js';
import {
  addStartupEntry, deleteStartupEntry, convertLegacyStartupSpend,
  updateStartupPlan, deleteStartupPlan, StartupCostError,
} from './src/startupCosts.js';
import { claimFirstAdmin, directoryIsEmpty, BootstrapError } from './src/bootstrapAdmin.js';
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

/**
 * Recording a startup spend document is operational work — the same people who
 * record every other expense. A `partner` is read-only and is refused here.
 */
async function requireStartupWriter(auth) {
  const role = await callerRole(auth);
  if (role === 'partner') {
    throw new HttpsError('permission-denied', 'حساب الشريك للاطلاع فقط.');
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
  if (e instanceof InvoicingError) {
    return new HttpsError(e.code || 'failed-precondition', e.message);
  }
  if (e instanceof LedgerError) {
    return new HttpsError(e.code || 'failed-precondition', e.message, {
      problems: e.problems || null,
    });
  }
  if (e instanceof TaxPolicyError) {
    return new HttpsError(e.code || 'invalid-argument', e.message);
  }
  // A refusal to invent a VAT figure is a message the user must see in full —
  // it names the invoice and says exactly which of the three sources is
  // missing. Folding it into 'internal' would show «حاول مرة أخرى» for a
  // problem retrying cannot fix.
  if (e instanceof BootstrapError) {
    return new HttpsError(e.code || 'failed-precondition', e.message);
  }
  if (e instanceof StartupCostError) {
    return new HttpsError(e.code || 'failed-precondition', e.message);
  }
  if (e instanceof PurchaseTaxError) {
    return new HttpsError(e.code || 'failed-precondition', e.message, { reason: e.reason });
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
  const sourceId = String(req.data?.entry?.sourceId ?? '').trim();
  // A period-end entry's whole idempotency rests on its source id — the
  // period key for a depreciation charge, the asset id for a disposal. Without
  // one there is no lock, so the same month could be depreciated again and
  // again. Refused BEFORE anything is written.
  if (keepsSourceId && !sourceId) {
    throw new HttpsError('invalid-argument',
      'قيد الإهلاك أو الاستبعاد يحتاج معرّف مصدر — بدونه يمكن تكراره.');
  }
  try {
    return await postEntry(db, FieldValue, {
      entry: {
        ...req.data?.entry,
        sourceType,
        sourceId: keepsSourceId ? sourceId : null,
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

// `reversalDate` is threaded through deliberately. Voiding a note reverses its
// entry, and that reversal lands in a period — so the caller names the date and
// owns it. Dropping it here was what left a note in a closed month with no way
// to be voided at all: the server fell back to the note's own date, which is
// the one date the closed period refuses.
export const salesVoidDocument = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  try {
    return await voidDocument(db, FieldValue, {
      documentId: req.data?.documentId,
      reason: req.data?.reason,
      reversalDate: req.data?.reversalDate,
    }, { userId: uid });
  } catch (e) { throw toHttps(e); }
});

/**
 * التصحيح الذري لفاتورة غسلة.
 *
 * Cancels the document, reverses the wash's entry on an explicit date, frees
 * the posting lock only if that entry still owns it, and releases the source
 * claim — in ONE transaction. Done as four separate calls, any of them could
 * land alone and leave an issued invoice over a reversed entry, or a wash that
 * can be re-posted but never re-invoiced.
 */
export const salesCorrectWashInvoice = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  try {
    return await correctLinkedInvoice(db, FieldValue, {
      documentId: req.data?.documentId,
      reason: req.data?.reason,
      reversalDate: req.data?.reversalDate,
    }, { userId: uid });
  } catch (e) { throw toHttps(e); }
});

/**
 * ربط الفواتير القديمة بقيودها — dry-run by default.
 *
 * Adopts only links the document already DECLARES and that the lock, the entry
 * and the amount all confirm; everything else comes back as a review list.
 * Admin-only, because applying it writes to filed documents — even though all
 * it writes are the link fields.
 */
export const salesLinkLegacyInvoices = onCall(OPTS, async (req) => {
  const apply = req.data?.apply === true;
  const { uid } = apply ? await requireAdmin(req.auth) : await requireAccountant(req.auth);
  try {
    return await runLegacyInvoiceLinks(db, FieldValue, { apply }, { userId: uid });
  } catch (e) { throw toHttps(e); }
});

// ─── سياسة الضريبة ───────────────────────────────────────────────────────
/**
 * تعيين السياسة الضريبية بتاريخ سريان.
 *
 * `app_settings/accounting` is denied to clients in the rules, so this is the
 * only door. It re-reads inside a transaction (two tabs saving at once would
 * otherwise drop a policy row with nothing to show it existed), validates the
 * date against the calendar, and writes the before/after to `audit_logs`.
 *
 * A change reaching into a CLOSED month rewrites what was filed: an accountant
 * may not make it, an admin may with a written reason.
 */
export const accountingSetTaxPolicy = onCall(OPTS, async (req) => {
  const { uid, role } = await requireAccountant(req.auth);
  try {
    return await setTaxPolicy(db, FieldValue, {
      vatRegistered: req.data?.vatRegistered,
      washPriceMode: req.data?.washPriceMode,
      vatRate: req.data?.vatRate,
      effectiveFrom: req.data?.effectiveFrom,
      baselineFrom: req.data?.baselineFrom ?? null,
      baselineNote: req.data?.baselineNote ?? null,
      reason: req.data?.reason ?? null,
    }, { userId: uid, role });
  } catch (e) { throw toHttps(e); }
});

/** تهيئة السجل التاريخي بلا تغيير — "this has applied since the books began". */
export const accountingSeedTaxPolicy = onCall(OPTS, async (req) => {
  const { uid, role } = await requireAccountant(req.auth);
  try {
    return await seedTaxPolicy(db, FieldValue, {
      baselineFrom: req.data?.baselineFrom,
      note: req.data?.note ?? null,
    }, { userId: uid, role });
  } catch (e) { throw toHttps(e); }
});

/** The switches that change no past figure: auto-posting, filing frequency. */
export const accountingSetPreferences = onCall(OPTS, async (req) => {
  const { uid } = await requireAccountant(req.auth);
  try {
    return await setAccountingPreferences(db, FieldValue, req.data || {}, { userId: uid });
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

// ─── سجل مصاريف بند التأسيس ──────────────────────────────────────────────
/**
 * `startup_cost_entries` is denied to every client in the rules, so these are
 * the only door into it — and `startup_costs` accepts nothing from a client
 * beyond the PLAN.
 *
 * The reason is not tidiness. Three things every write here needs are
 * inexpressible in a rule: re-summing the sibling entries into the parent's
 * `actual_amount` (rules have no fold), re-deriving `status` from that sum,
 * and doing the posting-lock check and the parent update in ONE atomic step.
 * A rule can see a lock; it cannot make the check and the recompute happen
 * together, so a delete could clear an entry and leave the parent's total
 * describing a row that is gone.
 *
 * The role comes from the verified token in every case — `req.auth.uid` read
 * back out of Firestore — never from the payload, and neither does the
 * roll-up or the total.
 */
export const startupAddEntry = onCall(OPTS, async (req) => {
  const { uid, role } = await requireStartupWriter(req.auth);
  try {
    return await addStartupEntry(db, FieldValue, {
      parentId: req.data?.parentId, entry: req.data?.entry,
    }, { userId: uid, role });
  } catch (e) { throw toHttps(e); }
});

export const startupDeleteEntry = onCall(OPTS, async (req) => {
  const { uid, role } = await requireStartupWriter(req.auth);
  try {
    return await deleteStartupEntry(db, FieldValue, {
      entryId: req.data?.entryId,
    }, { userId: uid, role });
  } catch (e) { throw toHttps(e); }
});

/**
 * Migrating a legacy parent-level amount is accountant-or-admin work.
 *
 * It decides which period a deduction is claimed in — the invoice's, chosen by
 * hand from a record that never held one. An operator recording today's spend
 * has no business back-dating a document into a quarter that may already have
 * been filed, and the role gate is the place that says so rather than a note
 * in a UI nobody has to use.
 */
export const startupConvertLegacySpend = onCall(OPTS, async (req) => {
  const { uid, role } = await requireAccountant(req.auth);
  try {
    return await convertLegacyStartupSpend(db, FieldValue, {
      parentId: req.data?.parentId, form: req.data?.form,
    }, { userId: uid, role });
  } catch (e) { throw toHttps(e); }
});

/**
 * Edits a plan and re-derives its status in the same transaction.
 *
 * `status` is a function of the spend and the budget, so the budget cannot
 * move without the function being re-run — which is why this is a callable and
 * not a rule-guarded client write. The rules refuse `update` on
 * `startup_costs` outright.
 */
export const startupUpdatePlan = onCall(OPTS, async (req) => {
  const { uid, role } = await requireStartupWriter(req.auth);
  try {
    return await updateStartupPlan(db, FieldValue, {
      parentId: req.data?.parentId, patch: req.data?.patch,
    }, { userId: uid, role });
  } catch (e) { throw toHttps(e); }
});

/**
 * Deletes a plan — and refuses rather than cascading.
 *
 * A plan with spend documents under it cannot go: deleting it would leave
 * those rows, their journal entries and their posting locks pointing at a
 * parent that no longer exists. A posted document is reversed first, which
 * releases its lock, and only then may it be deleted.
 */
export const startupDeletePlan = onCall(OPTS, async (req) => {
  const { uid, role } = await requireStartupWriter(req.auth);
  try {
    return await deleteStartupPlan(db, FieldValue, {
      parentId: req.data?.parentId,
    }, { userId: uid, role });
  } catch (e) { throw toHttps(e); }
});

// ─── تهيئة أول مدير ──────────────────────────────────────────────────────
/**
 * Is this installation still unclaimed?
 *
 * Asked before the button is offered, so the app never shows an action that
 * will fail. Authenticated-only — an anonymous probe learns nothing.
 */
export const authBootstrapStatus = onCall(OPTS, async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'تسجيل الدخول مطلوب.');
  try {
    return { unclaimed: await directoryIsEmpty(db) };
  } catch (e) { throw toHttps(e); }
});

/**
 * Claims the admin role for the CALLING account — once, on an empty directory.
 *
 * The deadlock this breaks: creating `users/{uid}` needs `isAdmin()`,
 * `isAdmin()` needs a `users` or `app_admins` document, and `app_admins` is
 * closed to every client. Correct on an installed system, and a brick wall on
 * a fresh one — the owner of a brand-new project cannot make themselves the
 * admin without a service-account key.
 *
 * The identity comes from the verified token; the payload is not read at all.
 * The emptiness test is a transactional query, so two simultaneous clicks
 * resolve to exactly one admin.
 *
 * ⚠️ Stated plainly: until the first claim, any authenticated account in this
 * project can make it. The window closes on the first click and never reopens.
 * `scripts/bootstrap-admin.mjs` is the zero-window alternative.
 */
export const authClaimFirstAdmin = onCall(OPTS, async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'تسجيل الدخول مطلوب.');
  try {
    return await claimFirstAdmin(db, FieldValue, {
      uid: req.auth.uid,
      email: req.auth.token?.email || null,
    });
  } catch (e) { throw toHttps(e); }
});
