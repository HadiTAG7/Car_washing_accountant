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
  const match = String(dateStr || '').match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (!match) return '';
  const [, year, month, day] = match;
  const m = Number(month);
  const d = day == null ? 1 : Number(day);
  if (m < 1 || m > 12 || d < 1 || d > new Date(Number(year), m, 0).getDate()) return '';
  return `${year}-${String(m).padStart(2, '0')}`;
}

/** Current local month as YYYY-MM. */
export function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Render a YYYY-MM as an Arabic-language label, e.g. "مايو 2026". */
export function formatMonthLabel(ym) {
  if (ym === '__invalid__') return 'تواريخ غير صالحة أو مفقودة — تحتاج مراجعة';
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
    const ym = monthOf(w.washDate) || '__invalid__';
    if (ym) set.add(ym);
  });
  variables.forEach((v) => {
    const ym = monthOf(v.loggedDate) || '__invalid__';
    if (ym) set.add(ym);
  });
  return [...set].filter((key) => key !== '__invalid__').sort().reverse().concat(set.has('__invalid__') ? ['__invalid__'] : []);
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
 * rows for the selected month, applying the period filter, hiding manual
 * rows in dynamic categories, and auto-injecting one virtual row PER
 * (dynamic category × biker) so commissions are attributable per person:
 *
 *   1. Manual rows whose category is `isDynamic` are dropped entirely.
 *   2. Remaining manual rows are filtered to
 *      `monthOf(loggedDate) === selectedMonth`.
 *   3. Completed washes for the selected month are grouped by
 *      `bikerName` (trimmed; empty names bucket as "بدون اسم بايكر").
 *   4. For every dynamic category × biker pair with quantity > 0, one
 *      synthetic row is prepended:
 *        { id, categoryId, expenseName: `عمولات - ${name} (تلقائي)`,
 *          bikerName, quantity, unitCost, totalVariableCost, loggedDate,
 *          isVirtual: true }
 *
 * Virtual rows render before manual rows. Bikers are sorted by Arabic
 * locale order; the unattributed bucket always sorts last.
 */
export function variableItemsForMonth({
  manualItems = [],
  categories = [],
  selectedMonth,
  washes = [],
  dynamicUnitCost = DEFAULT_DYNAMIC_UNIT_COST,
}) {
  const dynamicIds = new Set(
    categories.filter((c) => c.isDynamic).map((c) => c.id),
  );

  // 1 + 2. Filter manual rows.
  const manualNonDynamicInMonth = manualItems.filter(
    (row) =>
      (selectedMonth === '__invalid__' || !dynamicIds.has(row.categoryId)) &&
      (monthOf(row.loggedDate) || '__invalid__') === selectedMonth,
  );

  // 3. Group completed washes for the selected month by biker name.
  const UNATTRIBUTED = '__UNATTRIBUTED__';
  const byBiker = new Map();
  for (const w of washes) {
    if (selectedMonth === '__invalid__') break;
    if (w.status !== 'مكتملة') continue;
    if (monthOf(w.washDate) !== selectedMonth) continue;
    const key = (w.bikerName || '').trim() || UNATTRIBUTED;
    byBiker.set(key, (byBiker.get(key) || 0) + (w.quantity || 0));
  }

  // Sort bikers — Arabic locale-aware; "unattributed" always last.
  const sortedBikers = [...byBiker.entries()].sort(([a], [b]) => {
    if (a === UNATTRIBUTED) return 1;
    if (b === UNATTRIBUTED) return -1;
    return a.localeCompare(b, 'ar');
  });

  // 4. Emit one virtual row per (dynamic category × biker with qty > 0).
  const virtualRows = [];
  for (const cat of categories) {
    if (!cat.isDynamic) continue;
    for (const [bikerKey, qty] of sortedBikers) {
      if (qty <= 0) continue;
      const displayName = bikerKey === UNATTRIBUTED ? 'بدون اسم بايكر' : bikerKey;
      virtualRows.push({
        id:                `virtual-${cat.id}-${selectedMonth}-${encodeURIComponent(bikerKey)}`,
        categoryId:        cat.id,
        expenseName:       `عمولات - ${displayName} (تلقائي)`,
        bikerName:         displayName,
        quantity:          qty,
        unitCost:          dynamicUnitCost,
        totalVariableCost: qty * dynamicUnitCost,
        loggedDate:        `${selectedMonth}-01`,
        isVirtual:         true,
      });
    }
  }

  return [...virtualRows, ...manualNonDynamicInMonth];
}
