// ═══════════════════════════════════════════════════════════════════════════
// Shared period + totals helpers — used by VariableExpensesPage and
// FinancialSummaryPage so both views compute the same numbers for any
// given month.
//
// Key idea: dynamic categories (e.g. "biker commissions") are NOT logged
// as manual rows. They appear as virtual rows auto-injected per selected
// month, with `quantity = washCountInMonth` and a fixed unit cost.
// Manual rows in dynamic categories are filtered out everywhere to keep
// the virtual row as the single source of truth for commissions.
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_DYNAMIC_UNIT_COST = 4;

export const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس',   'أبريل', 'مايو',   'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** Extract the YYYY-MM prefix from any 'YYYY-MM-DD'-shaped string. */
export function monthOf(dateStr) {
  return (dateStr || '').slice(0, 7);
}

/** Current local month as YYYY-MM. */
export function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Render a YYYY-MM as an Arabic-language label, e.g. "مايو 2026". */
export function formatMonthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const idx = parseInt(m, 10) - 1;
  return `${ARABIC_MONTHS[idx] || m} ${y}`;
}

/**
 * Union of months found in either source. Always includes the current
 * month so a fresh DB still has a default option. Sorted newest first.
 */
export function listAvailableMonths(washes = [], variables = []) {
  const set = new Set([todayMonth()]);
  washes.forEach((w) => {
    const ym = monthOf(w.washDate);
    if (ym) set.add(ym);
  });
  variables.forEach((v) => {
    const ym = monthOf(v.loggedDate);
    if (ym) set.add(ym);
  });
  return [...set].sort().reverse();
}

/**
 * Sum of completed-wash quantity for one specific YYYY-MM. Drives the
 * virtual biker-commissions row for that month.
 */
export function sumCompletedWashQuantityInMonth(washes = [], month) {
  if (!month) return 0;
  return washes
    .filter((w) => w.status === 'مكتملة' && monthOf(w.washDate) === month)
    .reduce((sum, w) => sum + (w.quantity || 0), 0);
}

/**
 * THE central helper. Returns the display-ready list of variable-expense
 * rows for the selected month, applying both the period filter and the
 * virtual-injection rule:
 *
 *   1. Manual rows whose category is `isDynamic` are dropped entirely.
 *   2. Remaining manual rows are filtered to `monthOf(loggedDate) === selectedMonth`.
 *   3. For every dynamic category, one synthetic row is prepended whose
 *      quantity = washCountInMonth and unitCost = DEFAULT_DYNAMIC_UNIT_COST.
 *      The synthetic row carries `isVirtual: true` so the UI can hide
 *      edit/delete actions on it.
 *
 * Virtual rows always render at the top of the list (most prominent),
 * followed by manual non-dynamic rows.
 */
export function variableItemsForMonth({
  manualItems = [],
  categories = [],
  selectedMonth,
  washCountInMonth = 0,
  dynamicUnitCost = DEFAULT_DYNAMIC_UNIT_COST,
}) {
  const dynamicIds = new Set(
    categories.filter((c) => c.isDynamic).map((c) => c.id),
  );

  const manualNonDynamicInMonth = manualItems.filter(
    (row) =>
      !dynamicIds.has(row.categoryId) &&
      monthOf(row.loggedDate) === selectedMonth,
  );

  const virtualRows = categories
    .filter((c) => c.isDynamic)
    .map((c) => ({
      id:                `virtual-${c.id}-${selectedMonth}`,
      categoryId:        c.id,
      expenseName:       `${c.label} (تلقائي)`,
      quantity:          washCountInMonth,
      unitCost:          dynamicUnitCost,
      totalVariableCost: washCountInMonth * dynamicUnitCost,
      loggedDate:        `${selectedMonth}-01`,
      isVirtual:         true,
    }));

  return [...virtualRows, ...manualNonDynamicInMonth];
}
