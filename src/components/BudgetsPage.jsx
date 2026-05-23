import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Pencil, Target, Wallet, TrendingDown, AlertTriangle,
  Check, X, Receipt, Repeat, Sparkles, EyeOff, RotateCcw,
} from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import TopBar from './TopBar';
import { Card, StatCard, PrimaryButton } from './UI';
import AddBudgetModal from './AddBudgetModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useBudgets } from '../hooks/useBudgets';
import { useMonthlyExpenses } from '../hooks/useMonthlyExpenses';
import { useMonthlyExpenseCategories } from '../hooks/useMonthlyExpenseCategories';
import { useAnnualExpenses } from '../hooks/useAnnualExpenses';
import { useAnnualExpenseCategories } from '../hooks/useAnnualExpenseCategories';
import { useVariableExpenses } from '../hooks/useVariableExpenses';
import { useVariableExpenseCategories } from '../hooks/useVariableExpenseCategories';
import { useWashes } from '../hooks/useWashes';
import {
  todayMonth, monthOf, variableItemsForMonth,
} from '../lib/variableExpenseTotals';
import {
  isSupabaseConfigured, missingEnvNames, describeSupabaseError as describeError,
} from '../lib/supabaseClient';

function thisYear() { return new Date().getFullYear(); }
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

function readHidden() {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
function writeHidden(set) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage might be unavailable (private mode, quota, etc.)
  }
}
function hideKeyFor(budget) {
  return `${budget.budgetType}::${norm(budget.categoryLabel)}`;
}

function computeBudgetSpend({
  budget,
  monthlies, monthlyCatMap,
  annuals,   annualCatMap,
  variableItems, variableCatMap,
}) {
  const targetLabel = budget.categoryLabel;
  let spent = 0;
  const isMonthly = budget.budgetType === 'monthly';

  monthlies.forEach((m) => {
    const catLabel = monthlyCatMap.get(m.categoryId)?.label || '';
    if (matches(m.expenseName, targetLabel) || matches(catLabel, targetLabel)) {
      spent += isMonthly ? (m.totalMonthlyCost || 0) : (m.totalMonthlyCost || 0) * 12;
    }
  });

  annuals.forEach((a) => {
    const catLabel = annualCatMap.get(a.category)?.label || a.category || '';
    if (matches(a.expenseName, targetLabel) || matches(catLabel, targetLabel)) {
      spent += isMonthly ? (a.annualCost || 0) / 12 : (a.annualCost || 0);
    }
  });

  if (isMonthly) {
    variableItems.forEach((v) => {
      const catLabel = variableCatMap.get(v.categoryId)?.label || '';
      if (matches(v.expenseName, targetLabel) || matches(catLabel, targetLabel)) {
        spent += v.totalVariableCost || 0;
      }
    });
  } else {
    variableItems.annualMatching?.forEach((v) => {
      const catLabel = variableCatMap.get(v.categoryId)?.label || '';
      if (matches(v.expenseName, targetLabel) || matches(catLabel, targetLabel)) {
        spent += v.totalVariableCost || 0;
      }
    });
  }

  return Math.max(0, spent);
}

function progressColor(pct) {
  if (pct >= 100) return 'bg-red-500 animate-pulse';
  if (pct >= 70)  return 'bg-amber-500';
  return 'bg-emerald-500';
}

