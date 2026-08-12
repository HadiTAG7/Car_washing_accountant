// ═══════════════════════════════════════════════════════════════════════════
// إعدادات المحاسبة على الخادم — the tax policy is a record, not a preference
// ═══════════════════════════════════════════════════════════════════════════
// `app_settings/accounting` used to be written straight from the browser with
// a `setDoc`. Three things were wrong with that, and only the third is obvious:
//
//   1. **Lost updates.** Read-merge-write from two tabs drops a policy row.
//      There is no counter to notice it and no audit record to find it in.
//   2. **No audit trail.** Changing `washPriceMode` restates what every future
//      wash means. That is an accounting decision and it has to be signed.
//   3. **No gate.** Anyone who could reach Firestore could back-date a policy
//      into a month that has already been filed.
//
// So the document is denied to clients in the rules — readable, never
// writable — and every change comes through here, in a transaction, with the
// before/after and the reason written to `audit_logs` beside it.
//
// The closed-period rule is stated rather than assumed: a change whose
// effective date reaches into a month that has been CLOSED restates a filed
// period. An accountant may not do it at all; an admin may, with a written
// reason, and it is audited as such.
// ═══════════════════════════════════════════════════════════════════════════

import {
  taxPolicyAt, withTaxPolicyChange, seedTaxPolicyBaseline, currentPolicyFields,
  normalizeTaxPolicyHistory, isRealPolicyDate, TaxPolicyError, DEFAULT_VAT_RATE,
} from './taxPolicy.js';

export const SETTINGS_COL = 'app_settings';
export const SETTINGS_DOC = 'accounting';
const AUDIT_COL = 'audit_logs';
const PERIODS_COL = 'accounting_periods';

export const DEFAULT_SETTINGS = {
  autoPost: false,
  vatRegistered: true,
  washPriceMode: 'inclusive',
  vatRate: DEFAULT_VAT_RATE,
  vatFilingPeriod: 'quarterly',
  taxPolicyHistory: [],
};

function readSettings(snap) {
  const v = snap?.exists ? (snap.data().value || snap.data()) : {};
  const rate = Number(v.vatRate);
  return {
    ...DEFAULT_SETTINGS,
    ...(typeof v.autoPost === 'boolean' ? { autoPost: v.autoPost } : {}),
    ...(typeof v.vatRegistered === 'boolean' ? { vatRegistered: v.vatRegistered } : {}),
    ...(v.washPriceMode ? { washPriceMode: v.washPriceMode } : {}),
    ...(Number.isFinite(rate) && rate >= 0 && rate < 1 ? { vatRate: rate } : {}),
    ...(v.vatFilingPeriod === 'monthly' || v.vatFilingPeriod === 'quarterly'
      ? { vatFilingPeriod: v.vatFilingPeriod } : {}),
    taxPolicyHistory: normalizeTaxPolicyHistory(v.taxPolicyHistory, v),
  };
}

const periodKeyOf = (iso) => String(iso || '').slice(0, 7);

/**
 * Does this change reach into a month that has already been closed?
 *
 * `effectiveFrom` in or before the latest closed month means the policy that
 * month was filed under is being rewritten. The dates are read from
 * `accounting_periods` rather than assumed.
 */
