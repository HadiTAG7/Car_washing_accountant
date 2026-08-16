// ═══════════════════════════════════════════════════════════════════════════
// إعدادات المحاسبة — app_settings/accounting
// ═══════════════════════════════════════════════════════════════════════════
// Read here, written on the SERVER. The document used to be `setDoc`-ed
// straight from the browser, which cost three things: two tabs saving at once
// dropped a policy row with nothing to show it had existed, a decision that
// restates revenue left no audit record, and nothing stopped a policy being
// back-dated into a month that had already been filed.
//
// The rules now deny every client write to this one document. Everything below
// that changes it goes through a callable.
// ═══════════════════════════════════════════════════════════════════════════

import { doc, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebaseClient.js';
import { callServer } from '../ledgerTransport.js';
import {
  normalizeTaxPolicyHistory, taxPolicyAt, taxPolicyBaselineDate,
  hasTaxPolicyHistory, DEFAULT_VAT_RATE,
} from './taxPolicy.js';

const SETTINGS_DOC = 'accounting';

export const DEFAULT_ACCOUNTING_SETTINGS = {
  // OFF by default. Auto-posting changes what a familiar button does, and an
  // existing install must not silently start writing entries because the app
  // updated. Turning it on is a decision, made once, in one visible place.
  autoPost: false,
  vatRegistered: true,
  washPriceMode: 'inclusive',
  vatRate: DEFAULT_VAT_RATE,
  // ZATCA files quarterly below the SAR 40m threshold and monthly above it,
  // so neither can be assumed — the report reads this rather than hard-coding
  // a frequency. Quarterly is the common case for a single car wash.
  vatFilingPeriod: 'quarterly',
  // Every policy that has ever applied, each with the date it took effect.
  // Empty means "never configured": the flat fields above are ASSUMED to hold
  // for all dates, which is the pre-migration reading and is labelled as such
  // by `taxPolicyAt(...).source === 'unversioned'`.
  taxPolicyHistory: [],
};

export async function fetchAccountingSettings() {
  if (!isFirebaseConfigured) return { ...DEFAULT_ACCOUNTING_SETTINGS };
  const snap = await getDoc(doc(db, 'app_settings', SETTINGS_DOC));
  const v = snap.exists() ? (snap.data().value || snap.data()) : {};
  const rate = Number(v.vatRate);
  const settings = {
    ...DEFAULT_ACCOUNTING_SETTINGS,
    ...(typeof v.autoPost === 'boolean' ? { autoPost: v.autoPost } : {}),
    ...(typeof v.vatRegistered === 'boolean' ? { vatRegistered: v.vatRegistered } : {}),
    ...(v.washPriceMode ? { washPriceMode: v.washPriceMode } : {}),
    ...(Number.isFinite(rate) && rate >= 0 && rate < 1 ? { vatRate: rate } : {}),
    ...(v.vatFilingPeriod === 'monthly' || v.vatFilingPeriod === 'quarterly'
      ? { vatFilingPeriod: v.vatFilingPeriod } : {}),
  };
  return { ...settings, taxPolicyHistory: normalizeTaxPolicyHistory(v.taxPolicyHistory, settings) };
}

/**
 * Sets the tax policy from a date.
 *
 * `baselineFrom` is required for the FIRST change and is never guessed: it is
 * the date the current policy started, or the date the books begin. Without it
 * the server refuses, because storing only the new row would leave every
 * earlier month either unanswerable or — worse — answered by the new policy.
 */
export async function setTaxPolicy({
  vatRegistered, washPriceMode, vatRate,
  effectiveFrom, baselineFrom = null, baselineNote = null, reason = null,
}) {
  if (!isFirebaseConfigured) throw new Error('Firebase غير مُهيّأ.');
  return callServer('accountingSetTaxPolicy', {
    vatRegistered: Boolean(vatRegistered),
    washPriceMode: washPriceMode === 'exclusive' ? 'exclusive' : 'inclusive',
    vatRate: Number(vatRate),
    effectiveFrom, baselineFrom, baselineNote, reason,
  });
}

/** Records the baseline WITHOUT changing anything — makes the past answerable. */
export async function seedTaxPolicy({ baselineFrom, note = null }) {
  if (!isFirebaseConfigured) throw new Error('Firebase غير مُهيّأ.');
  return callServer('accountingSeedTaxPolicy', { baselineFrom, note });
}

/** Auto-posting and the filing frequency — no past figure moves with them. */
export async function saveAccountingPreferences(patch) {
  if (!isFirebaseConfigured) throw new Error('Firebase غير مُهيّأ.');
  return callServer('accountingSetPreferences', patch);
}

export { taxPolicyAt, taxPolicyBaselineDate, hasTaxPolicyHistory };
