import ScrollableTable from './ScrollableTable';
import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, CheckCircle2, Clock, CalendarClock, Repeat,
} from 'lucide-react';
import { formatCurrency, formatNumber, RECURRING_EXPENSE_CATEGORIES } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
  EmptyState as EmptyStateShell,
} from './UI';
import AddAnnualExpenseModal from './AddAnnualExpenseModal';
import ExpenseLedgerModal from './ExpenseLedgerModal';
import PaymentStatusPill from './PaymentStatusPill';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useAnnualExpenses } from '../hooks/useAnnualExpenses';
import { useAnnualExpenseEntries } from '../hooks/useAnnualExpenseEntries';
import { useAnnualExpenseCategories } from '../hooks/useAnnualExpenseCategories';
import { isFirebaseConfigured, missingEnvNames, describeBackendError } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

// True when today's month + day match the row's recurring payment date.
function isAnnualDueToday(paymentMonth, paymentDay) {
  if (!paymentMonth || !paymentDay) return false;
  const now = new Date();
  return now.getMonth() + 1 === Number(paymentMonth)
      && now.getDate() === Number(paymentDay);
}

function EmptyState({ onAdd, canMutate }) {
  return (
    <EmptyStateShell
      icon={Repeat}
      title="لا توجد مصاريف سنوية بعد"
      hint={canMutate
        ? 'أضف أول مصروف سنوي متكرر لمتابعة التكاليف التشغيلية المستمرة.'
        : 'لم يقم المشرف بتسجيل أي مصروف سنوي بعد.'}
      action={canMutate ? (
        <PrimaryButton icon={Plus} onClick={onAdd}>
          إضافة مصروف سنوي
        </PrimaryButton>
      ) : null}
    />
  );
}

function formatAnnualPaymentDate(month, day) {
  if (!month || !day) return '—';
  return `${formatNumber(day)} / ${formatNumber(month)} من كل عام`;
}

