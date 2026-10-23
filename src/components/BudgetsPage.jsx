import { translate } from '../i18n/locale';
import { useCallback, useRef, useState } from 'react';
import {
  Plus, Trash2, Pencil, Target, Wallet, TrendingDown, AlertTriangle,
  Check, X, Receipt, Repeat, Sparkles, EyeOff, RotateCcw,
} from 'lucide-react';
import { formatCurrencyPrecise } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, PrimaryButton, SecondaryButton, EmptyState,
} from './UI';
import AddBudgetModal from './AddBudgetModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useBudgetReadModel, readHidden, hideKeyFor } from '../hooks/useBudgetReadModel';
import { useBudgets } from '../hooks/useBudgets';
import { useMonthlyExpenses } from '../hooks/useMonthlyExpenses';
import { useMonthlyExpenseCategories } from '../hooks/useMonthlyExpenseCategories';
import { useAnnualExpenses } from '../hooks/useAnnualExpenses';
import { useAnnualExpenseCategories } from '../hooks/useAnnualExpenseCategories';
import { useAllAnnualEntries } from '../hooks/useAnnualExpenseEntries';
import { riyadhTodayISO } from '../lib/washesYesterday';
import { useVariableExpenses } from '../hooks/useVariableExpenses';
import { useVariableExpenseCategories } from '../hooks/useVariableExpenseCategories';
import { useWashes } from '../hooks/useWashes';
import {
  formatMonthLabel,
} from '../lib/variableExpenseTotals';
import {
  isFirebaseConfigured, missingEnvNames, describeBackendError as describeError,
} from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

const HIDDEN_STORAGE_KEY = 'hidden_budget_categories';
function writeHidden(set) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage might be unavailable (private mode, quota, etc.)
  }
}
function progressColor(pct) {
  if (pct > 100) return 'bg-rose-500 animate-pulse';
  if (pct >= 70)  return 'bg-amber-500';
  return 'bg-emerald-500';
}

