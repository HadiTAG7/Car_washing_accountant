import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Target, Wallet, TrendingDown, AlertTriangle,
} from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, PrimaryButton } from './UI';
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
import { isSupabaseConfigured, missingEnvNames, describeSupabaseError as describeError } from '../lib/supabaseClient';

function thisYear() {
  return new Date().getFullYear();
}
function yearOf(dateStr) {
  return (dateStr || '').slice(0, 4);
}

// Normalize for case-insensitive contains-style matching across Arabic /
// Latin labels. Trims, lowercases, collapses inner whitespace, and strips
// common separator punctuation so "سكن  العمال" or "سكن-العمال" still
// matches "سكن العمال".
function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    // Replace common separator punctuation with a space so
    // "سكن-العمال" / "housing/staff" still align with "سكن العمال".
    .replace(/[-_,./|]+/g, ' ')
    // Collapse every run of whitespace (incl. NBSP, tab, newline)
    // into a single ASCII space.
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

/**
 * Compute the actual amount spent against a budget envelope.
 *
 * Matches expenses across all three modules (monthly_expenses,
 * annual_expenses, variable_expenses) by:
 *   1. The expense_name, OR
 *   2. The expense's resolved category label (via the category-id maps
 *      for monthly + variable rows; via the `category` text key + the
 *      annual category map for annual rows).
 * Matching is normalized + case-insensitive + contains-style — so a
 * budget "سكن العمال" captures "إيجار سكن العمال" and rows under a
 * category labeled "سكن العمال".
 *
 * Period filter is applied based on the budget's type:
 *   - 'monthly': monthly recurring rows count once (full month); annual
 *     rows are amortized as annualCost / 12; variable rows count if
 *     their loggedDate is in the current local month.
 *   - 'annual': monthly recurring rows × 12; annual rows × 1; variable
 *     rows count if their loggedDate is in the current calendar year.
 */
