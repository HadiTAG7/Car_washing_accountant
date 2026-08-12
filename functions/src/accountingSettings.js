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
const ENTRIES_COL = 'journal_entries';
const COUNTERS_COL = 'counters';
const JOURNAL_COUNTER = 'journal';

/**
 * Entry statuses that are IN the books.
 *
 * `reversed` counts. A reversed entry has not left the ledger — its mirror
 * cancels its amounts, but both are dated documents sitting in a month, and
 * that month still has to be answerable by the policy record. Treating a
 * reversal as an erasure would let a baseline be seeded after it.
 */
const COUNTED_ENTRY_STATUS = new Set(['posted', 'reversed']);

/**
 * How many of the oldest entries to look at before giving up on the scan.
 *
 * Only entries whose status counts are eligible, so the scan reads a few and
 * takes the first that qualifies. It is also the read set: an entry inserted
 * with a date inside this window changes the query's result and aborts the
 * transaction, which is the second half of the race guard.
 */
const EARLIEST_SCAN = 20;

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
 * The latest closed month, read INSIDE a transaction.
 *
 * `effectiveFrom` in or before it means the policy that month was filed under
 * is being rewritten. Firestore counts a transactional query in the read set,
 * so a period closed mid-flight aborts the transaction and the retry sees it.
 */
