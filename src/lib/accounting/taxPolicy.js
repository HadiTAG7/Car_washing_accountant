// ═══════════════════════════════════════════════════════════════════════════
// سياسة الضريبة بتاريخ سريان — the CLIENT's copy
// ═══════════════════════════════════════════════════════════════════════════
// The server's copy in functions/src/taxPolicy.js is the one that decides what
// a posted entry says. This one answers the reporting question: under which
// rules should an UNPOSTED wash be read?
//
// The duplication is the same deal as `validateEntry`: the server's copy
// governs what is written, the client's governs what is shown, and
// `functions/test/taxPolicy.test.js` drives both over one battery so they
// cannot drift.
//
// Why any of this exists: `vatRegistered` and `washPriceMode` decide whether a
// 115-riyal wash is 100 + 15 or 115 + 0. Read as "whatever the setting says
// today", flipping the switch in August silently restated every July figure
// that is derived from raw wash rows — and produced a reconciliation gap
// exactly the size of the tax, which no amount of posting could close.
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

/** Ascending, and anything undated is dropped rather than guessed at. */
export function normalizeTaxPolicyHistory(history, current = {}) {
  return (Array.isArray(history) ? history : [])
    .filter((h) => ISO_DATE.test(String(h?.effectiveFrom || '')))
    .map((h) => ({ effectiveFrom: String(h.effectiveFrom).slice(0, 10), ...normalizeTaxPolicy(h, current) }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/**
 * The policy in force on `date` — the latest row effective on or before it.
 *
 * A date earlier than every row falls back to the current settings: inventing
 * a policy for a period nobody described would be worse than admitting the
 * record starts later.
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

/** Appends a dated row when the tax fields change; same-day edits replace. */
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
