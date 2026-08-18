// ═══════════════════════════════════════════════════════════════════════════
// القراءة — بنفس الشكل الذي تقرأ به الواجهة، لا بشكلٍ موازٍ
// ═══════════════════════════════════════════════════════════════════════════
// The reports are computed by importing the app's OWN pure modules
// (`reports.js`, `vatReturn.js`, `chartOfAccounts.js`) rather than
// reimplementing them here. A second implementation would drift, and the day
// it drifted the assistant would confidently quote a number the app disagrees
// with — the worst possible failure for a bookkeeping tool, because nothing
// about it looks wrong.
//
// So this file does one job: hand those functions the same shapes the app
// hands them.
// ═══════════════════════════════════════════════════════════════════════════

import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { connect } from './client.js';

export const COL = {
  ACCOUNTS: 'chart_of_accounts',
  ENTRIES: 'journal_entries',
  LINES: 'journal_lines',
  PERIODS: 'accounting_periods',
  LOCKS: 'posting_locks',
  STARTUP: 'startup_costs',
  STARTUP_ENTRIES: 'startup_cost_entries',
  DOCUMENTS: 'sales_documents',
  SETTINGS: 'app_settings',
};

/** Collections a person records day-to-day work in. */
export const OPERATIONAL = [
  'washes', 'bikers', 'housing_units', 'monthly_expenses', 'variable_expenses', 'annual_expenses',
  'annual_expense_entries', 'temporary_expenses', 'partner_payments',
  'partners', 'transactions', 'categories', 'expense_vouchers', 'fixed_assets',
];

export async function rows(name) {
  const { db } = await connect();
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function row(name, id) {
  const { db } = await connect();
  const snap = await getDoc(doc(db, name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Lines live INSIDE their entry, and a legacy collection holds the ones posted
 * before they moved. Both are read and flattened here for exactly the reason
 * the app does it: every report then sees one shape, and no caller has to know
 * the seam exists.
 */
export function embeddedLinesOf(entry) {
  const list = Array.isArray(entry?.lines) ? entry.lines : [];
  return list.map((l, i) => ({ ...l, entryId: entry.id, id: `${entry.id}:${i}` }));
}

/** Everything the report builders need, in one round trip. */
export async function ledgerBundle() {
  const [accounts, entries, legacyLines, periods] = await Promise.all([
    rows(COL.ACCOUNTS), rows(COL.ENTRIES), rows(COL.LINES), rows(COL.PERIODS),
  ]);
  const lines = entries.flatMap(embeddedLinesOf).concat(legacyLines);
  return { accounts, entries, lines, periods };
}

/** `wash__abc123` — the id the posting transaction writes. */
export const lockId = (sourceType, sourceId) => `${sourceType}__${sourceId}`;