function computeBudgetSpend({
  budget,
  monthlies, monthlyCatMap,
  annuals,   annualCatMap,
  variableItems, variableCatMap,
}) {
  const targetLabel = budget.categoryLabel;
  let spent = 0;
  const isMonthly = budget.budgetType === 'monthly';

  // ── monthly_expenses ────────────────────────────────────────────────
  monthlies.forEach((m) => {
    const catLabel = monthlyCatMap.get(m.categoryId)?.label || '';
    if (matches(m.expenseName, targetLabel) || matches(catLabel, targetLabel)) {
      spent += isMonthly ? (m.totalMonthlyCost || 0) : (m.totalMonthlyCost || 0) * 12;
    }
  });

  // ── annual_expenses ─────────────────────────────────────────────────
  // `a.category` is the category ID (foreign-key text); resolve the
  // user-visible label via the annual categories map before matching.
  annuals.forEach((a) => {
    const catLabel = annualCatMap.get(a.category)?.label || a.category || '';
    if (matches(a.expenseName, targetLabel) || matches(catLabel, targetLabel)) {
      spent += isMonthly ? (a.annualCost || 0) / 12 : (a.annualCost || 0);
    }
  });

  // Variable expenses (period-scoped). For monthly budgets we already
  // received the month-scoped + virtual-injected list. For annual budgets
  // we filter raw items by year.
  if (isMonthly) {
    variableItems.forEach((v) => {
      const catLabel = variableCatMap.get(v.categoryId)?.label || '';
      if (matches(v.expenseName, targetLabel) || matches(catLabel, targetLabel)) {
        spent += v.totalVariableCost || 0;
      }
    });
  } else {
    // Annual: build per-year set (manual rows logged in this year +
    // every dynamic-rule month's virtual contribution).
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
  if (pct >= 90)  return 'bg-amber-500';
  if (pct >= 70)  return 'bg-amber-500';
  return 'bg-emerald-500';
}

function BudgetCard({ budget, allocated, spent, onEdit, onDelete }) {
  const remaining = allocated - spent;
  const pct = allocated > 0 ? Math.min((spent / allocated) * 100, 200) : 0;
  const overspent = remaining < 0;
  const isDanger = pct >= 100;
  const fill = progressColor(pct);
  const widthPct = Math.min(100, (spent / Math.max(allocated, 1)) * 100);

  const typeBadge = budget.budgetType === 'annual'
    ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-400 border-primary-100 dark:border-primary-500/30'
    : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-500/30';

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 shadow-sm dark:shadow-slate-950/40 hover:shadow-md dark:hover:shadow-slate-950/50 transition-all duration-200 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
            {budget.categoryLabel}
          </h3>
          <div className="mt-1.5">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${typeBadge}`}>
              {budget.budgetType === 'annual' ? 'سنوية' : 'شهرية'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="text-slate-400 dark:text-slate-500 hover:text-primary-700 dark:hover:text-primary-400 p-1.5 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
            aria-label={`تعديل ${budget.categoryLabel}`}
            title="تعديل"
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-slate-400 dark:text-slate-500 hover:text-accent-600 dark:hover:text-accent-400 p-1.5 rounded-lg hover:bg-accent-50 dark:hover:bg-accent-500/10 transition-colors"
            aria-label={`حذف ${budget.categoryLabel}`}
            title="حذف"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Three figures */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">الميزانية المرصودة</p>
          <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {formatCurrency(allocated)}
          </p>
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
            {pct.toFixed(1)}%
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
            style={{ width: `${isDanger ? 100 : widthPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
        <Target size={26} />
      </div>
      <p className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">لم تُرصد أي ميزانية بعد</p>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 max-w-sm">
        ابدأ بإضافة أول ميزانية لتصنيف معين (سكن العمال، تأمين الأسطول، إلخ).
        سيقوم النظام بتطبيق الصرف الفعلي تلقائياً عند تسجيل المصاريف.
      </p>
      <PrimaryButton icon={Plus} onClick={onAdd}>
        إضافة ميزانية جديدة
      </PrimaryButton>
    </div>
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

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => {
    setToast((t) => ({ ...t, open: false }));
  }, []);

  const isModalOpen = localOpen || Boolean(editingItem);
  function openAddModal()      { setEditingItem(null); setLocalOpen(true); }
  function openEditModal(item) { setLocalOpen(false); setEditingItem(item); }
  function closeModal()        { setLocalOpen(false); setEditingItem(null); }

  const currentMonth = todayMonth();
  const currentYear  = String(thisYear());

  // Build category-id → category-object maps for label lookups.
  const monthlyCatMap = useMemo(() => {
    const m = new Map();
    monthlyCats.forEach((c) => m.set(c.id, c));
    return m;
  }, [monthlyCats]);

  // Annual category map — critical for matching annual_expenses, since
  // a.category is the category ID/key, not the display label.
  const annualCatMap = useMemo(() => {
    const m = new Map();
    annualCats.forEach((c) => m.set(c.id, c));
    return m;
  }, [annualCats]);

  const variableCatMap = useMemo(() => {
    const m = new Map();
    variableCats.forEach((c) => m.set(c.id, c));
    return m;
  }, [variableCats]);

  // For monthly budgets we use variableItemsForMonth (handles virtual
  // biker-commission rows for the current month). For annual budgets we
  // collect manual variable rows logged in the current year PLUS one
  // virtual row per dynamic category × month × biker, all within the year.
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
    // Manual rows logged anywhere in the current year (excluding rows in
    // dynamic categories — those become virtual rows below).
    const dynamicIds = new Set(variableCats.filter((c) => c.isDynamic).map((c) => c.id));
    const manualThisYear = variables.filter(
      (v) => !dynamicIds.has(v.categoryId) && yearOf(v.loggedDate) === currentYear,
    );

    // Virtual dynamic-rule contribution: for every month in `currentYear`
    // that has completed washes, add a per-biker row. Aggregated by
    // re-using variableItemsForMonth, then filtering its virtual outputs.
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

  const cards = useMemo(() => budgets.map((b) => {
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
  }), [budgets, monthlies, monthlyCatMap, annuals, annualCatMap, variableInputForBudget, variableCatMap]);

  // KPI totals across all budgets.
  const totals = useMemo(() => {
    let allocated = 0, spent = 0;
    cards.forEach((c) => {
      allocated += c.budget.amount || 0;
      spent     += c.spent;
    });
    const remaining = allocated - spent;
    return { allocated, spent, remaining };
  }, [cards]);

  // Suggestion list for the modal's category-label input — pull every
  // distinct category label across the four expense sources, plus
  // existing budget labels.
  const suggestions = useMemo(() => {
    const set = new Set();
    budgets.forEach((b) => b.categoryLabel && set.add(b.categoryLabel));
    monthlyCats.forEach((c) => c.label && set.add(c.label));
    annualCats.forEach((c) => c.label && set.add(c.label));
    variableCats.forEach((c) => c.label && set.add(c.label));
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [budgets, monthlyCats, annualCats, variableCats]);

  const anyError    = budgetsError || monthlyError || annualError || varError || washesError;
  const anyLoading  = budgetsLoading; // primary spinner driven by budgets fetch
  const isEmpty     = !budgets.length;

  function retryAll() {
    refetchBudgets?.(); refetchMonthly?.(); refetchAnnual?.(); refetchVar?.(); refetchWashes?.();
  }

  async function handleAddItem(item) {
    try { await addItem(item); showToast('تم رصد الميزانية بنجاح'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateItem(id, updates) {
    try { await updateItem(id, updates); showToast('تم حفظ التعديلات'); }
    catch (e) { setMutationError(e); throw e; }
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

  return (
    <>
      <TopBar
        title="الرقابة والميزانيات"
        subtitle="رصد الميزانيات لكل بند ومتابعة الصرف الفعلي تلقائياً"
      />

      <main className="p-8 space-y-6">
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

        {/* KPI row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <StatCard
            icon={Target}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="إجمالي الميزانيات المرصودة"
            value={formatCurrency(totals.allocated)}
            sub={`${budgets.length} ${budgets.length === 1 ? 'ميزانية' : 'ميزانيات'} نشطة`}
          />
          <StatCard
            icon={TrendingDown}
            iconBg="bg-slate-100"
            iconColor="text-slate-700"
            label="إجمالي الصرف الفعلي"
            value={formatCurrency(totals.spent)}
            sub="موزع على كل الميزانيات"
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

        {/* Budget cards */}
        <Card className="p-6">
          <SectionHeader
            title="بطاقات الميزانية"
            subtitle="كل ميزانية مرتبطة باسم بند؛ يتم احتساب الصرف تلقائياً من سجل المصاريف"
            action={
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة ميزانية جديدة
              </PrimaryButton>
            }
          />

          {anyLoading && isEmpty ? (
            <LoadingState rows={3} />
          ) : isEmpty ? (
            <EmptyState onAdd={openAddModal} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {cards.map(({ budget, spent }) => (
                <BudgetCard
                  key={budget.id}
                  budget={budget}
                  allocated={budget.amount}
                  spent={spent}
                  onEdit={() => openEditModal(budget)}
                  onDelete={() => handleDelete(budget)}
                />
              ))}
            </div>
          )}
        </Card>
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