// ─── Budget card (inline editable amount) ────────────────────────────────
function BudgetCard({ budget, allocated, spent, onSaveAmount, onDelete, onEditFull, onHide }) {
  const isVirtual = Boolean(budget.isVirtual);
  const remaining = allocated - spent;
  const pct = allocated > 0 ? Math.min((spent / allocated) * 100, 200) : 0;
  const overspent = remaining < 0;
  const isDanger = allocated > 0 && pct >= 100;
  const fill = progressColor(pct);
  const widthPct = Math.min(100, (spent / Math.max(allocated, 1)) * 100);

  const typeBadge = budget.budgetType === 'annual'
    ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-400 border-primary-100 dark:border-primary-500/30'
    : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-500/30';

  // ── inline edit state ────────────────────────────────────────────────
  // Virtual cards (allocated=0, never persisted) start in always-on edit
  // mode so the user can type the target directly without clicking pencil.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(allocated > 0 ? String(allocated) : '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  function startEdit() {
    setDraft(allocated > 0 ? String(allocated) : '');
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function cancelEdit() {
    setDraft(String(allocated));
    setEditing(false);
  }
  async function commit() {
    const n = Math.max(0, parseFloat(draft) || 0);
    if (n === allocated) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSaveAmount(n);
      setEditing(false);
    } catch {
      // page-level toast surfaces the error; keep edit open for retry
    } finally {
      setSaving(false);
    }
  }

  // Always-on inline input for virtual cards: no click needed.
  const showInlineInput = editing || (isVirtual && allocated === 0);

  // Visual emphasis: virtual cards (allocated = 0) get a dashed border so
  // they read as "needs a target" instead of "no progress".
  const containerClass = isVirtual && allocated === 0
    ? 'bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 p-5 shadow-sm dark:shadow-slate-950/40 transition-all duration-200 flex flex-col gap-4'
    : 'bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 shadow-sm dark:shadow-slate-950/40 hover:shadow-md dark:hover:shadow-slate-950/50 transition-all duration-200 flex flex-col gap-4';

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate" title={budget.categoryLabel}>
            {budget.categoryLabel}
          </h3>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${typeBadge}`}>
              {budget.budgetType === 'annual' ? 'سنوية' : 'شهرية'}
            </span>
            {isVirtual && allocated === 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 text-[11px] font-semibold">
                <Sparkles size={10} strokeWidth={2.4} />
                مكتشَفة تلقائياً
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isVirtual && (
            <button
              type="button"
              onClick={onEditFull}
              className="text-slate-400 dark:text-slate-500 hover:text-primary-700 dark:hover:text-primary-400 p-1.5 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
              aria-label={`تعديل ${budget.categoryLabel}`}
              title="تعديل التصنيف أو النوع"
            >
              <Pencil size={15} />
            </button>
          )}
          {isVirtual ? (
            <button
              type="button"
              onClick={onHide}
              className="text-accent-500 dark:text-accent-400 hover:text-white hover:bg-accent-600 dark:hover:bg-accent-500 p-1.5 rounded-lg ring-1 ring-accent-200 dark:ring-accent-500/40 transition-colors"
              aria-label={`إخفاء ${budget.categoryLabel}`}
              title="إخفاء البند من اللوحة"
            >
              <Trash2 size={15} strokeWidth={2.2} />
            </button>
          ) : (
            <button
              type="button"
              onClick={onDelete}
              className="text-accent-500 dark:text-accent-400 hover:text-white hover:bg-accent-600 dark:hover:bg-accent-500 p-1.5 rounded-lg ring-1 ring-accent-200 dark:ring-accent-500/40 transition-colors"
              aria-label={`حذف ${budget.categoryLabel}`}
              title="حذف الميزانية"
            >
              <Trash2 size={15} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      {/* Three figures */}
      <div className="grid grid-cols-3 gap-3">
        {/* Allocated — inline editable */}
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
          <div className="flex items-start justify-between gap-1">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">الميزانية المرصودة</p>
            {!showInlineInput && (
              <button
                type="button"
                onClick={startEdit}
                className="text-slate-400 dark:text-slate-500 hover:text-primary-700 dark:hover:text-primary-400 p-0.5 rounded transition-colors"
                title="تعديل المبلغ"
                aria-label="تعديل المبلغ"
              >
                <Pencil size={11} />
              </button>
            )}
          </div>
          {showInlineInput ? (
            <div className="mt-1 flex items-center gap-1">
              <input
                ref={inputRef}
                type="number"
                min="0"
                step="any"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')  { e.preventDefault(); commit(); }
                  if (e.key === 'Escape') { cancelEdit(); }
                }}
                onBlur={editing ? commit : undefined}
                placeholder="0"
                className="w-full px-1.5 py-1 border border-primary-200 dark:border-primary-500/40 rounded-md bg-white dark:bg-slate-800 text-sm font-extrabold text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-300 dark:focus:ring-primary-500/40"
              />
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); commit(); }}
                disabled={saving}
                className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white transition-colors shrink-0"
                aria-label="حفظ"
                title="حفظ المبلغ"
              >
                <Check size={12} strokeWidth={2.5} />
              </button>
              {editing && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300 transition-colors shrink-0"
                  aria-label="إلغاء"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="block text-right w-full text-base font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5 hover:text-primary-700 dark:hover:text-primary-400 transition-colors"
              title="اضغط للتعديل"
            >
              {formatCurrency(allocated)}
            </button>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">المصروف الفعلي</p>
          <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {formatCurrency(spent)}
          </p>
        </div>
        <div className={`rounded-xl px-3 py-2.5 ${overspent
          ? 'bg-red-50 dark:bg-red-500/15 border border-red-100 dark:border-red-500/30'
          : 'bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100 dark:border-emerald-500/30'}`}>
          <p className={`text-[11px] leading-snug ${overspent
            ? 'text-red-700 dark:text-red-400'
            : 'text-emerald-700 dark:text-emerald-400'}`}>
            {overspent ? 'العجز عن الميزانية' : 'المتبقي في الميزانية'}
          </p>
          <p className={`text-base font-extrabold tabular-nums mt-0.5 ${overspent
            ? 'text-red-700 dark:text-red-300'
            : 'text-emerald-700 dark:text-emerald-300'}`}>
            {overspent ? '−' : ''}{formatCurrency(Math.abs(remaining))}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-[11px] font-semibold">
          <span className={`tabular-nums ${isDanger
            ? 'text-red-700 dark:text-red-400'
            : 'text-slate-600 dark:text-slate-400'}`}>
            {allocated > 0 ? `${pct.toFixed(1)}%` : '— %'}
          </span>
          {isDanger && (
            <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
              <AlertTriangle size={11} strokeWidth={2.5} />
              تجاوز الميزانية
            </span>
          )}
        </div>
        <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden" dir="ltr">
          <div
            className={`h-full rounded-full transition-all duration-500 ${fill}`}
            style={{ width: `${allocated > 0 ? (isDanger ? 100 : widthPct) : 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Section banner (bold divider + accent bar + counter pill) ────────────
function BudgetSection({
  title, subtitle, accent, icon: Icon, cards, onAddCustom,
  count, allocatedTotal, spentTotal,
}) {
  const accentChip = accent === 'annual'
    ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-400'
    : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400';

  // Vertical accent bar on the right (RTL leading edge) for a strong
  // visual hand-off between the Monthly and Annual rows.
  const accentBar = accent === 'annual'
    ? 'bg-gradient-to-b from-primary-500 to-primary-700'
    : 'bg-gradient-to-b from-amber-400 to-amber-600';

  const countPill = accent === 'annual'
    ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-800 dark:text-primary-300'
    : 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300';

  return (
    <Card className="overflow-hidden">
      {/* Section banner */}
      <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
        {/* RTL: leading-edge accent bar */}
        <div className={`absolute top-3 bottom-3 right-0 w-1 rounded-l-full ${accentBar}`} />

        <div className="flex items-start gap-3 min-w-0 flex-1 pr-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${accentChip}`}>
            {Icon && <Icon size={20} strokeWidth={2.3} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
                {title}
              </h2>
              <span className={`inline-flex items-center justify-center min-w-[1.75rem] h-6 px-2 rounded-full text-[11px] font-bold tabular-nums ${countPill}`}>
                {count}
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 mt-1">
              {subtitle}
            </p>
            {count > 0 && (
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {formatCurrency(spentTotal)}
                </span>
                {' '}مصروف من{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {formatCurrency(allocatedTotal)}
                </span>
                {' '}مرصود
              </p>
            )}
          </div>
        </div>

        {onAddCustom && (
          <PrimaryButton icon={Plus} onClick={onAddCustom} className="shrink-0">
            إضافة بند مخصّص
          </PrimaryButton>
        )}
      </div>

      {/* Section body */}
      <div className="p-4 sm:p-6">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${accentChip}`}>
              {Icon && <Icon size={20} strokeWidth={2.2} />}
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              لم تُكتشف تصنيفات حتى الآن
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              أضف أول مصروف في التبويب المعني ليظهر تصنيفه تلقائياً هنا، أو أضف بنداً مخصّصاً.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {cards}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function BudgetsPage() {
  const {
    items: budgets, loading: budgetsLoading, error: budgetsError,
    addItem, updateItem, deleteItem, refetch: refetchBudgets,
  } = useBudgets();

  const { items: monthlies, error: monthlyError, refetch: refetchMonthly } = useMonthlyExpenses();
  const { categories: monthlyCats }   = useMonthlyExpenseCategories();
  const { items: annuals,   error: annualError,  refetch: refetchAnnual }  = useAnnualExpenses();
  const { categories: annualCats }    = useAnnualExpenseCategories();
  const { items: variables, error: varError,     refetch: refetchVar }     = useVariableExpenses();
  const { categories: variableCats }  = useVariableExpenseCategories();
  const { items: washes,    error: washesError,  refetch: refetchWashes }  = useWashes();

  const [localOpen, setLocalOpen]       = useState(false);
  const [editingItem, setEditingItem]   = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });
  const [hiddenKeys, setHiddenKeys] = useState(() => readHidden());

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  const isModalOpen = localOpen || Boolean(editingItem);
  function openAddModal()      { setEditingItem(null); setLocalOpen(true); }
  function openEditModal(item) { setLocalOpen(false); setEditingItem(item); }
  function closeModal()        { setLocalOpen(false); setEditingItem(null); }

  const currentMonth = todayMonth();
  const currentYear  = String(thisYear());

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

  // ── Discover labels from BOTH the category tables AND the expense rows
  // themselves. This ensures a category that has actual expenses but no
  // entry in the category table (legacy data, manual SQL inserts) still
  // surfaces as a virtual budget card.
  const discoveredMonthlyLabels = useMemo(() => {
    const acc = new Map(); // normalized key → display label
    const add = (label) => {
      const key = norm(label);
      if (!key) return;
      if (!acc.has(key)) acc.set(key, String(label).trim());
    };
    monthlyCats.forEach((c) => add(c.label));
    monthlies.forEach((m) => {
      add(monthlyCatMap.get(m.categoryId)?.label);
      add(m.expenseName);
    });
    return acc;
  }, [monthlyCats, monthlies, monthlyCatMap]);

  const discoveredAnnualLabels = useMemo(() => {
    const acc = new Map();
    const add = (label) => {
      const key = norm(label);
      if (!key) return;
      if (!acc.has(key)) acc.set(key, String(label).trim());
    };
    annualCats.forEach((c) => add(c.label));
    annuals.forEach((a) => {
      add(annualCatMap.get(a.category)?.label);
      add(a.expenseName);
    });
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
  const cards = useMemo(() => mergedBudgets.map((b) => {
    const spent = computeBudgetSpend({
      budget: b,
      monthlies,
      monthlyCatMap,
      annuals,
      annualCatMap,
      variableItems: variableInputForBudget,
      variableCatMap,
    });
    return { budget: b, spent };
  }), [
    mergedBudgets, monthlies, monthlyCatMap, annuals, annualCatMap,
    variableInputForBudget, variableCatMap,
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

  // Suggestions for the modal's category-label input.
  const suggestions = useMemo(() => {
    const set = new Set();
    budgets.forEach((b) => b.categoryLabel && set.add(b.categoryLabel));
    discoveredMonthlyLabels.forEach((label) => set.add(label));
    discoveredAnnualLabels.forEach((label) => set.add(label));
    variableCats.forEach((c) => c.label && set.add(c.label));
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [budgets, discoveredMonthlyLabels, discoveredAnnualLabels, variableCats]);

  const anyError = budgetsError || monthlyError || annualError || varError || washesError;

  function retryAll() {
    refetchBudgets?.(); refetchMonthly?.(); refetchAnnual?.(); refetchVar?.(); refetchWashes?.();
  }

  // ── Mutation handlers ────────────────────────────────────────────────
  async function handleAddItem(item) {
    try { await addItem(item); showToast('تم رصد الميزانية بنجاح'); }
    catch (e) {
      setMutationError(e);
      showToast(describeError(e) || 'تعذّر حفظ الميزانية', 'error');
      throw e;
    }
  }
  async function handleUpdateItem(id, updates) {
    try { await updateItem(id, updates); showToast('تم حفظ التعديلات'); }
    catch (e) {
      setMutationError(e);
      showToast(describeError(e) || 'تعذّر حفظ التعديلات', 'error');
      throw e;
    }
  }
  async function handleSaveAmount(budget, newAmount) {
    if (budget.isVirtual) {
      // First time this category receives a budget — insert.
      await handleAddItem({
        categoryLabel: budget.categoryLabel,
        budgetType:    budget.budgetType,
        amount:        newAmount,
      });
    } else {
      await handleUpdateItem(budget.id, { amount: newAmount });
    }
  }
  async function handleDelete(item) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`هل تريد حذف ميزانية "${item.categoryLabel}"؟ لا يمكن التراجع.`)
      : true;
    if (!confirmed) return;
    try { await deleteItem(item.id); showToast('تم حذف الميزانية'); }
    catch (e) {
      setMutationError(e);
      showToast(describeError(e) || 'تعذّر حذف الميزانية', 'error');
    }
  }

  function handleHideVirtual(item) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('هل أنت متأكد من إخفاء هذا البند من لوحة الميزانيات؟')
      : true;
    if (!confirmed) return;
    const key = hideKeyFor(item);
    const next = new Set(hiddenKeys);
    next.add(key);
    writeHidden(next);
    setHiddenKeys(next);
    showToast(`تم إخفاء "${item.categoryLabel}" من اللوحة`);
  }

  function handleResetHidden() {
    if (hiddenKeys.size === 0) return;
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`إعادة إظهار ${hiddenKeys.size} بند مخفي على اللوحة؟`)
      : true;
    if (!confirmed) return;
    writeHidden(new Set());
    setHiddenKeys(new Set());
    showToast('تم إعادة إظهار جميع البنود المخفية');
  }

  const renderCards = (items) => items.map(({ budget, spent }) => (
    <BudgetCard
      key={budget.id}
      budget={budget}
      allocated={budget.amount}
      spent={spent}
      onSaveAmount={(amount) => handleSaveAmount(budget, amount)}
      onDelete={() => handleDelete(budget)}
      onEditFull={() => openEditModal(budget)}
      onHide={() => handleHideVirtual(budget)}
    />
  ));

  return (
    <>
      <TopBar
        title="الرقابة والميزانيات"
        subtitle="اكتشاف تلقائي لكل تصنيف ومراقبة الصرف الفعلي"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isSupabaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {anyError && (
          <ErrorState
            title="تعذّر تحميل بيانات الميزانية"
            error={anyError}
            onRetry={retryAll}
          />
        )}

        {mutationError && (
          <ErrorState
            title="تعذّر حفظ التغييرات"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}

        {/* Hidden-items banner — visible only when the user has dismissed
            at least one auto-discovered card. One click restores them all. */}
        {hiddenKeys.size > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <EyeOff size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
              <p className="text-sm">
                <span className="font-bold tabular-nums">{hiddenKeys.size}</span>
                {' '}بند مخفي من لوحة الميزانيات
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetHidden}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-primary-700 dark:text-primary-300 hover:text-white hover:bg-primary-700 dark:hover:bg-primary-600 border border-primary-200 dark:border-primary-500/40 transition-colors shrink-0"
            >
              <RotateCcw size={14} strokeWidth={2.3} />
              إعادة إظهار كافة البنود المخفية
            </button>
          </div>
        )}

        {/* Overall KPI row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          <StatCard
            icon={Target}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="إجمالي الميزانيات المرصودة"
            value={formatCurrency(totals.allocated)}
            sub={`${cards.length} ${cards.length === 1 ? 'بند' : 'بنود'} تحت المراقبة`}
          />
          <StatCard
            icon={TrendingDown}
            iconBg="bg-slate-100"
            iconColor="text-slate-700"
            label="إجمالي الصرف الفعلي"
            value={formatCurrency(totals.spent)}
            sub="موزع على كل البنود"
          />
          <StatCard
            icon={Wallet}
            iconBg={totals.remaining >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}
            iconColor={totals.remaining >= 0 ? 'text-emerald-600' : 'text-rose-600'}
            label={totals.remaining >= 0 ? 'المتبقي الإجمالي' : 'العجز الإجمالي'}
            value={`${totals.remaining >= 0 ? '' : '−'}${formatCurrency(Math.abs(totals.remaining))}`}
            sub="صافي الفرق بين الميزانية والصرف"
          />
        </div>

        {budgetsLoading && cards.length === 0 ? (
          <LoadingState rows={3} />
        ) : (
          <>
            {/* Row 1 — Monthly Operating Budgets */}
            <BudgetSection
              title="الميزانيات التشغيلية الشهرية"
              subtitle="تصنيفات المصاريف الشهرية المتكررة — تُكتشف وتُعرض تلقائياً من سجلاتك"
              accent="monthly"
              icon={Receipt}
              cards={renderCards(monthlyCards)}
              onAddCustom={() => openAddModal()}
              count={monthlyCards.length}
              allocatedTotal={monthlySectionTotals.allocated}
              spentTotal={monthlySectionTotals.spent}
            />

            {/* Visual divider between the two rows */}
            <div className="relative flex items-center my-2" aria-hidden="true">
              <div className="flex-1 h-px bg-gradient-to-l from-transparent via-slate-200 dark:via-slate-700 to-transparent" />
              <span className="px-3 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                ━ ━ ━
              </span>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-slate-700 to-transparent" />
            </div>

            {/* Row 2 — Annual / Capital Budgets */}
            <BudgetSection
              title="الميزانيات الرأسمالية السنوية"
              subtitle="تصنيفات سنوية وثابتة — تتجمّع تلقائياً من سجلّ المصاريف السنوية"
              accent="annual"
              icon={Repeat}
              cards={renderCards(annualCards)}
              onAddCustom={() => openAddModal()}
              count={annualCards.length}
              allocatedTotal={annualSectionTotals.allocated}
              spentTotal={annualSectionTotals.spent}
            />
          </>
        )}
      </main>

      <AddBudgetModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
        initialValues={editingItem}
        suggestions={suggestions}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        tone={toast.tone}
        duration={toast.duration}
        onClose={closeToast}
      />
    </>
  );
}
