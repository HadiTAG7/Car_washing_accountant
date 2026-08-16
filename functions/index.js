// ═══════════════════════════════════════════════════════════════════════════
// Callable Cloud Functions — منفذٌ على الخادم الموثوق، لا الخادم نفسه
// ═══════════════════════════════════════════════════════════════════════════
// Firestore rules deny every client write to journal_entries, journal_lines,
// posting_locks, counters, accounting_periods and audit_logs. The trusted
// server runs with the Admin SDK, which bypasses rules, so it is the sole path.
//
// This file used to BE that server: twenty-one `onCall` wrappers, each with
// its own role check inlined. It is now just a door onto it. Everything of
// substance — who may do what, and what each operation does — lives in
// `src/handlers.js`, which knows nothing about HTTP or Cloud Functions.
//
// The reason is not tidiness. Cloud Functions require the Blaze plan, and a
// Blaze plan requires a billing account that is not available to everyone
// everywhere. The accounting therefore has to be reachable through more than
// one front door — and the moment there are two, the guard cannot be written
// twice. Two copies of «who may reverse an entry» drift, and the drift stays
// invisible until the day the wrong copy lets someone through.
//
// So: `api/ledger.js` is the second door, and it shares this one's brain.
// Neither contains a rule of its own.
//
// Each export below is deliberately identical. A callable that needed special
// handling would be a callable whose logic had leaked back out of the shared
// layer.
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { dispatch } from './src/handlers.js';

initializeApp();
const db = getFirestore();

const REGION = 'us-central1';
const OPTS = { region: REGION, cors: true };

/**
 * One callable, by name.
 *
 * `req.auth` already carries the verified uid and token claims — Cloud
 * Functions checks the ID token before this runs — so identity is never read
 * from the payload here, and `dispatch` re-reads the ROLE from Firestore
 * rather than trusting anything in the token.
 */
const callable = (name) => onCall(OPTS, async (req) => {
  try {
    return await dispatch(db, FieldValue, name, req.data, req.auth);
  } catch (e) {
    throw new HttpsError(e.code || 'internal', e.message, e.details || undefined);
  }
});

// ─── الترحيل ─────────────────────────────────────────────────────────────
export const ledgerPostSource = callable('ledgerPostSource');
export const ledgerPostManual = callable('ledgerPostManual');
export const ledgerReverseEntry = callable('ledgerReverseEntry');

// ─── الفترات ─────────────────────────────────────────────────────────────
export const ledgerClosePeriod = callable('ledgerClosePeriod');
export const ledgerReopenPeriod = callable('ledgerReopenPeriod');

// ─── المستندات الضريبية ──────────────────────────────────────────────────
export const salesIssueDocument = callable('salesIssueDocument');
export const salesVoidDocument = callable('salesVoidDocument');
export const salesCorrectWashInvoice = callable('salesCorrectWashInvoice');
export const salesLinkLegacyInvoices = callable('salesLinkLegacyInvoices');

// ─── سياسة الضريبة ───────────────────────────────────────────────────────
export const accountingSetTaxPolicy = callable('accountingSetTaxPolicy');
export const accountingSeedTaxPolicy = callable('accountingSeedTaxPolicy');
export const accountingSetPreferences = callable('accountingSetPreferences');

// ─── التهيئة ─────────────────────────────────────────────────────────────
export const ledgerSeedChart = callable('ledgerSeedChart');
export const ledgerEnsureAccount = callable('ledgerEnsureAccount');

// ─── سجل مصاريف بند التأسيس ──────────────────────────────────────────────
export const startupAddEntry = callable('startupAddEntry');
export const startupDeleteEntry = callable('startupDeleteEntry');
export const startupConvertLegacySpend = callable('startupConvertLegacySpend');
export const startupUpdatePlan = callable('startupUpdatePlan');
export const startupDeletePlan = callable('startupDeletePlan');

// ─── تهيئة أول مدير ──────────────────────────────────────────────────────
// ⚠️ Until the first claim, any authenticated account in this project can make
// it. The window closes on the first click and never reopens.
// `scripts/bootstrap-admin.mjs` is the zero-window alternative.
export const authBootstrapStatus = callable('authBootstrapStatus');
export const authClaimFirstAdmin = callable('authClaimFirstAdmin');
