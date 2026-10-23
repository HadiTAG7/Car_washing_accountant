import { useMemo } from 'react';
import { monthOf, variableItemsForMonth } from '../lib/variableExpenseTotals';
function yearOf(dateStr) { return (dateStr || '').slice(0, 4); }

// Normalize for case-insensitive contains-style matching across Arabic /
// Latin labels. Trims, lowercases, replaces separator punctuation with a
// space, collapses every whitespace run.
function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[-_,./|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function matches(label, target) {
  if (!label || !target) return false;
  const a = norm(label);
  const b = norm(target);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// ── Hidden-virtuals persistence (localStorage) ───────────────────────────
// User can dismiss any auto-discovered (virtual) card; we persist the
// normalized key `${type}::${normLabel}` so the same row stays hidden
// across reloads. Real (DB-backed) rows aren't routed through this — they
// keep using Supabase delete.
const HIDDEN_STORAGE_KEY = 'hidden_budget_categories';

export function readHidden() {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
export function hideKeyFor(budget) {
  return `${budget.budgetType}::${norm(budget.categoryLabel)}`;
}

// Strict category roll-up: a budget card represents a CLASSIFICATION
// (التصنيف). Spending on individual items rolls up to whichever category
// the item belongs to. The expense's own `expense_name` is intentionally
// ignored during matching — only the resolved category label counts.
function computeBudgetSpend({
  budget,
  monthlies, monthlyCatMap,
  annuals,   annualCatMap,
  variableItems, variableCatMap,
  currentMonth, currentYear,
}) {
  const targetLabel = budget.categoryLabel;
  let spent = 0;
  const isMonthly = budget.budgetType === 'monthly';

  monthlies.forEach((m) => {
    const catLabel = monthlyCatMap.get(m.categoryId)?.label || '';
    if (!matches(catLabel, targetLabel)) return;

    if (m.recurrence === 'one_time') {
      const ymd = String(m.loggedDate || '');
      const ym  = ymd.slice(0, 7);
      const y   = ymd.slice(0, 4);
      if (isMonthly) {
        // One-time monthly: only counts toward the current month's budget
        // when its paid-on date falls in the current month.
        if (ym === currentMonth) spent += (m.totalMonthlyCost || 0);
      } else if (y === currentYear) {
        // For annual budgets, count one-time payments made this year.
        spent += (m.totalMonthlyCost || 0);
      }
      return;
    }
    // Recurring monthly: counts every month; × 12 against annual budgets.
    spent += isMonthly ? (m.totalMonthlyCost || 0) : (m.totalMonthlyCost || 0) * 12;
  });

  annuals.forEach((a) => {
    const catLabel = annualCatMap.get(a.category)?.label || a.category || '';
    if (!matches(catLabel, targetLabel)) return;
    spent += isMonthly ? (a.annualCost || 0) / 12 : (a.annualCost || 0);
  });

  if (isMonthly) {
    variableItems.forEach((v) => {
      const catLabel = variableCatMap.get(v.categoryId)?.label || '';
      if (matches(catLabel, targetLabel)) {
        spent += v.totalVariableCost || 0;
      }
    });
  } else {
    variableItems.annualMatching?.forEach((v) => {
      const catLabel = variableCatMap.get(v.categoryId)?.label || '';
      if (matches(catLabel, targetLabel)) {
        spent += v.totalVariableCost || 0;
      }
    });
  }

  return Math.max(0, spent);
}


// Shared unchanged read model of the budgets page. No writes or financial policy.
export function useBudgetReadModel({ budgets, monthlies, monthlyCats, annuals, annualCats, variables, variableCats, washes, hiddenKeys, currentMonth, currentYear, scalingFactor = 1 }) {
  // Build category-id → object maps for label lookups in the matcher.
  const monthlyCatMap = useMemo(() => {
    const m = new Map(); monthlyCats.forEach((c) => m.set(c.id, c)); return m;
  }, [monthlyCats]);
  const annualCatMap = useMemo(() => {
    const m = new Map(); annualCats.forEach((c) => m.set(c.id, c)); return m;
  }, [annualCats]);
  const variableCatMap = useMemo(() => {
    const m = new Map(); variableCats.forEach((c) => m.set(c.id, c)); return m;
  }, [variableCats]);

  // Per-month variable items (handles per-biker virtual rows).
  const variableForCurrentMonth = useMemo(
    () => variableItemsForMonth({
      manualItems: variables,
      categories:  variableCats,
      selectedMonth: currentMonth,
      washes,
    }),
    [variables, variableCats, currentMonth, washes],
  );
  const variableAnnualMatching = useMemo(() => {
    const dynamicIds = new Set(variableCats.filter((c) => c.isDynamic).map((c) => c.id));
    const manualThisYear = variables.filter(
      (v) => !dynamicIds.has(v.categoryId) && yearOf(v.loggedDate) === currentYear,
    );
    const months = new Set();
    washes.forEach((w) => {
      if (w.status === 'مكتملة' && yearOf(w.washDate) === currentYear) {
        const ym = monthOf(w.washDate);
        if (ym) months.add(ym);
      }
    });
    const virtualThisYear = [];
    months.forEach((ym) => {
      const items = variableItemsForMonth({
        manualItems: [],
        categories:  variableCats,
        selectedMonth: ym,
        washes,
      });
      items.forEach((row) => { if (row.isVirtual) virtualThisYear.push(row); });
    });
    return [...virtualThisYear, ...manualThisYear];
  }, [variables, variableCats, currentYear, washes]);

  const variableInputForBudget = useMemo(
    () => Object.assign([...variableForCurrentMonth], { annualMatching: variableAnnualMatching }),
    [variableForCurrentMonth, variableAnnualMatching],
  );

  // ── Strict category-only discovery ────────────────────────────────────
  // Pulls the unique set of CLASSIFICATION labels (التصنيف) — never the
  // individual expense_name. An expense like "سكن اول يوم" belongs to
  // (e.g.) "أخرى" and should roll its 200 ر.س up into that single card,
  // not generate a card of its own.
  //
  // Sources, in order:
  //   1. The category tables (monthly / variable / annual category lists)
  //      — these are the canonical label source.
  //   2. Each expense row's category, resolved through the cat map. This
  //      is a safety net only: it catches rows that point at a category
  //      which has since been deleted but whose label might still be
  //      meaningful. Expense names are never read.
  //
  // Variable categories live with the monthlies because variable spending
  // accrues monthly (per-biker commissions, fuel, supplies, etc.).
  const discoveredMonthlyLabels = useMemo(() => {
    const acc = new Map(); // normalized key → display label
    const add = (label) => {
      const key = norm(label);
      if (!key) return;
      if (!acc.has(key)) acc.set(key, String(label).trim());
    };
    monthlyCats.forEach((c)  => add(c.label));
    variableCats.forEach((c) => add(c.label));
    monthlies.forEach((m)    => add(monthlyCatMap.get(m.categoryId)?.label));
    variables.forEach((v)    => add(variableCatMap.get(v.categoryId)?.label));
    return acc;
  }, [monthlyCats, variableCats, monthlies, variables, monthlyCatMap, variableCatMap]);

  const discoveredAnnualLabels = useMemo(() => {
    const acc = new Map();
    const add = (label) => {
      const key = norm(label);
      if (!key) return;
      if (!acc.has(key)) acc.set(key, String(label).trim());
    };
    annualCats.forEach((c) => add(c.label));
    annuals.forEach((a)    => add(annualCatMap.get(a.category)?.label));
    return acc;
  }, [annualCats, annuals, annualCatMap]);

  // ── Build the full budget list: real rows + virtual placeholders for
  // every discovered label that has no matching real budget row.
  const mergedBudgets = useMemo(() => {
    const realByKey = new Map();
    budgets.forEach((b) => {
      const key = `${b.budgetType}::${norm(b.categoryLabel)}`;
      realByKey.set(key, b);
    });

    const result = budgets.map((b) => ({ ...b, isVirtual: false }));

    discoveredMonthlyLabels.forEach((label, normKey) => {
      const key = `monthly::${normKey}`;
      if (realByKey.has(key)) return;
      if (hiddenKeys.has(key)) return;     // user-dismissed virtual
      result.push({
        id:            `virtual-monthly-${normKey}`,
        categoryLabel: label,
        budgetType:    'monthly',
        amount:        0,
        isVirtual:     true,
      });
      realByKey.set(key, true);
    });
    discoveredAnnualLabels.forEach((label, normKey) => {
      const key = `annual::${normKey}`;
      if (realByKey.has(key)) return;
      if (hiddenKeys.has(key)) return;     // user-dismissed virtual
      result.push({
        id:            `virtual-annual-${normKey}`,
        categoryLabel: label,
        budgetType:    'annual',
        amount:        0,
        isVirtual:     true,
      });
      realByKey.set(key, true);
    });

    return result;
  }, [budgets, discoveredMonthlyLabels, discoveredAnnualLabels, hiddenKeys]);

  // Compute spend per budget once; downstream sections slice by type.
  // Pro-rata: in the partner view we scale BOTH the allocated target
  // (budget.amount) and the actual spend so the over/under ratio stays
  // meaningful. Scaling only one would make every budget card read as
  // perpetually under-spent (or over-spent). Admin view uses
  // scalingFactor=1, leaving the math identical.
  const cards = useMemo(() => mergedBudgets.map((b) => {
    const rawSpent = computeBudgetSpend({
      budget: b,
      monthlies,
      monthlyCatMap,
      annuals,
      annualCatMap,
      variableItems: variableInputForBudget,
      variableCatMap,
      currentMonth,
      currentYear,
    });
    const scaledBudget = scalingFactor === 1
      ? b
      : { ...b, amount: (b.amount || 0) * scalingFactor };
    return { budget: scaledBudget, spent: rawSpent * scalingFactor };
  }), [
    mergedBudgets, monthlies, monthlyCatMap, annuals, annualCatMap,
    variableInputForBudget, variableCatMap, currentMonth, currentYear,
    scalingFactor,
  ]);

  const monthlyCards = useMemo(
    () => cards.filter((c) => c.budget.budgetType === 'monthly')
              .sort((a, b) => a.budget.categoryLabel.localeCompare(b.budget.categoryLabel, 'ar')),
    [cards],
  );
  const annualCards = useMemo(
    () => cards.filter((c) => c.budget.budgetType === 'annual')
              .sort((a, b) => a.budget.categoryLabel.localeCompare(b.budget.categoryLabel, 'ar')),
    [cards],
  );

  // Page-level KPIs across both rows.
  const totals = useMemo(() => {
    let allocated = 0, spent = 0;
    cards.forEach((c) => {
      allocated += c.budget.amount || 0;
      spent     += c.spent;
    });
    return { allocated, spent, remaining: allocated - spent };
  }, [cards]);

  const monthlySectionTotals = useMemo(() => {
    let a = 0, s = 0;
    monthlyCards.forEach((c) => { a += c.budget.amount || 0; s += c.spent; });
    return { allocated: a, spent: s };
  }, [monthlyCards]);
  const annualSectionTotals = useMemo(() => {
    let a = 0, s = 0;
    annualCards.forEach((c) => { a += c.budget.amount || 0; s += c.spent; });
    return { allocated: a, spent: s };
  }, [annualCards]);

  // Suggestions for the modal's category-label input — category names only,
  // no individual expense names. Pulls from existing budgets + the strict
  // category-only discovery maps built above.
  const suggestions = useMemo(() => {
    const set = new Set();
    budgets.forEach((b) => b.categoryLabel && set.add(b.categoryLabel));
    discoveredMonthlyLabels.forEach((label) => set.add(label));
    discoveredAnnualLabels.forEach((label) => set.add(label));
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [budgets, discoveredMonthlyLabels, discoveredAnnualLabels]);

  return { cards, monthlyCards, annualCards, totals, monthlySectionTotals, annualSectionTotals, suggestions };
}
