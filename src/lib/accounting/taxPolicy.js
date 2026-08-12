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
  const rate = Number(input.vatRate);
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
      : (Number.isFinite(Number(fallback.vatRate)) ? Number(fallback.vatRate) : DEFAULT_VAT_RATE),
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

/**
 * Builds the history a policy change should leave behind.
 *
 * The FIRST change is the one that matters. Storing only the new row would
 * leave every earlier date unanswerable — or worse, answered by the new
 * policy. So it writes two rows: an explicit baseline for the policy that was
 * in force until now, and the change itself. `baselineFrom` is required for
 * that first change and is never inferred; it is the date the books start, or
 * the date the current policy began, and only the person doing it knows which.
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
    const baselineRow = {
      effectiveFrom: base, ...current, baseline: true,
      ...(baselineNote ? { note: String(baselineNote).slice(0, 300) } : {}),
    };
    // Same day: the baseline never existed as a separate period, so the change
    // simply IS the baseline.
    if (base === from) {
      return [{ effectiveFrom: from, ...proposed, baseline: true, ...(note ? { note } : {}) }];
    }
    return [baselineRow, { effectiveFrom: from, ...proposed, ...(note ? { note } : {}) }];
  }

  const unchanged = proposed.vatRegistered === current.vatRegistered
    && proposed.washPriceMode === current.washPriceMode
    && proposed.vatRate === current.vatRate;
  if (unchanged) return history;

  // A same-day edit REPLACES: correcting today's row twice must not leave the
  // loser readable as history.
  return [...history.filter((h) => h.effectiveFrom !== from),
    { effectiveFrom: from, ...proposed, ...(note ? { note } : {}) }]
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
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
