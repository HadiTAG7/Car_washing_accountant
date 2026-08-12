// ═══════════════════════════════════════════════════════════════════════════
// سياسة الضريبة بتاريخ سريان — the settings that were in force THEN
// ═══════════════════════════════════════════════════════════════════════════
// `app_settings/accounting` holds two switches that decide what a wash's
// revenue actually is: whether the business charges VAT at all, and whether a
// wash price is quoted inclusive or exclusive of it. Both change over time —
// a business registers, a price list is re-quoted — and both were read as
// "whatever the document says today".
//
// That made history move. A July wash posted at 115 VAT-inclusive is 100 of
// revenue and 15 of tax, filed and gone. Flip the switch to `exclusive` in
// August and every screen that re-derives July from the raw wash rows suddenly
// reports 115 of revenue and a 15-riyal discrepancy that no amount of posting
// will ever close — because the discrepancy is not in the data, it is in the
// question.
//
// So the switches carry an EFFECTIVE DATE. `taxPolicyAt` answers "what were
// the rules on this date", and every figure derived from an operational row is
// derived under the rules of that row's own day.
//
// An install with no history reads exactly as it did before: the current
// values apply to all dates. That is the honest default — it says "we do not
// know when this was set", not "it was always this".
//
// The client keeps its own copy in src/lib/accounting/taxPolicy.js; the two are
// driven over the same battery in functions/test/taxPolicy.test.js.
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_VAT_RATE = 0.15;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The three fields that decide what a wash's revenue is. */
export function normalizeTaxPolicy(input = {}, fallback = {}) {
  const rate = Number(input.vatRate);
  return {
    vatRegistered: typeof input.vatRegistered === 'boolean'
      ? input.vatRegistered
      : (fallback.vatRegistered !== false),
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
 * An undated row cannot say when it took effect, and guessing would be the
 * whole bug over again.
 */
export function normalizeTaxPolicyHistory(history, current = {}) {
  return (Array.isArray(history) ? history : [])
    .filter((h) => ISO_DATE.test(String(h?.effectiveFrom || '')))
    .map((h) => ({ effectiveFrom: String(h.effectiveFrom).slice(0, 10), ...normalizeTaxPolicy(h, current) }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/**
 * The policy in force on `date`.
 *
 * The LATEST entry whose `effectiveFrom` is on or before the date wins. A date
 * earlier than every entry — a wash from before anyone recorded a policy —
 * falls back to the current settings, because inventing a policy for a period
 * nobody described would be worse than admitting the record starts later.
 */
export function taxPolicyAt(date, settings = {}) {
  const current = normalizeTaxPolicy(settings, {});
  const history = normalizeTaxPolicyHistory(settings.taxPolicyHistory, current);
  if (history.length === 0) return current;
  const iso = String(date || '').slice(0, 10);
  if (!ISO_DATE.test(iso)) return current;
  let chosen = null;
  for (const h of history) {
    if (h.effectiveFrom <= iso) chosen = h; else break;
  }
  return chosen ? normalizeTaxPolicy(chosen, current) : current;
}

/**
 * Appends a dated policy row when the tax fields actually change.
 *
 * Returns the history to store. A change on a date that already has a row
 * REPLACES it — correcting today's entry twice must not leave two rows for one
 * day with the loser still readable as history.
 */
export function withTaxPolicyChange(settings = {}, next = {}, effectiveFrom) {
  const current = normalizeTaxPolicy(settings, {});
  const history = normalizeTaxPolicyHistory(settings.taxPolicyHistory, current);
  const proposed = normalizeTaxPolicy(next, current);
  const unchanged = proposed.vatRegistered === current.vatRegistered
    && proposed.washPriceMode === current.washPriceMode
    && proposed.vatRate === current.vatRate;
  if (unchanged && history.length > 0) return history;

  const from = ISO_DATE.test(String(effectiveFrom || '')) ? String(effectiveFrom).slice(0, 10) : null;
  if (!from) return history;
  return [...history.filter((h) => h.effectiveFrom !== from), { effectiveFrom: from, ...proposed }]
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}
