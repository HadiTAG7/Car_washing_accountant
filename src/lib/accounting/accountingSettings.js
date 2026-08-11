// ═══════════════════════════════════════════════════════════════════════════
// إعدادات المحاسبة — app_settings/accounting
// ═══════════════════════════════════════════════════════════════════════════
// One document, read by the pages that need to know how the books behave.
// Kept separate from the seller profile because these are policy switches,
// not identity.
// ═══════════════════════════════════════════════════════════════════════════

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebaseClient';

const SETTINGS_DOC = 'accounting';

export const DEFAULT_ACCOUNTING_SETTINGS = {
  // OFF by default. Auto-posting changes what a familiar button does, and an
  // existing install must not silently start writing entries because the app
  // updated. Turning it on is a decision, made once, in one visible place.
  autoPost: false,
  vatRegistered: true,
  washPriceMode: 'inclusive',
  // ZATCA files quarterly below the SAR 40m threshold and monthly above it,
  // so neither can be assumed — the report reads this rather than hard-coding
  // a frequency. Quarterly is the common case for a single car wash.
  vatFilingPeriod: 'quarterly',
};

export async function fetchAccountingSettings() {
  if (!isFirebaseConfigured) return { ...DEFAULT_ACCOUNTING_SETTINGS };
  const snap = await getDoc(doc(db, 'app_settings', SETTINGS_DOC));
  const v = snap.exists() ? (snap.data().value || snap.data()) : {};
  return {
    ...DEFAULT_ACCOUNTING_SETTINGS,
    ...(typeof v.autoPost === 'boolean' ? { autoPost: v.autoPost } : {}),
    ...(typeof v.vatRegistered === 'boolean' ? { vatRegistered: v.vatRegistered } : {}),
    ...(v.washPriceMode ? { washPriceMode: v.washPriceMode } : {}),
    ...(v.vatFilingPeriod === 'monthly' || v.vatFilingPeriod === 'quarterly'
      ? { vatFilingPeriod: v.vatFilingPeriod } : {}),
  };
}

export async function saveAccountingSettings(patch, { userId = null } = {}) {
  if (!isFirebaseConfigured) throw new Error('Firebase غير مُهيّأ.');
  const current = await fetchAccountingSettings();
  const next = { ...current, ...patch };
  await setDoc(doc(db, 'app_settings', SETTINGS_DOC), {
    value: next, updatedBy: userId, updatedAt: serverTimestamp(),
  }, { merge: true });
  return next;
}