// ─── Budget card (inline editable amount) ────────────────────────────────
export function BudgetCard({ budget, allocated, spent, commitment = 0, dueToDate = 0, items = [], hasExpenses = false, onSaveAmount, onDelete, onEditFull, onHide, canMutate = true }) {
  const isVirtual = Boolean(budget.isVirtual);
  const remaining = allocated - spent;
  const pct = allocated > 0 ? Math.min((spent / allocated) * 100, 200) : 0;
  const overspent = allocated > 0 && remaining < 0;
  const isDanger = overspent;
  const isComplete = allocated > 0 && spent >= allocated;
  const fill = progressColor(pct);
  const widthPct = Math.min(100, (spent / Math.max(allocated, 1)) * 100);

  const typeBadge = budget.budgetType === 'annual'
    ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-100 dark:border-primary-500/30'
    : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30';

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
  // Partners get a plain readout — no edit affordance, no auto-open for
  // virtual cards either (the underlying mutation is disallowed anyway).
  const showInlineInput = canMutate && (editing || (isVirtual && allocated === 0));

  // Visual emphasis: virtual cards (allocated = 0) get a dashed border so
  // they read as "needs a target" instead of "no progress".
  const containerClass = isVirtual && allocated === 0
    ? 'bg-white dark:bg-slate-900 rounded-smallcard border-2 border-dashed border-slate-200 dark:border-slate-700 p-5 transition-all duration-200 flex flex-col gap-4'
    : 'bg-white dark:bg-slate-900 rounded-smallcard border border-slate-100 dark:border-slate-800 p-5 transition-all duration-200 flex flex-col gap-4';

  return (
    <div className={containerClass} style={{ boxShadow: 'var(--sw-shadow-card)' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate" title={budget.categoryLabel}>
            {budget.categoryLabel}
          </h3>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-control border text-[11px] font-semibold ${typeBadge}`}>
              {budget.budgetType === 'annual' ? 'سنوية' : 'شهرية'}
            </span>
            {isVirtual && allocated === 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[11px] font-semibold">
                <Sparkles size={10} strokeWidth={2.4} />
                مكتشَفة تلقائياً
              </span>
            )}
          </div>
        </div>
        {canMutate && (
          <div className="flex items-center gap-1 shrink-0">
            {!isVirtual && (
              <button
                type="button"
                onClick={onEditFull}
                className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-300 p-1.5 rounded-control hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
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
                disabled={hasExpenses}
                className="sw-tap inline-flex items-center justify-center text-rose-600 dark:text-rose-400 hover:text-white hover:bg-rose-600 dark:hover:bg-rose-500 p-1.5 rounded-control ring-1 ring-rose-200 dark:ring-rose-500/40 transition-colors"
                aria-label={`إخفاء ${budget.categoryLabel}`}
                title={hasExpenses ? 'لا يمكن إخفاء تصنيف عليه مصاريف مسجلة' : 'إخفاء البند من اللوحة'}
              >
                <Trash2 size={15} strokeWidth={2.2} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onDelete}
                disabled={hasExpenses}
                className="sw-tap inline-flex items-center justify-center text-rose-600 dark:text-rose-400 hover:text-white hover:bg-rose-600 dark:hover:bg-rose-500 p-1.5 rounded-control ring-1 ring-rose-200 dark:ring-rose-500/40 transition-colors"
                aria-label={`حذف ${budget.categoryLabel}`}
                title={hasExpenses ? 'لا يمكن حذف ميزانية تصنيف عليه مصاريف مسجلة' : 'حذف الميزانية'}
              >
                <Trash2 size={15} strokeWidth={2.2} />
              </button>
            )}
          </div>
        )}
      </div>

      {allocated <= 0 && <p className="text-xs text-slate-500 dark:text-slate-400">ما انحددت ميزانية</p>}
      {budget.budgetType === 'annual' && <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
        <p>{items.join('، ') || 'لا توجد التزامات سنوية مسجلة'}</p>
        <p>الالتزام السنوي: <strong className="tabular-nums">{formatCurrencyPrecise(commitment)}</strong></p>
        <p>المستحق التقديري حتى اليوم: <strong className="tabular-nums">{formatCurrencyPrecise(dueToDate)}</strong></p>
        <p className="text-[10px] text-slate-500">توزيع إداري للأشهر المكتملة من يناير؛ ليس موعد استحقاق عقدي.</p>
      </div>}

      {/* Three figures */}
      <div className="grid grid-cols-3 gap-3">
        {/* Allocated — inline editable */}
        <div className="rounded-smallcard bg-slate-50 dark:bg-slate-800 px-3 py-2.5">
          <div className="flex items-start justify-between gap-1">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">الميزانية المرصودة</p>
            {canMutate && !showInlineInput && (
              <button
                type="button"
                onClick={startEdit}
                className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-300 p-0.5 rounded-control transition-colors"
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
                className="w-full px-1.5 py-1 border border-slate-200 dark:border-slate-700 rounded-control bg-white dark:bg-slate-800 text-sm font-extrabold text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
              />
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); commit(); }}
                disabled={saving}
                className="sw-tap inline-flex items-center justify-center w-6 h-6 rounded-control bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white transition-colors shrink-0"
                aria-label="حفظ"
                title="حفظ المبلغ"
              >
                <Check size={12} strokeWidth={2.5} />
              </button>
              {editing && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
                  className="sw-tap inline-flex items-center justify-center w-6 h-6 rounded-control bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300 transition-colors shrink-0"
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
              className="block text-right w-full text-base font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
              title="اضغط للتعديل"
            >
              {formatCurrencyPrecise(allocated)}
            </button>
          )}
        </div>
        <div className="rounded-smallcard bg-slate-50 dark:bg-slate-800 px-3 py-2.5">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{budget.budgetType === 'annual' ? 'المدفوع من سجل الدفعات' : 'المصروف الفعلي'}</p>
          <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {formatCurrencyPrecise(spent)}
          </p>
        </div>
        <div className={`rounded-smallcard px-3 py-2.5 ${allocated <= 0 ? 'bg-slate-50 dark:bg-slate-800 text-slate-500' : overspent
          ? 'bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30'
          : 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30'}`}>
          <p className={`text-[11px] leading-snug ${allocated <= 0 ? 'text-slate-500 dark:text-slate-400' : overspent
            ? 'text-rose-700 dark:text-rose-300'
            : 'text-emerald-700 dark:text-emerald-300'}`}>
            {allocated <= 0 ? 'ما انحددت ميزانية' : overspent ? 'العجز عن الميزانية' : 'المتبقي في الميزانية'}
          </p>
          <p className={`text-base font-extrabold tabular-nums mt-0.5 ${allocated <= 0 ? 'text-slate-500 dark:text-slate-400' : overspent
            ? 'text-rose-700 dark:text-rose-300'
            : 'text-emerald-700 dark:text-emerald-300'}`}>
            {allocated <= 0 ? '—' : <>{overspent ? '−' : ''}{formatCurrencyPrecise(Math.abs(remaining))}</>}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-[11px] font-semibold">
          <span className={`tabular-nums ${isDanger
            ? 'text-rose-700 dark:text-rose-300'
            : 'text-slate-600 dark:text-slate-400'}`}>
            {allocated > 0 ? `${pct.toFixed(1)}%` : '— %'}
          </span>
          {isDanger && (
            <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
              <AlertTriangle size={11} strokeWidth={2.5} />
              تجاوز الميزانية
            </span>
          )}
          {isComplete && !overspent && <span className="text-emerald-700 dark:text-emerald-300">اكتملت الميزانية</span>}
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
    ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300'
    : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300';

  // Vertical accent bar on the right (RTL leading edge) for a strong
  // visual hand-off between the Monthly and Annual rows.
  const accentBar = accent === 'annual'
    ? 'bg-primary-500'
    : 'bg-amber-500';

  const countPill = accent === 'annual'
    ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-800 dark:text-primary-300'
    : 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300';

  return (
    <Card className="overflow-hidden">
      {/* Section banner */}
      <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
        {/* RTL: leading-edge accent bar */}
        <div className={`absolute top-3 bottom-3 right-0 w-1 rounded-l-full ${accentBar}`} />

        <div className="flex items-start gap-3 min-w-0 flex-1 pr-3">
          <div className={`w-11 h-11 rounded-control flex items-center justify-center shrink-0 ${accentChip}`}>
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
                  {formatCurrencyPrecise(spentTotal)}
                </span>
                {' '}مصروف من{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {formatCurrencyPrecise(allocatedTotal)}
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
          <EmptyState
            compact
            icon={Icon}
            title="لم تُكتشف تصنيفات حتى الآن"
            hint="أضف أول مصروف في التبويب المعني ليظهر تصنيفه تلقائياً هنا، أو أضف بنداً مخصّصاً."
          />
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

  const monthlyRead = useMonthlyExpenses(), monthlyCategoryRead = useMonthlyExpenseCategories();
  const annualRead = useAnnualExpenses(), annualCategoryRead = useAnnualExpenseCategories();
  const variableRead = useVariableExpenses(), variableCategoryRead = useVariableExpenseCategories();
  const washRead = useWashes(), annualEntryRead = useAllAnnualEntries();
  const {items:monthlies}=monthlyRead, {categories:monthlyCats}=monthlyCategoryRead;
  const {items:annuals}=annualRead, {categories:annualCats}=annualCategoryRead;
  const {items:variables}=variableRead, {categories:variableCats}=variableCategoryRead;
  const {items:washes}=washRead;
  const { scalingFactor, canMutate } = usePartnerView();

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

  const today = riyadhTodayISO();
  const [selectedMonth, setSelectedMonth] = useState('');
  const currentMonth = selectedMonth || today.slice(0,7);
  const currentYear = today.slice(0,4);

  const { cards, monthlyCards, annualCards, monthlySectionTotals, annualSectionTotals, suggestions, elapsedMonths, annualIssues } = useBudgetReadModel({
    budgets, monthlies, monthlyCats, annuals, annualCats, variables, variableCats, washes,
    hiddenKeys, currentMonth, currentYear, scalingFactor, annualEntries:annualEntryRead.entries, asOfDate:today,
  });

  const sources=[monthlyRead,monthlyCategoryRead,annualRead,annualCategoryRead,variableRead,variableCategoryRead,washRead,annualEntryRead];
  const anyError = budgetsError || sources.find(s=>s.error)?.error;
  const loading = budgetsLoading || sources.some(s=>s.loading);

  function retryAll() {
    refetchBudgets?.(); sources.forEach(s=>s.refetch?.());
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
    if (cards.find(c=>c.budget.id===item.id)?.hasExpenses) { showToast('لا يمكن حذف ميزانية تصنيف عليه مصاريف مسجلة','error'); return; }
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(translate(`هل تريد حذف ميزانية "${item.categoryLabel}"؟ لا يمكن التراجع.`))
      : true;
    if (!confirmed) return;
    try { await deleteItem(item.id); showToast('تم حذف الميزانية'); }
    catch (e) {
      setMutationError(e);
      showToast(describeError(e) || 'تعذّر حذف الميزانية', 'error');
    }
  }

  function handleHideVirtual(item) {
    if (cards.find(c=>c.budget.id===item.id)?.hasExpenses) { showToast('لا يمكن إخفاء تصنيف عليه مصاريف مسجلة','error'); return; }
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(translate('هل أنت متأكد من إخفاء هذا البند من لوحة الميزانيات؟'))
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
      ? window.confirm(translate(`إعادة إظهار ${hiddenKeys.size} بند مخفي على اللوحة؟`))
      : true;
    if (!confirmed) return;
    writeHidden(new Set());
    setHiddenKeys(new Set());
    showToast('تم إعادة إظهار جميع البنود المخفية');
  }

  const renderCards = (rows) => rows.map(({ budget, spent, commitment, dueToDate, items, hasExpenses }) => (
    <BudgetCard
      key={budget.id}
      budget={budget}
      allocated={budget.amount}
      spent={spent}
      commitment={commitment} dueToDate={dueToDate} items={items} hasExpenses={hasExpenses}
      canMutate={canMutate}
      onSaveAmount={(amount) => handleSaveAmount(budget, amount)}
      onDelete={() => handleDelete(budget)}
      onEditFull={() => openEditModal(budget)}
      onHide={() => handleHideVirtual(budget)}
    />
  ));

  if(loading || anyError)return <><TopBar title="الرقابة والميزانيات"/><main className="p-5">{anyError ? <ErrorState title="تعذّر تحميل بيانات الميزانية كاملة" error={anyError} onRetry={retryAll}/> : <LoadingState rows={3}/>}</main></>;

  return (
    <>
      <TopBar
        title="الرقابة والميزانيات"
        subtitle="اكتشاف تلقائي لكل تصنيف ومراقبة الصرف الفعلي"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

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
          <div
            role="status"
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          >
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <EyeOff size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
              <p className="text-sm">
                <span className="font-bold tabular-nums">{hiddenKeys.size}</span>
                {' '}بند مخفي من لوحة الميزانيات
              </p>
            </div>
            <SecondaryButton
              icon={RotateCcw}
              onClick={handleResetHidden}
              className="shrink-0"
            >
              إعادة إظهار كافة البنود المخفية
            </SecondaryButton>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="budget-month" className="font-bold">شهر الميزانيات الشهرية</label>
          <input id="budget-month" type="month" lang="en" dir="ltr" value={currentMonth} max={today.slice(0,7)}
            onChange={e=>setSelectedMonth(e.target.value)} className="sw-input w-auto" />
          <span className="text-xs text-slate-500">{formatMonthLabel(currentMonth)} · الميزانيات المحفوظة أهداف شهرية متكررة، وليست نسخة مستقلة لكل شهر.</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5 space-y-3" aria-label="هذا الشهر">
            <h2 className="text-lg font-bold">هذا الشهر</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>الميزانية<p className="font-bold tabular-nums">{formatCurrencyPrecise(monthlySectionTotals.allocated)}</p></div>
              <div>الفعلي<p className="font-bold tabular-nums">{formatCurrencyPrecise(monthlySectionTotals.spent)}</p></div>
              <div>الفرق على البنود المرصودة<p className={`font-bold tabular-nums ${monthlySectionTotals.remaining<0?'text-rose-600 dark:text-rose-300':'text-emerald-600 dark:text-emerald-300'}`}>{formatCurrencyPrecise(monthlySectionTotals.remaining)}</p></div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">صرف بدون ميزانية: {formatCurrencyPrecise(monthlySectionTotals.unbudgetedSpent)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">الفرق يستبعد الصرف بلا ميزانية. الفعلي من المصاريف المسجلة والعمولات؛ لا يشمل مسير الرواتب.</p>
          </Card>
          <Card className="p-5 space-y-3" aria-label="هذه السنة">
            <h2 className="text-lg font-bold">هذه السنة · {currentYear}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>الالتزامات<p className="font-bold tabular-nums">{formatCurrencyPrecise(annualSectionTotals.commitment)}</p></div>
              <div>المدفوع<p className="font-bold tabular-nums">{formatCurrencyPrecise(annualSectionTotals.spent)}</p></div>
              <div>المتبقي<p className="font-bold tabular-nums">{formatCurrencyPrecise(annualSectionTotals.unpaid)}</p></div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">صرف بدون ميزانية: {formatCurrencyPrecise(annualSectionTotals.unbudgetedSpent)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">المستحق التقديري موزع على {elapsedMonths} أشهر مكتملة من يناير، لا من تاريخ تغطية العقد غير المحفوظ.</p>
          </Card>
        </div>
        {annualIssues.length>0 && <p role="alert" className="text-amber-700 dark:text-amber-300">دفعات سنوية بلا ربط أو تاريخ صالح: {annualIssues.length} — تحتاج مراجعة، ولم تدخل الإجمالي.</p>}
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
              onAddCustom={canMutate ? () => openAddModal() : null}
              count={monthlyCards.length}
              allocatedTotal={monthlySectionTotals.allocated}
              spentTotal={monthlySectionTotals.spent}
            />

            {/* Visual divider between the two rows */}
            <div className="relative flex items-center my-2" aria-hidden="true">
              <div className="flex-1 h-px bg-gradient-to-l from-transparent via-slate-200 dark:via-slate-700 to-transparent" />
              <span className="px-3 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                ━ ━ ━
              </span>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-slate-700 to-transparent" />
            </div>

            {/* Row 2 — Annual / Capital Budgets */}
            <BudgetSection
              title="الميزانيات السنوية"
              subtitle="الالتزام من المصاريف السنوية؛ المدفوع من الدفعات المسجلة فقط، وليس من حالة مدفوع."
              accent="annual"
              icon={Repeat}
              cards={renderCards(annualCards.filter(c=>c.commitment>0 || c.spent>0 || c.budget.amount>0))}
              onAddCustom={canMutate ? () => openAddModal() : null}
              count={annualCards.filter(c=>c.commitment>0 || c.spent>0 || c.budget.amount>0).length}
              allocatedTotal={annualSectionTotals.allocated}
              spentTotal={annualSectionTotals.spent}
            />
            <details className="text-sm"><summary className="cursor-pointer">تصنيفات سنوية بلا التزام أو دفعات</summary><p className="text-xs text-slate-500 my-2">هذه أسماء تصنيفات فقط، وليست التزامات مالية؛ منها تأمين العمال.</p><div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">{renderCards(annualCards.filter(c=>c.commitment===0 && c.spent===0 && c.budget.amount===0))}</div></details>
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