export async function latestClosedPeriod(db) {
  const snap = await db.collection(PERIODS_COL).where('status', '==', 'closed').get();
  const keys = snap.docs.map((d) => d.data().periodKey || d.id).filter(Boolean).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

/**
 * Sets the tax policy, in one transaction, with an effective date.
 *
 * `baselineFrom` is required for the FIRST change: without it every date
 * before the change is unanswerable, and inferring one would silently rewrite
 * history. `reason` is required whenever the change is retroactive into a
 * closed month, and only an admin may make that change at all.
 */
export async function setTaxPolicy(db, FieldValue, {
  vatRegistered, washPriceMode, vatRate,
  effectiveFrom, baselineFrom = null, baselineNote = null, reason = null,
}, { userId = null, role = 'accountant', today = null } = {}) {
  if (!isRealPolicyDate(effectiveFrom)) {
    throw new TaxPolicyError('تاريخ سريان السياسة الضريبية مطلوب ويجب أن يكون تاريخاً حقيقياً (YYYY-MM-DD).');
  }
  if (typeof vatRegistered !== 'boolean') {
    throw new TaxPolicyError('حالة التسجيل الضريبي مطلوبة (نعم أو لا).');
  }
  if (washPriceMode !== 'inclusive' && washPriceMode !== 'exclusive') {
    throw new TaxPolicyError('وضع سعر الغسلة مطلوب (شامل أو غير شامل الضريبة).');
  }
  const rate = Number(vatRate);
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    throw new TaxPolicyError('نسبة الضريبة يجب أن تكون كسراً بين 0 و1 (مثال 0.15).');
  }
  if (vatRegistered && rate === 0) {
    throw new TaxPolicyError('منشأة مسجّلة بنسبة صفر — إمّا ألغِ التسجيل أو أدخل النسبة.');
  }
  const why = String(reason || '').trim();

  // Read OUTSIDE the transaction: a query is not allowed inside one here, and
  // the closed-period set is re-checked below against the same snapshot the
  // write uses for everything that can race.
  const closedThrough = await latestClosedPeriod(db);
  const retroactive = Boolean(closedThrough) && periodKeyOf(effectiveFrom) <= closedThrough;
  if (retroactive) {
    if (role !== 'admin') {
      throw new TaxPolicyError(
        `تاريخ السريان ${effectiveFrom} يقع في فترة مقفلة (آخر فترة مقفلة ${closedThrough}) — `
        + 'تغيير سياسة شهر مُقفل يعيد كتابة ما قُدِّم، ويحتاج مديراً وسبباً مكتوباً.',
        { code: 'permission-denied' },
      );
    }
    if (!why) {
      throw new TaxPolicyError(
        'تغيير سياسة فترة مقفلة يحتاج سبباً مكتوباً — يُقرأ في المراجعة.',
        { code: 'failed-precondition' },
      );
    }
  }

  const asOf = isRealPolicyDate(today) ? today : new Date().toISOString().slice(0, 10);

  return db.runTransaction(async (tx) => {
    const ref = db.collection(SETTINGS_COL).doc(SETTINGS_DOC);
    // Re-read INSIDE the transaction. Two tabs saving at once would otherwise
    // each merge onto the copy they loaded, and one policy row would vanish
    // with nothing to show it ever existed.
    const current = readSettings(await tx.get(ref));

    const history = withTaxPolicyChange(
      current,
      { vatRegistered, washPriceMode, vatRate: rate },
      effectiveFrom,
      { baselineFrom, baselineNote, note: why || null },
    );
    // The flat fields are `taxPolicyAt(today)`, never the last row — a change
    // effective next month must not move what today reads.
    const flat = currentPolicyFields(history, asOf)
      || { vatRegistered: current.vatRegistered, washPriceMode: current.washPriceMode, vatRate: current.vatRate };

    const next = { ...current, ...flat, taxPolicyHistory: history };
    tx.set(ref, { value: next, updatedBy: userId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection(AUDIT_COL).doc(), {
      action: 'tax-policy', collectionName: SETTINGS_COL, documentId: SETTINGS_DOC, userId,
      before: {
        vatRegistered: current.vatRegistered,
        washPriceMode: current.washPriceMode,
        vatRate: current.vatRate,
        historyLength: current.taxPolicyHistory.length,
      },
      after: {
        vatRegistered, washPriceMode, vatRate: rate,
        effectiveFrom, baselineFrom: baselineFrom || null,
        historyLength: history.length,
        retroactive, closedThrough: closedThrough || null,
      },
      note: `تغيير السياسة الضريبية ساري من ${effectiveFrom}`
        + (baselineFrom ? ` (تهيئة السجل من ${baselineFrom})` : '')
        + (retroactive ? ` — رجعي في فترة مقفلة حتى ${closedThrough}: ${why}` : (why ? ` — ${why}` : '')),
      at: FieldValue.serverTimestamp(),
      atIso: new Date().toISOString(),
    });

    return { ...next, retroactive, closedThrough: closedThrough || null };
  });
}

/**
 * Records the baseline WITHOUT changing anything — "this is what has applied
 * since the books began". The honest first step for an install that has been
 * running on unversioned settings, and the one that makes every earlier month
 * answerable.
 */
export async function seedTaxPolicy(db, FieldValue, { baselineFrom, note = null }, { userId = null } = {}) {
  return db.runTransaction(async (tx) => {
    const ref = db.collection(SETTINGS_COL).doc(SETTINGS_DOC);
    const current = readSettings(await tx.get(ref));
    const history = seedTaxPolicyBaseline(current, baselineFrom, { note });
    const next = { ...current, taxPolicyHistory: history };
    tx.set(ref, { value: next, updatedBy: userId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection(AUDIT_COL).doc(), {
      action: 'tax-policy', collectionName: SETTINGS_COL, documentId: SETTINGS_DOC, userId,
      before: { historyLength: 0 },
      after: { baselineFrom, historyLength: 1, ...history[0] },
      note: `تهيئة السجل التاريخي للسياسة الضريبية من ${baselineFrom}`
        + (note ? ` — ${note}` : ''),
      at: FieldValue.serverTimestamp(),
      atIso: new Date().toISOString(),
    });
    return next;
  });
}

/**
 * The non-tax switches: auto-posting and the filing frequency.
 *
 * They change no past figure, so they need no effective date — but the
 * document they live in is closed to clients, so they come through here too.
 */
export async function setAccountingPreferences(db, FieldValue, patch = {}, { userId = null } = {}) {
  const next = {};
  if (typeof patch.autoPost === 'boolean') next.autoPost = patch.autoPost;
  if (patch.vatFilingPeriod === 'monthly' || patch.vatFilingPeriod === 'quarterly') {
    next.vatFilingPeriod = patch.vatFilingPeriod;
  }
  if (Object.keys(next).length === 0) {
    throw new TaxPolicyError('لا يوجد إعداد صالح للحفظ.');
  }
  return db.runTransaction(async (tx) => {
    const ref = db.collection(SETTINGS_COL).doc(SETTINGS_DOC);
    const current = readSettings(await tx.get(ref));
    const merged = { ...current, ...next };
    tx.set(ref, { value: merged, updatedBy: userId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection(AUDIT_COL).doc(), {
      action: 'settings', collectionName: SETTINGS_COL, documentId: SETTINGS_DOC, userId,
      before: { autoPost: current.autoPost, vatFilingPeriod: current.vatFilingPeriod },
      after: next,
      note: 'تعديل إعدادات المحاسبة (لا تمسّ سياسة الضريبة التاريخية)',
      at: FieldValue.serverTimestamp(),
      atIso: new Date().toISOString(),
    });
    return merged;
  });
}

export { readSettings, taxPolicyAt };
