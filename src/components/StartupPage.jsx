import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, Receipt, Scale, FileText, Percent, Link as LinkIcon,
} from 'lucide-react';
import {
  formatCurrency, formatNumber,
} from '../data/initialData';

// Only http(s) values become clickable — same guard the ledger and the VAT
// report use, so a pasted `javascript:` URL can never become a live anchor.
function isSafeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
  EmptyState as EmptyStateShell,
} from './UI';
import AddStartupFeeModal from './AddStartupFeeModal';
import ExpenseLedgerModal from './ExpenseLedgerModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useStartupCosts } from '../hooks/useStartupCosts';
import { useStartupCostEntries, useStartupLedgerParents } from '../hooks/useStartupCostEntries';
import { useCategories } from '../hooks/useCategories';
import PurchaseVatBadge from './PurchaseVatBadge';
import { useAccountingSettings } from '../hooks/useAccountingSettings';
import { taxPolicyAt } from '../lib/accounting/taxPolicy';
import { pendingStartupConversions } from '../lib/accounting/startupMigration';
import { convertStartupParentSpend } from '../lib/accounting/firestoreStartupMigration';
import StartupConversionModal from './StartupConversionModal';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

// ─── Formatted amount input (thousands separators) ─────────────────────────
// A text-driven numeric field that reads like "194,000" at rest but lets
// the admin edit the raw number on focus. Browsers reject non-numeric
// characters in type="number", so we drive a type="text" + inputMode
// "decimal" instead and own the formatting manually:
//   • at rest / on blur  → Intl-formatted via formatNumber (Latin digits)
//   • on focus           → comma-stripped raw number, select-all
//   • on commit          → strip commas, parseFloat, clamp ≥ 0
function FormattedAmountInput({ value, onCommit, ariaLabel, className }) {
  const [display, setDisplay]  = useState(() => formatNumber(value || 0));
  const [syncedValue, setSyncedValue] = useState(value);
  const [focused, setFocused]  = useState(false);

  // Re-sync from the prop when the parent pushes a new value (e.g. after
  // a refetch), but never clobber what the user is actively typing. This
  // is the React "adjust state during render" pattern — preferred over a
  // useEffect+setState, which triggers a cascading-render lint error.
  // Focus is tracked in state (not a ref) so it's safe to read here.
  if (value !== syncedValue && !focused) {
    setSyncedValue(value);
    setDisplay(formatNumber(value || 0));
  }

  function handleFocus(e) {
    setFocused(true);
    const raw = (value || 0).toString();
    setDisplay(raw === '0' ? '' : raw);
    requestAnimationFrame(() => e.target.select?.());
  }
  function handleChange(e) {
    // Permit only digits, commas, and a single decimal point while typing.
    setDisplay(e.target.value.replace(/[^\d.,]/g, ''));
  }
  function handleBlur() {
    setFocused(false);
    const parsed = parseFloat(String(display).replace(/,/g, ''));
    const safe   = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setDisplay(formatNumber(safe));
    onCommit(safe);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      aria-label={ariaLabel}
      className={className}
    />
  );
}

// ─── Status toggle pill (in_progress ↔ completed) ──────────────────────────
function StatusTogglePill({ status, onChange, disabled }) {
  const isCompleted = status === 'completed';
  const next        = isCompleted ? 'in_progress' : 'completed';
  const classes = isCompleted
    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
    : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20';
  const dot = isCompleted ? 'bg-emerald-600' : 'bg-amber-500';
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(next)}
      disabled={disabled}
      title={disabled
        ? 'غير متاح في وضع عرض الشريك'
        : isCompleted ? 'انقر لإعادة الحالة إلى قيد التنفيذ' : 'انقر لإنهاء البند'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${classes} ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {isCompleted ? 'مكتمل' : 'قيد التنفيذ'}
    </button>
  );
}

