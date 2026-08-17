// ═══════════════════════════════════════════════════════════════════════════
// تجميع بنود رسوم التأسيس بالتصنيف — دالة صافية تُحسب ولا تُخزَّن
// ═══════════════════════════════════════════════════════════════════════════
// The page was one flat table, which reads fine for eight unrelated items and
// badly the moment one real thing is split into several: five housing units
// scatter among the permits and the branding, and «كم صرفنا على السكن؟» — the
// question the split was made to answer — becomes arithmetic done by eye.
//
// So the rows group by the `category` they already carry, and each group
// carries its own planned / actual / remaining. Nothing is stored: a subtotal
// written into a document is a number that can disagree with the rows under
// it, which is the same reason `actual_amount` is re-derived server-side
// rather than trusted.
// ═══════════════════════════════════════════════════════════════════════════

/** بند بلا تصنيف — أو بتصنيفٍ حُذف من القائمة — لا يسقط، بل يُجمَع أخيراً. */
export const UNCATEGORIZED = '__uncategorized__';

/**
 * `[{ id, label, items, planned, actual, remaining }]`.
 *
 * Order follows `categories` (their own `sortOrder`), so the page and the
 * category manager agree; the uncategorised bucket is always last. Groups with
 * no items are dropped — an empty section is a header that promises rows and
 * delivers none.
 *
 * `remaining` floors at zero deliberately: an overspend is shown by the row's
 * own status, and a negative "remaining" in a subtotal reads as a credit.
 */
export function groupStartupItems(items = [], categories = []) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const buckets = new Map();

  for (const item of items) {
    // A category deleted from the list while items still point at it must not
    // take those items off the page — they fall to the uncategorised bucket,
    // visible and countable, rather than vanishing from a lookup miss.
    const key = item.category && byId.has(item.category) ? item.category : UNCATEGORIZED;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }

  const ordered = [...categories]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => c.id)
    .filter((id) => buckets.has(id));
  if (buckets.has(UNCATEGORIZED)) ordered.push(UNCATEGORIZED);

  return ordered.map((id) => {
    const groupItems = buckets.get(id);
    const planned = groupItems.reduce((s, i) => s + (Number(i.plannedAmount) || 0), 0);
    const actual = groupItems.reduce((s, i) => s + (Number(i.actualAmount) || 0), 0);
    return {
      id,
      label: id === UNCATEGORIZED ? 'بدون تصنيف' : (byId.get(id)?.label || 'بدون تصنيف'),
      items: groupItems,
      planned,
      actual,
      remaining: Math.max(0, planned - actual),
    };
  });
}
