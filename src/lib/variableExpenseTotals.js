// ═══════════════════════════════════════════════════════════════════════════
// Shared totals helpers — used by both VariableExpensesPage (per-row
// rendering + KPIs) and FinancialSummaryPage (aggregate net-profit calc).
// Kept pure so the same numbers appear everywhere a category's
// `is_dynamic` flag matters.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns the display-time effective row for one variable-expense item.
 * If the row's category is a dynamic (wash-linked) rule, quantity is
 * pulled live from the wash counter and total is computed from
 * `washCount × unitCost`. Otherwise the stored fields are returned as-is.
 */
export function effectiveVariableRow(item, categoryMap, washCount) {
  const cat = categoryMap?.get(item.categoryId);
  if (cat?.isDynamic) {
    return {
      quantity:          washCount,
      totalVariableCost: washCount * (item.unitCost || 0),
      isRule:            true,
    };
  }
  return {
    quantity:          item.quantity,
    totalVariableCost: item.totalVariableCost,
    isRule:            false,
  };
}

/** Sums effective totalVariableCost across an array of variable items. */
export function sumVariableTotal(items, categoryMap, washCount) {
  return (items || []).reduce(
    (acc, item) => acc + effectiveVariableRow(item, categoryMap, washCount).totalVariableCost,
    0,
  );
}

/** Sums the `quantity` column across rows where status === 'مكتملة'. */
export function sumCompletedWashQuantity(washes) {
  return (washes || [])
    .filter((w) => w.status === 'مكتملة')
    .reduce((sum, w) => sum + (w.quantity || 0), 0);
}