// ─── Empty-state for the table area ────────────────────────────────────────
function EmptyState({ onAdd, canMutate }) {
  return (
    <EmptyStateShell
      icon={FileText}
      title="لا توجد بنود تأسيس بعد"
      hint={canMutate
        ? 'أضف أول بند رسوم تأسيس لبدء تتبع الميزانية والصرف الفعلي.'
        : 'لم يقم المشرف بتسجيل أي بند بعد.'}
      action={canMutate ? (
        <PrimaryButton icon={Plus} onClick={onAdd}>
          إضافة رسوم تأسيس
        </PrimaryButton>
      ) : null}
    />
  );
}

export default function StartupPage({ pendingEntry, onClearPendingEntry }) {
  const {
    items, loading, error,
    addItem, updateItem, updateStatus, deleteItem, refetch,
  } = useStartupCosts();

  const { categories, getCategoryLabel, addCategory, deleteCategory } = useCategories();
  const { scalingFactor, canMutate } = usePartnerView();
  const { settings } = useAccountingSettings();
  // The dated tax record, so a 5%-era invoice is shown at 5% rather than at
  // today's rate. `useCallback`-free on purpose: `settings` is the only input
  // and it changes rarely. See docs/AMOUNT_DEFINITION.md.
  const policyAt = (date) => taxPolicyAt(date, settings);


  const [localOpen, setLocalOpen]       = useState(false);
  const [editingItem, setEditingItem]   = useState(null);
  // The item whose sub-ledger is open. The detail modal renders only
  // when this is non-null. Distinct from `editingItem` (which opens
  // the legacy "edit name/category/amounts" modal).
  const [detailItem, setDetailItem]     = useState(null);
  // Entries hook lives at page level so the shared ExpenseLedgerModal
  // stays a pure-UI component; null parentId disables the fetch.
  const detailLedger = useStartupCostEntries(detailItem?.id ?? null);
  // Which items are ledger-managed. Their inline actual-amount input is
  // locked (the ledger is the single writer for actual_amount there).
  const { parentIds: ledgerManagedIds, refetch: refetchLedgerParents } =
    useStartupLedgerParents();
  // ── بنود ما زالت تحمل مبلغاً فعلياً بلا قيد ──
  // Legacy rows from before the actual amount moved to the sub-ledger. They
  // are neither deducted nor discarded: the VAT report lists them as awaiting
  // conversion, and this is where the conversion happens.
  const [convertItem, setConvertItem] = useState(null);
  const pendingConversions = useMemo(
    () => pendingStartupConversions(items, ledgerManagedIds),
    [items, ledgerManagedIds],
  );
  const needsConversionIds = useMemo(
    () => new Set(pendingConversions.map((p) => p.id)),
    [pendingConversions],
  );
  const [mutationError, setMutationError] = useState(null);
  // Toast for inline-manager feedback (e.g. "category in use" warning).
  // Same shape as PartnersPage so swapping in the shared Toast UI is
  // pixel-stable across the dashboard.
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });
  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  // Set of category ids actually referenced by any startup item. The
  // inline-manager uses this to block deletion of categories still
  // wired to data. Memoised so the modal doesn't reconcile against a
  // new Set on every keystroke.
  const usedCategoryIds = useMemo(
    () => new Set(items.map((i) => i.category).filter(Boolean)),
    [items],
  );

  const isModalOpen = localOpen || Boolean(editingItem) || pendingEntry === 'item';
  function openAddModal()        { setEditingItem(null); setLocalOpen(true); }
  function openEditModal(item)   { setLocalOpen(false); setEditingItem(item); }
  function closeModal() {
    setLocalOpen(false);
    setEditingItem(null);
    if (pendingEntry) onClearPendingEntry?.();
  }

  // Pro-rata: every total/per-row figure on this page is scaled by the
  // viewing partner's workforce share. For the admin view scalingFactor=1
  // so the math collapses to identity.
  const totals = useMemo(() => {
    const planned = items.reduce((s, i) => s + i.plannedAmount, 0) * scalingFactor;
    const actual  = items.reduce((s, i) => s + i.actualAmount,  0) * scalingFactor;
    const variance = planned - actual;
    return { planned, actual, variance, ok: variance >= 0 };
  }, [items, scalingFactor]);

  async function handleAddItem(item) {
    try { await addItem(item); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateItem(id, updates) {
    try { await updateItem(id, updates); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateStatus(id, status) {
    try { await updateStatus(id, status); }
    catch (e) { setMutationError(e); }
  }
  async function handleDelete(id) {
    try { await deleteItem(id); }
    catch (e) { setMutationError(e); }
  }

  return (
    <>
      <TopBar
        title="رسوم التأسيس"
        subtitle="تتبع المصاريف التأسيسية لمرة واحدة لامتياز سويتر"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {mutationError && (
          <ErrorState
            title="تعذّر حفظ التغييرات"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}

        {error && (
          <ErrorState
            title="تعذّر تحميل بنود التأسيس"
            error={error}
            onRetry={refetch}
          />
        )}

        {/* ── KPI summary ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
          <StatCard
            className="col-span-2 md:col-span-1"
            icon={Wallet}
            tone="primary"
            label="إجمالي الميزانية المخططة"
            value={formatCurrency(totals.planned)}
            sub={`${items.length} ${items.length === 1 ? 'بند' : 'بنود'}`}
          />
          <StatCard
            icon={Receipt}
            tone="amber"
            label="إجمالي الصرف الفعلي"
            value={formatCurrency(totals.actual)}
            sub={
              totals.planned > 0
                ? `${((totals.actual / totals.planned) * 100).toFixed(0)}% من الميزانية`
                : 'لا توجد ميزانية بعد'
            }
          />
          <StatCard
            icon={Scale}
            tone={totals.ok ? 'emerald' : 'rose'}
            label={totals.ok ? 'المتبقي من الميزانية' : 'تجاوز الميزانية'}
            value={formatCurrency(Math.abs(totals.variance))}
            sub={totals.ok ? 'ضمن الحدود المخططة' : 'الإنفاق تجاوز المخطط'}
          />
        </div>

        {/* ── Main sunk-costs table ───────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="بنود رسوم التأسيس"
            subtitle={canMutate
              ? 'حرّر المبلغ الفعلي أو الحالة مباشرةً من الجدول'
              : 'عرض حصّتك من بنود التأسيس (للقراءة فقط)'}
            action={canMutate ? (
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة رسوم تأسيس
              </PrimaryButton>
            ) : null}
          />

          {loading && !items.length ? (
            <LoadingState rows={4} />
          ) : items.length === 0 ? (
            <EmptyState onAdd={openAddModal} canMutate={canMutate} />
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">البند</th>
                    <th className="py-3 px-4 whitespace-nowrap">التصنيف</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المبلغ المخطط</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المبلغ الفعلي</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المتبقي</th>
                    <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left w-16">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const qty = Math.max(1, parseInt(i.quantity, 10) || 1);
                    // Scale displayed per-row figures so the sum of rows
                    // matches the scaled KPI totals above. unit price is
                    // a *rate* — scale before dividing by quantity.
                    const rowPlanned = i.plannedAmount * scalingFactor;
                    const rowActual  = i.actualAmount  * scalingFactor;
                    const unitPlanned = qty > 0 ? rowPlanned / qty : 0;
                    // Remaining balance for this row, coherent with the
                    // scaled planned/actual shown beside it. Clamped at 0
                    // so an over-spend reads "0 ر.س." not a negative.
                    const rowRemaining = Math.max(0, rowPlanned - rowActual);
                    return (
                      <tr
                        key={i.id}
                        className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 whitespace-nowrap align-top">
                          {canMutate ? (
                            <button
                              type="button"
                              onClick={() => setDetailItem(i)}
                              className="font-medium text-slate-800 dark:text-slate-200 hover:text-primary-700 dark:hover:text-primary-400 hover:underline decoration-dotted underline-offset-4 transition-colors text-right"
                              title="فتح سجل المصاريف التفصيلي"
                            >
                              {i.itemName}
                            </button>
                          ) : (
                            <div className="font-medium text-slate-800 dark:text-slate-200">{i.itemName}</div>
                          )}
                          {qty > 1 && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                              الكمية: {formatNumber(qty)} | سعر الوحدة: {formatCurrency(unitPlanned)}
                            </div>
                          )}
                          {/* Item-level tax invoice. Ledger-managed items carry
                              their VAT on the entries instead, so the chip is
                              suppressed for them — matching what the report
                              actually counts. */}
                          {i.isTaxInvoice && !ledgerManagedIds.has(i.id) && i.actualAmount > 0 && (
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              <PurchaseVatBadge
                                row={{ ...i, amount: i.actualAmount }}
                                policyAt={policyAt} scale={scalingFactor} />
                              {i.invoiceUrl && isSafeHttpUrl(i.invoiceUrl) && (
                                <a
                                  href={i.invoiceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={i.invoiceUrl}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:underline"
                                >
                                  <LinkIcon size={11} />
                                  الفاتورة
                                </a>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap align-top">
                          <span className="inline-flex text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-control">
                            {getCategoryLabel(i.category)}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300 align-top">
                          {formatCurrency(rowPlanned)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left align-top">
                          {/* ── التكلفة الفعلية تُقرأ ولا تُكتب ──
                              It is SUM(entries), and every entry carries the
                              spend date, payment method and invoice identity
                              that make it postable. A figure typed straight
                              onto the item has none of the three, so nothing
                              could ever post it — `ADAPTERS.startup` reads
                              `startup_cost_entries`, and there is no adapter
                              for the parent. Rows that still hold a legacy
                              amount are converted, not edited. */}
                          <span
                            className="tabular-nums text-slate-700 dark:text-slate-300 font-medium"
                            title={canMutate ? 'مجموع سجل المصاريف — اضغط اسم البند لتسجيل دفعة' : undefined}
                          >
                            {formatCurrency(rowActual)}
                          </span>
                          {needsConversionIds.has(i.id) && (
                            <button
                              type="button"
                              onClick={() => canMutate && setConvertItem(i)}
                              disabled={!canMutate}
                              className="block mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline disabled:no-underline disabled:opacity-60"
                            >
                              يحتاج تحويلاً إلى قيد
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums align-top">
                          <span className={rowRemaining > 0
                            ? 'font-semibold text-amber-700 dark:text-amber-400'
                            : 'font-medium text-emerald-600 dark:text-emerald-400'}>
                            {formatCurrency(rowRemaining)}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap align-top">
                          <StatusTogglePill
                            status={i.status}
                            onChange={(next) => handleUpdateStatus(i.id, next)}
                            disabled={!canMutate}
                          />
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left align-top">
                          {canMutate && (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditModal(i)}
                                className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/15 transition-colors"
                                aria-label={`تعديل ${i.itemName}`}
                                title="تعديل البند"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(i.id)}
                                className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
                                aria-label={`حذف ${i.itemName}`}
                                title="حذف البند"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>

      <AddStartupFeeModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
        categories={categories}
        onAddCategory={addCategory}
        onDeleteCategory={deleteCategory}
        usedCategoryIds={usedCategoryIds}
        showToast={showToast}
        initialValues={editingItem}
      />

      <ExpenseLedgerModal
        isOpen={Boolean(detailItem)}
        onClose={() => setDetailItem(null)}
        title={detailItem ? `سجل مصاريف: ${detailItem.itemName}` : ''}
        plannedAmount={detailItem?.plannedAmount || 0}
        ledger={detailLedger}
        onDirty={() => { refetch(); refetchLedgerParents(); }}
        migrationFile="2026_06_startup_cost_entries_ALL.sql"
        uploadFolder={detailItem ? `startup/${detailItem.id}` : 'startup'}
      />

      <StartupConversionModal
        item={convertItem}
        onClose={() => setConvertItem(null)}
        onConvert={async (id, form) => {
          await convertStartupParentSpend(id, form);
          await refetch();
          await refetchLedgerParents();
          showToast('تم التحويل — صار المبلغ قيداً في سجل مصاريف البند، وقابلاً للترحيل.');
        }}
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