async function latestClosedPeriodIn(db, tx) {
  const snap = await tx.get(db.collection(PERIODS_COL).where('status', '==', 'closed'));
  const keys = snap.docs.map((d) => d.data().periodKey || d.id).filter(Boolean).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

/** The same question outside a transaction, for callers that only look. */
export async function latestClosedPeriod(db) {
  const snap = await db.collection(PERIODS_COL).where('status', '==', 'closed').get();
  const keys = snap.docs.map((d) => d.data().periodKey || d.id).filter(Boolean).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

/**
 * Refuses a change that rewrites a filed month unless an admin says why.
 *
 * Shared by the policy change and the baseline seed, so the two cannot drift
 * into different answers about the same month.
 */
function gateRetroactive({ effectiveFrom, closedThrough, role, reason, what }) {
  const retroactive = Boolean(closedThrough) && periodKeyOf(effectiveFrom) <= closedThrough;
  if (!retroactive) return false;
  if (role !== 'admin') {
    throw new TaxPolicyError(
      `${what} بتاريخ ${effectiveFrom} يقع في فترة مقفلة (آخر فترة مقفلة ${closedThrough}) — `
      + 'تغيير سياسة شهر مُقفل يعيد كتابة ما قُدِّم، ويحتاج مديراً وسبباً مكتوباً.',
      { code: 'permission-denied' },
    );
  }
  if (!String(reason || '').trim()) {
    throw new TaxPolicyError(
      `${what} في فترة مقفلة يحتاج سبباً مكتوباً — يُقرأ في المراجعة.`,
      { code: 'failed-precondition' },
    );
  }
  return true;
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
}, { userId = null, role = 'accountant', today = null, onBeforeCommit = null } = {}) {
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
  const asOf = isRealPolicyDate(today) ? today : new Date().toISOString().slice(0, 10);

  return db.runTransaction(async (tx) => {
    const ref = db.collection(SETTINGS_COL).doc(SETTINGS_DOC);
    // Both reads INSIDE the transaction, and that is the point of this shape.
    //
    // The settings, because two tabs saving at once would otherwise each merge
    // onto the copy they loaded and one policy row would vanish with nothing
    // to show it ever existed.
    //
    // The closed periods, because reading them beforehand makes the answer a
    // photograph: a period closed between the photograph and the commit, and
    // the accountant's change sails into a month that was filed while it was
    // in flight. Firestore counts a transactional query in the read set, so
    // closing a period mid-flight aborts this and the retry sees it closed —
    // and the refusal and the write are then made on ONE snapshot.
    const [settingsSnap, closedThrough] = await Promise.all([
      tx.get(ref), latestClosedPeriodIn(db, tx),
    ]);
    const current = readSettings(settingsSnap);
    const retroactive = gateRetroactive({
      effectiveFrom, closedThrough, role, reason: why, what: 'تغيير السياسة الضريبية',
    });
    // A test seam, and named as one: it runs after the reads and before the
    // writes, so a test can close a period mid-transaction and prove the retry
    // sees it. Nothing in production passes it.
    if (onBeforeCommit) await onBeforeCommit();

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
export async function seedTaxPolicy(db, FieldValue, { baselineFrom, note = null }, {
  userId = null, role = 'accountant', onBeforeCommit = null,
} = {}) {
  if (!isRealPolicyDate(baselineFrom)) {
    throw new TaxPolicyError('تاريخ بداية السياسة مطلوب ويجب أن يكون تاريخاً حقيقياً (YYYY-MM-DD).');
  }

  // ── لماذا لا يحتاج السَّقْف حارساً كالتغيير ──
  // Seeding changes no figure. Before it, `taxPolicyAt(anything)` already
  // returned the current values for every date — as an unlabelled assumption.
  // After it, every date on or after the baseline resolves to those SAME
  // values, and only the dates before it change: from a silently-assumed
  // number to a declared gap. A closed month is therefore untouched, and
  // gating on it would be theatre.
  //
  // The real hazard is the opposite one, and it IS gated: a baseline set
  // AFTER an entry that has already been posted makes that entry's month
  // unanswerable — the books would hold a figure the policy record cannot
  // explain. So the earliest posted entry is read, and a baseline later than
  // it is refused with the date to use instead.
  //
  // ── ولماذا القراءة داخل المعاملة ──
  // That check used to run BEFORE `runTransaction` opened. Between the scan
  // and the write, a 2024 entry could be posted; the seed had already decided
  // the books were empty, and it committed a 2026 baseline over a ledger that
  // now started in 2024. Nothing detected it afterwards — the books simply
  // held a month the policy record could not explain, and the next posting
  // into that month was refused for a reason two steps removed from its cause.
  //
  // Now the whole decision — read, judge, write, audit — is one transaction on
  // one snapshot. See `earliestEntryDateIn` for the two reads that make a
  // concurrent posting collide with it instead of slipping past.
  return db.runTransaction(async (tx) => {
    const ref = db.collection(SETTINGS_COL).doc(SETTINGS_DOC);
    // All reads first, as Firestore requires — and all of them before the
    // first `tx.set`, so a refusal below leaves NOTHING written: no history,
    // and no audit record of an attempt that never happened.
    const [settingsSnap, earliest] = await Promise.all([
      tx.get(ref), earliestEntryDateIn(db, tx),
    ]);
    // A test seam, and named as one: it runs after the reads and before the
    // writes, so a test can post an older entry mid-transaction and prove the
    // retry sees it. Nothing in production passes it.
    if (onBeforeCommit) await onBeforeCommit();

    if (earliest && String(baselineFrom).slice(0, 10) > earliest) {
      throw new TaxPolicyError(
        `تاريخ البداية ${baselineFrom} بعد أقدم قيد مُرحّل (${earliest}) — `
        + 'ذلك يجعل شهراً في الدفاتر بلا سياسة معروفة. ابدأ من تاريخ أقدم قيد أو قبله.',
        { code: 'failed-precondition' },
      );
    }

    const current = readSettings(settingsSnap);
    const history = seedTaxPolicyBaseline(current, baselineFrom, { note });
    const next = { ...current, taxPolicyHistory: history };
    tx.set(ref, { value: next, updatedBy: userId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection(AUDIT_COL).doc(), {
      action: 'tax-policy', collectionName: SETTINGS_COL, documentId: SETTINGS_DOC, userId,
      before: { historyLength: 0 },
      after: { baselineFrom, historyLength: 1, role, ...history[0] },
      note: `تهيئة السجل التاريخي للسياسة الضريبية من ${baselineFrom} — `
        + 'لا يغيّر أي رقم مُرحّل؛ يحوّل ما قبله من افتراض صامت إلى فجوة معلنة'
        + (note ? ` — ${note}` : ''),
      at: FieldValue.serverTimestamp(),
      atIso: new Date().toISOString(),
    });
    return next;
  });
}

/**
 * The date of the oldest entry in the books, read INSIDE a transaction.
 *
 * Two reads, and each closes a different half of the race:
 *
 *   1. **The guard document.** `counters/journal` is written by every
 *      transaction that creates an entry, and it carries `earliestEntryDate`
 *      as a running minimum (see `journalCounterUpdate` in ledger.js). Reading
 *      it here puts this transaction in DIRECT conflict with any posting in
 *      flight: Firestore's document-level concurrency then aborts whichever
 *      commits second, and the retry reads the other's result. This is the
 *      guarantee; it does not depend on how query conflicts are detected.
 *
 *   2. **The ordered scan.** `orderBy('entryDate').limit(N)` — for a ledger
 *      written before the guard existed, whose counter has no bound recorded.
 *      A transactional query is part of the read set too, so an older entry
 *      appearing inside the window aborts this transaction as well.
 *
 * The answer is the EARLIER of the two: the guard can only be as old as the
 * postings that have run since it was introduced, and the scan can only see
 * what is stored. Neither alone is complete; the minimum of both is.
 */
export async function earliestEntryDateIn(db, tx) {
  const isIso = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

  const [boundsSnap, scanSnap] = await Promise.all([
    tx.get(db.collection(COUNTERS_COL).doc(JOURNAL_COUNTER)),
    tx.get(db.collection(ENTRIES_COL).orderBy('entryDate').limit(EARLIEST_SCAN)),
  ]);

  const guarded = boundsSnap.exists
    ? String(boundsSnap.data().earliestEntryDate || '').slice(0, 10) : '';

  let scanned = '';
  for (const d of scanSnap.docs) {
    const row = d.data();
    // A status this ledger does not recognise is not silently counted as a
    // live entry, and not silently skipped either — it simply is not one of
    // the two the books define.
    if (!COUNTED_ENTRY_STATUS.has(String(row.status || 'posted'))) continue;
    const iso = String(row.entryDate || '').slice(0, 10);
    if (isIso(iso)) { scanned = iso; break; }
  }

  const dates = [guarded, scanned].filter(isIso).sort();
  return dates.length ? dates[0] : null;
}

/**
 * The same question outside a transaction, for callers that only look.
 *
 * NOT for the seed: a bound read before a transaction opens is a photograph,
 * and the entry posted after it was taken is exactly the one that breaks the
 * books.
 */
export async function earliestEntryDate(db) {
  const snap = await db.collection(ENTRIES_COL).get();
  const dates = snap.docs
    .filter((d) => COUNTED_ENTRY_STATUS.has(String(d.data().status || 'posted')))
    .map((d) => String(d.data().entryDate || '').slice(0, 10))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))
    .sort();
  return dates.length ? dates[0] : null;
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