export default function AnnualExpensesPage() {
  const {
    items, loading, error,
    addItem, updateItem, updateStatus, deleteItem, refetch,
  } = useAnnualExpenses();

  const {
    categories, addCategory, deleteCategory, getCategoryLabel,
  } = useAnnualExpenseCategories();

  const { scalingFactor, canMutate } = usePartnerView();

  const [localOpen, setLocalOpen]         = useState(false);
  const [editingItem, setEditingItem]     = useState(null);
  // The expense whose payment sub-ledger is open (click on the expense
  // name). Distinct from `editingItem` (the edit-fields modal).
  // ── المعرّف يُخزَّن، والبند يُقرأ من القائمة الحيّة ──
  // Holding the OBJECT froze it: the modal kept showing the divisions the
  // item had when it was clicked, so a list edited while the ledger was open
  // rendered a picker for units that no longer existed. Same fix StartupPage
  // carries — one id in state, the row derived from the live list.
  const [detailItemId, setDetailItemId]   = useState(null);
  const detailItem = useMemo(
    () => (detailItemId ? items.find((i) => i.id === detailItemId) ?? null : null),
    [items, detailItemId],
  );
  // Entries hook lives at page level so the shared ExpenseLedgerModal
  // stays a pure-UI component; null parentId disables the fetch.
  const detailLedger = useAnnualExpenseEntries(detailItem?.id ?? null);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => {
    setToast((t) => ({ ...t, open: false }));
  }, []);

  // ── إسناد الدفعات إلى سكناتها ──
  // Filing already-recorded rent under the housing unit it paid for. Moves no
  // money — the item's total is the same payments either way — which is also
  // why the rules let it through on a POSTED entry.
  const handleAssignUnits = useCallback(async (assignments) => {
    try {
      setMutationError(null);
      await detailLedger.assignUnits(detailItemId, assignments);
      showToast(`أُسند ${assignments.length} دفعةً إلى تقسيماتها — المجموع والقيود لم تتغيّر`);
    } catch (e) {
      console.error('🔥 Firestore Error (AnnualExpensesPage.handleAssignUnits):', e);
      setMutationError(e);
      showToast(describeBackendError(e) || e?.message || 'تعذّر إسناد الدفعات', 'error');
    }
  }, [detailLedger, detailItemId, showToast]);

  const isModalOpen = localOpen || Boolean(editingItem);
  function openAddModal()      { setEditingItem(null); setLocalOpen(true); }
  function openEditModal(item) { setLocalOpen(false); setEditingItem(item); }
  function closeModal()        { setLocalOpen(false); setEditingItem(null); }

  const totals = useMemo(() => {
    let total = 0, paid = 0;
    items.forEach((i) => {
      total += i.annualCost;
      // Paid per item is a hybrid of the two workflows:
      //  • status === 'paid'  → count the full annualCost (covers admins
      //    who flip the pill manually without itemizing the ledger)
      //  • otherwise → count the ledger's partial payments (actualAmount),
      //    capped at annualCost so an over-recorded ledger can't inflate
      //    the KPI beyond the planned figure.
      // Before this, a 12,000 expense with 3,000 recorded showed
      // المدفوع = 0 while its table row showed المدفوع = 3,000.
      paid += i.paymentStatus === 'paid'
        ? i.annualCost
        : Math.min(i.actualAmount || 0, i.annualCost);
    });
    const pending = Math.max(0, total - paid);
    // Pro-rata: scale aggregates by the viewing partner's share.
    return {
      total:   total   * scalingFactor,
      paid:    paid    * scalingFactor,
      pending: pending * scalingFactor,
    };
  }, [items, scalingFactor]);

  async function handleAddItem(item) {
    try { await addItem(item); showToast('تم إضافة المصروف بنجاح'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateItem(id, updates) {
    try { await updateItem(id, updates); showToast('تم حفظ التعديلات'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleAddCategory(label) {
    try {
      const newId = await addCategory({ label });
      showToast('تم إضافة التصنيف الجديد بنجاح');
      return newId;
    } catch (e) {
      console.error('Firestore Category Error:', e, 'label:', label);
      const friendly = describeBackendError(e) || 'تعذّر إضافة التصنيف الجديد';
      showToast(friendly, 'error');
      throw e; // re-throw so the modal can also display the inline error
    }
  }
  async function handleDeleteCategory(id) {
    try {
      await deleteCategory(id);
      showToast('تم حذف التصنيف من القوائم');
    } catch (e) {
      showToast(describeBackendError(e) || 'تعذّر حذف التصنيف', 'error');
      throw e;
    }
  }
  async function handleUpdateStatus(id, status) {
    try { await updateStatus(id, status); }
    catch (e) { setMutationError(e); }
  }
  async function handleDelete(item) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`هل تريد حذف "${item.expenseName}"؟ لا يمكن التراجع.`)
      : true;
    if (!confirmed) return;
    try { await deleteItem(item.id); }
    catch (e) { setMutationError(e); }
  }

  return (
    <>
      <TopBar
        title="المصاريف السنوية"
        subtitle="متابعة المصاريف التشغيلية المتكررة للأسطول والامتياز"
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
            title="تعذّر تحميل المصاريف السنوية"
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
            label="إجمالي المصاريف السنوية"
            value={formatCurrency(totals.total)}
            sub={`${items.length} ${items.length === 1 ? 'مصروف' : 'مصاريف'}`}
          />
          <StatCard
            icon={CheckCircle2}
            tone="emerald"
            label="المدفوع حسب الحالة والدفعات"
            value={formatCurrency(totals.paid)}
            sub={
              totals.total > 0
                ? 'يشمل كامل تكلفة البنود المعلّمة مدفوعة يدويًا؛ جدول الدفعات يعرض المسجل فعليًا.'
                : 'لا توجد مدفوعات بعد'
            }
          />
          <StatCard
            icon={Clock}
            tone="amber"
            label="مصاريف معلقة"
            value={formatCurrency(totals.pending)}
            sub={
              totals.total > 0
                ? `${((totals.pending / totals.total) * 100).toFixed(0)}% من الإجمالي`
                : 'لا توجد مصاريف معلقة'
            }
          />
        </div>

        {/* ── Main table ─────────────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="بنود المصاريف السنوية"
            subtitle={canMutate
              ? 'حرّر الحالة مباشرةً من الجدول أو افتح بند للتعديل الكامل'
              : 'عرض حصّتك من المصاريف السنوية (للقراءة فقط)'}
            action={canMutate ? (
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة مصروف سنوي
              </PrimaryButton>
            ) : null}
          />

          {loading && !items.length ? (
            <LoadingState rows={4} />
          ) : items.length === 0 ? (
            <EmptyState onAdd={openAddModal} canMutate={canMutate} />
          ) : (
            <ScrollableTable className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">المصروف</th>
                    <th className="py-3 px-4 whitespace-nowrap">التصنيف</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">التكلفة السنوية</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المدفوع</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المتبقي</th>
                    <th className="py-3 px-4 whitespace-nowrap">تاريخ الصرف السنوي</th>
                    <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left w-20">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    // Ledger-driven figures, scaled like every other money
                    // figure on the page (admin → ×1).
                    const rowPaid      = (i.actualAmount || 0) * scalingFactor;
                    const rowRemaining = Math.max(0, (i.annualCost || 0) - (i.actualAmount || 0)) * scalingFactor;
                    return (
                    <tr
                      key={i.id}
                      className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-normal break-words min-w-[180px]">
                        {canMutate ? (
                          <button
                            type="button"
                            onClick={() => setDetailItemId(i.id)}
                            className="font-medium text-slate-800 dark:text-slate-200 hover:text-primary-700 dark:hover:text-primary-400 hover:underline decoration-dotted underline-offset-4 transition-colors text-right"
                            title="فتح سجل المصاريف التفصيلي"
                          >
                            {i.expenseName}
                          </button>
                        ) : (
                          <span className="font-medium text-slate-800 dark:text-slate-200">{i.expenseName}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-control">
                          {getCategoryLabel(i.category)}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCurrency(i.annualCost * scalingFactor)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCurrency(rowPaid)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums">
                        <span className={rowRemaining > 0
                          ? 'font-semibold text-amber-700 dark:text-amber-400'
                          : 'font-medium text-emerald-600 dark:text-emerald-400'}>
                          {formatCurrency(rowRemaining)}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <CalendarClock size={13} className="text-slate-500 dark:text-slate-400" />
                          {formatAnnualPaymentDate(i.paymentMonth, i.paymentDay)}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="block text-xs text-slate-500 mb-1">الحالة المسجلة يدويًا</span>
                        {((i.paymentStatus === 'paid' && (i.annualCost || 0) - (i.actualAmount || 0) > 0.005) || (i.paymentStatus !== 'paid' && i.annualCost > 0 && (i.actualAmount || 0) >= i.annualCost)) && <p role="status" className="text-xs text-amber-800 dark:text-amber-300 mb-2 whitespace-normal">الحالة تختلف عن سجل الدفعات؛ راجع المصروف قبل الاعتماد.</p>}
                        <PaymentStatusPill
                          status={i.paymentStatus}
                          dueToday={isAnnualDueToday(i.paymentMonth, i.paymentDay)}
                          onChange={(next) => handleUpdateStatus(i.id, next)}
                          disabled={!canMutate}
                        />
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left">
                        {canMutate && (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(i)}
                              className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/15 transition-colors"
                              aria-label={`تعديل ${i.expenseName}`}
                              title="تعديل المصروف"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(i)}
                              className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
                              aria-label={`حذف ${i.expenseName}`}
                              title="حذف المصروف"
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
            </ScrollableTable>
          )}
        </Card>
      </main>

      <AddAnnualExpenseModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
        onAddCategory={handleAddCategory}
        onDeleteCategory={handleDeleteCategory}
        categories={categories}
        protectedCategoryLabels={RECURRING_EXPENSE_CATEGORIES.map((c) => c.label)}
        initialValues={editingItem}
      />

      <ExpenseLedgerModal
        isOpen={Boolean(detailItem)}
        onClose={() => setDetailItemId(null)}
        title={detailItem ? `سجل مصاريف: ${detailItem.expenseName}` : ''}
        plannedAmount={detailItem?.annualCost || 0}
        plannedLabel="التكلفة السنوية"
        ledger={detailLedger}
        onDirty={refetch}
        migrationFile="2026_06_annual_expense_entries_ALL.sql"
        uploadFolder={detailItem ? `annual/${detailItem.id}` : 'annual'}
        units={detailItem?.units || null}
        onAssignUnits={canMutate ? handleAssignUnits : null}
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
