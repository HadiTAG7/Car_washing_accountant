// ═══════════════════════════════════════════════════════════════════════════
// سياسة الضريبة بتاريخ سريان — the CLIENT's copy
// ═══════════════════════════════════════════════════════════════════════════
// The server's copy in functions/src/taxPolicy.js is the one that decides what
// a posted entry says. This one answers the reporting question: under which
// rules should an UNPOSTED record be read, and does the record cover the date
// at all?
//
// The duplication is the same deal as `validateEntry`: the server's copy
// governs what is written, the client's governs what is shown, and
// `functions/test/taxPolicy.test.js` drives both over one battery so they
// cannot drift.
//
// The rule that shapes both: `taxPolicyHistory` is the whole historical
// record. A date before its first row is UNKNOWN — answering it with today's
// settings is the bug this module exists to stop.
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_VAT_RATE = 0.15;

/** Why a policy could not be resolved for a date. */
export const POLICY_UNKNOWN = {
  BEFORE_BASELINE: 'before-baseline',
  BAD_DATE: 'bad-date',
};

/** How a resolved policy was arrived at. */
export const POLICY_SOURCE = {
  HISTORY: 'history',
  // No history recorded at all: an install that predates the dated policy and
  // has never been configured. The current values are ASSUMED to apply, and
  // saying so is the point of the label.
  UNVERSIONED: 'unversioned',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a date that exists. `Date.parse` ROLLS OVER — '2026-02-30'
 * silently becomes 2 March — so the parsed date is compared back to its parts.
 */
export function isRealPolicyDate(iso) {
  if (!ISO_DATE.test(String(iso || ''))) return false;
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** The three fields that decide what a wash's revenue is. */
export function normalizeTaxPolicy(input = {}, fallback = {}) {
  // `Number(null) === 0` — finite, in range, and it would silently return a
  // rate of ZERO where the caller meant "not stated, use the fallback". This is
  // the same trap that made a purchase with no stated VAT amount deduct as a
  // zero-VAT purchase; see src/lib/vatFields.js. An explicit 0 IS a rate (a
  // business that is not registered), so the three states are separated by hand
  // rather than left to coercion.
  const unstated = (v) => v === null || v === undefined || String(v).trim() === '';
  const rate = unstated(input.vatRate) ? NaN : Number(input.vatRate);
  const fallbackRate = unstated(fallback.vatRate) ? NaN : Number(fallback.vatRate);
  const registered = typeof input.vatRegistered === 'boolean'
    ? input.vatRegistered
    : (fallback.vatRegistered !== false);
  return {
    vatRegistered: registered,
    washPriceMode: input.washPriceMode === 'exclusive'
      ? 'exclusive'
      : (input.washPriceMode === 'inclusive' ? 'inclusive' : (fallback.washPriceMode || 'inclusive')),
    vatRate: Number.isFinite(rate) && rate >= 0 && rate < 1
      ? rate
      : (Number.isFinite(fallbackRate) ? fallbackRate : DEFAULT_VAT_RATE),
  };
}

/**
 * Cleans a stored history into ascending order, dropping anything undated.
 *
 * An undated row cannot say when it took effect, and keeping it would let it
 * masquerade as the baseline — which is the whole bug over again.
 */
export function normalizeTaxPolicyHistory(history, current = {}) {
  return (Array.isArray(history) ? history : [])
    .filter((h) => isRealPolicyDate(h?.effectiveFrom))
    .map((h) => ({
      effectiveFrom: String(h.effectiveFrom).slice(0, 10),
      ...normalizeTaxPolicy(h, current),
      ...(h.note ? { note: String(h.note).slice(0, 300) } : {}),
      ...(h.baseline ? { baseline: true } : {}),
    }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** The first date the record covers, or null when nothing is recorded. */
export function taxPolicyBaselineDate(settings = {}) {
  const history = normalizeTaxPolicyHistory(settings.taxPolicyHistory, settings);
  return history.length ? history[0].effectiveFrom : null;
}

/** True once the history exists — i.e. the record can answer for past dates. */
export function hasTaxPolicyHistory(settings = {}) {
  return normalizeTaxPolicyHistory(settings.taxPolicyHistory, settings).length > 0;
}

/**
 * The policy in force on `date`.
 *
 * Returns `{ known, source, effectiveFrom, vatRegistered, washPriceMode,
 * vatRate }`. `known: false` means the record does not cover that date and the
 * caller must say so rather than substitute a number — `reason` says which
 * kind of gap it is.
 */
export function taxPolicyAt(date, settings = {}) {
  const current = normalizeTaxPolicy(settings, {});
  const history = normalizeTaxPolicyHistory(settings.taxPolicyHistory, current);

  if (history.length === 0) {
    // Nothing recorded: the pre-migration state. The current values are
    // assumed to hold for every date, and the label says it is an assumption.
    return { ...current, known: true, source: POLICY_SOURCE.UNVERSIONED, effectiveFrom: null };
  }

  const iso = String(date || '').slice(0, 10);
  if (!isRealPolicyDate(iso)) {
    return {
      known: false, reason: POLICY_UNKNOWN.BAD_DATE, source: POLICY_SOURCE.HISTORY,
      vatRegistered: null, washPriceMode: null, vatRate: null, effectiveFrom: null,
    };
  }

  let chosen = null;
  for (const h of history) {
    if (h.effectiveFrom <= iso) chosen = h; else break;
  }
  if (!chosen) {
    // Earlier than anything on record. Answering with today's settings is
    // exactly the mistake this module exists to stop.
    return {
      known: false, reason: POLICY_UNKNOWN.BEFORE_BASELINE, source: POLICY_SOURCE.HISTORY,
      vatRegistered: null, washPriceMode: null, vatRate: null,
      baselineFrom: history[0].effectiveFrom, effectiveFrom: null,
    };
  }
  return {
    ...normalizeTaxPolicy(chosen, current),
    known: true, source: POLICY_SOURCE.HISTORY, effectiveFrom: chosen.effectiveFrom,
  };
}

/** Problems that stop a policy change. Arabic, because a user reads them. */
export class TaxPolicyError extends Error {
  constructor(message, { code = 'invalid-argument' } = {}) {
    super(message);
    this.name = 'TaxPolicyError';
    this.code = code;
  }
}

/** Do two policies say the same thing? */
export function samePolicy(a, b) {
  if (!a || !b) return false;
  return a.vatRegistered === b.vatRegistered
    && a.washPriceMode === b.washPriceMode
    && a.vatRate === b.vatRate;
}

/**
 * Sorts, de-duplicates by date, and marks exactly the earliest row `baseline`.
 *
 * Exactly one baseline: it is the date the record BEGINS, and two rows both
 * claiming to be the beginning is not a record anyone can read. A row inserted
 * before the old first row becomes the beginning; the old one stops being it.
 */
function finaliseHistory(rows) {
  const byDate = new Map();
  for (const r of rows) byDate.set(r.effectiveFrom, r);
  const sorted = [...byDate.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return sorted.map((r, i) => {
    const { baseline, ...rest } = r;   // eslint-disable-line no-unused-vars
    return i === 0 ? { ...rest, baseline: true } : rest;
  });
}

/**
 * Builds the history a policy change should leave behind.
 *
 * The FIRST change is the one that matters. Storing only the new row would
 * leave every earlier date unanswerable — or worse, answered by the new
 * policy. So it writes two rows: an explicit baseline for the policy that was
 * in force until now, and the change itself. `baselineFrom` is required for
 * that first change and is never inferred; it is the date the books start, or
 * the date the current policy began, and only the person doing it knows which.
 *
 * ── ما الذي يجعل السطر "بلا أثر" ──
 * A new row is redundant only when the policy that would ALREADY apply on its
 * own effective date is the same policy. That is not the same question as
 * "does it match today's settings", which is what this used to ask — and the
 * difference is two whole classes of change:
 *
 *   • a FUTURE row returning to an earlier policy — baseline inclusive,
 *     September exclusive, October back to inclusive. October differs from
 *     September, which is what October follows; it happens to match today, and
 *     the old comparison dropped it. The transition simply disappeared.
 *   • a HISTORICAL correction to a policy that matches today — 5% from
 *     January, 15% from July, and March corrected to 15%. March differs from
 *     January; it matches today's 15%, and was dropped for that reason.
 *
 * So the row at `effectiveFrom` is removed first, the policy that WOULD apply
 * on that date without it is resolved, and the proposal is compared against
 * THAT.
 */
export function withTaxPolicyChange(settings = {}, next = {}, effectiveFrom, {
  baselineFrom = null, baselineNote = null, note = null,
} = {}) {
  const current = normalizeTaxPolicy(settings, {});
  const history = normalizeTaxPolicyHistory(settings.taxPolicyHistory, current);
  const proposed = normalizeTaxPolicy(next, current);

  if (!isRealPolicyDate(effectiveFrom)) {
    throw new TaxPolicyError('تاريخ سريان السياسة الضريبية مطلوب ويجب أن يكون تاريخاً حقيقياً (YYYY-MM-DD).');
  }
  const from = String(effectiveFrom).slice(0, 10);

  if (history.length === 0) {
    if (!isRealPolicyDate(baselineFrom)) {
      throw new TaxPolicyError(
        'أول تغيير يحتاج تاريخ بداية السياسة الحالية (أو بداية الدفاتر) — '
        + 'بدونه لا يمكن الإجابة عن أي شهر سابق، وافتراضه يعيد كتابة التاريخ بصمت.',
        { code: 'failed-precondition' },
      );
    }
    const base = String(baselineFrom).slice(0, 10);
    if (base > from) {
      throw new TaxPolicyError('تاريخ بداية السياسة الحالية بعد تاريخ سريان التغيير.');
    }
    // Same day: the baseline never existed as a separate period, so the change
    // simply IS the baseline.
    if (base === from) {
      return finaliseHistory([{ effectiveFrom: from, ...proposed, ...(note ? { note } : {}) }]);
    }
    return finaliseHistory([
      { effectiveFrom: base, ...current, ...(baselineNote ? { note: String(baselineNote).slice(0, 300) } : {}) },
      { effectiveFrom: from, ...proposed, ...(note ? { note } : {}) },
    ]);
  }

  // The history WITHOUT any row at this date, so an edit-in-place is judged
  // against what the date would inherit rather than against itself.
  const without = history.filter((h) => h.effectiveFrom !== from);
  const wouldApply = taxPolicyAt(from, { ...current, taxPolicyHistory: without });

  // Redundant only if the date already resolves to exactly this policy. When
  // it does and a row is sitting there, the row is normalised away: the
  // transition it described no longer exists.
  if (wouldApply.known && samePolicy(wouldApply, proposed)) {
    return finaliseHistory(without);
  }

  return finaliseHistory([...without, { effectiveFrom: from, ...proposed, ...(note ? { note } : {}) }]);
}

/**
 * Seeds the record without changing anything — "this is what has applied since
 * the books began". The honest first step for an install that has been running
 * on unversioned settings.
 */
export function seedTaxPolicyBaseline(settings = {}, baselineFrom, { note = null } = {}) {
  const history = normalizeTaxPolicyHistory(settings.taxPolicyHistory, settings);
  if (history.length > 0) {
    throw new TaxPolicyError('السجل التاريخي مُهيّأ بالفعل.', { code: 'already-exists' });
  }
  if (!isRealPolicyDate(baselineFrom)) {
    throw new TaxPolicyError('تاريخ بداية السياسة مطلوب ويجب أن يكون تاريخاً حقيقياً (YYYY-MM-DD).');
  }
  return [{
    effectiveFrom: String(baselineFrom).slice(0, 10),
    ...normalizeTaxPolicy(settings, {}),
    baseline: true,
    ...(note ? { note: String(note).slice(0, 300) } : {}),
  }];
}

/**
 * The flat fields kept for compatibility, derived from the history as of
 * `today`.
 *
 * A change effective next month must not move what today reads. Without this
 * the flat fields would be "the last row", and a future-dated change would
 * take effect the moment it was saved.
 */
export function currentPolicyFields(history, today) {
  const resolved = taxPolicyAt(today, { taxPolicyHistory: history });
  if (!resolved.known) return null;
  return {
    vatRegistered: resolved.vatRegistered,
    washPriceMode: resolved.washPriceMode,
    vatRate: resolved.vatRate,
  };
}
