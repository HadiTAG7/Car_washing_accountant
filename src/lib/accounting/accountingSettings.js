// ═══════════════════════════════════════════════════════════════════════════
// إعدادات المحاسبة — app_settings/accounting
// ═══════════════════════════════════════════════════════════════════════════
// One document, read by the pages that need to know how the books behave.
// Kept separate from the seller profile because these are policy switches,
// not identity.
// ═══════════════════════════════════════════════════════════════════════════

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebaseClient';
import { normalizeTaxPolicyHistory, withTaxPolicyChange, DEFAULT_VAT_RATE } from './taxPolicy';

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
  // Every past value of the three tax switches, each with the date it took
  // effect. Without this, flipping `washPriceMode` in August restated July:
  // any figure derived from raw wash rows would be recomputed under today's
  // rules, and a reconciliation gap the size of the tax would appear out of a
  // setting change. Empty on an existing install, which reads exactly as
  // before — the current values apply to all dates.
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
 * Saves the switches, recording WHEN a tax change takes effect.
 *
 * `effectiveFrom` defaults to today, which is the only honest default: a
 * change made today applies from today, and back-dating one silently restates
 * a filed period. The caller may name an earlier date deliberately — that is a
 * correction, and it is stored as such.
 */
export async function saveAccountingSettings(patch, { userId = null, effectiveFrom = null } = {}) {
  if (!isFirebaseConfigured) throw new Error('Firebase غير مُهيّأ.');
  const current = await fetchAccountingSettings();
  const merged = { ...current, ...patch };
  const from = effectiveFrom || new Date().toISOString().slice(0, 10);
  const next = {
    ...merged,
    taxPolicyHistory: withTaxPolicyChange(current, merged, from),
  };
  await setDoc(doc(db, 'app_settings', SETTINGS_DOC), {
    value: next, updatedBy: userId, updatedAt: serverTimestamp(),
  }, { merge: true });
  return next;
}
